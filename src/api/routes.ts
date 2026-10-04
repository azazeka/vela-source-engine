import { Router, Request, Response } from 'express';
import { CacheManager } from '../services/cache-manager';
import { RankingEngine } from '../services/ranking-engine';
import { SourceEngine } from '../services/source-engine';
import { TorBoxAdapter, TorBoxError } from '../services/torbox-adapter';
import { MediaRequest, QualityPreset } from '../types';

export function createRouter(sourceEngine: SourceEngine, torboxAdapter: TorBoxAdapter): Router {
  const router = Router();

  // Helper to extract Bearer token if passed by tvOS client
  const getApiKey = (req: Request): string | undefined => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.substring(7).trim();
    }
    return typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : undefined;
  };

  // 1. GET /health
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // 2. POST /session/start (Section 14 & 15: Warm-up on app launch)
  router.post('/session/start', async (req: Request, res: Response) => {
    try {
      const apiKey = getApiKey(req);
      const torboxHealth = await torboxAdapter.health(apiKey);
      const providersHealth = await sourceEngine.checkProvidersHealth(apiKey);

      const overallStatus =
        torboxHealth !== 'ok' || providersHealth.healthy === 0 ? 'degraded' : 'ready';

      res.json({
        status: overallStatus,
        sourceEngine: true,
        torbox: torboxHealth,
        providers: {
          healthy: providersHealth.healthy,
          degraded: providersHealth.degraded,
        },
      });
    } catch (err: any) {
      res.status(err instanceof TorBoxError ? err.statusCode : 500).json({ error: err.message });
    }
  });

  // Require an account for source caches and playback; health stays public.
  router.use((req, res, next) => {
    try { torboxAdapter.cacheScope(getApiKey(req)); next(); }
    catch { res.status(401).json({ error: 'TorBox API key is required.' }); }
  });

  // 3. POST /sources/prefetch (Section 04 & 14: background prefetch when user opens movie details)
  router.post('/sources/prefetch', (req: Request, res: Response) => {
    const request = req.body as MediaRequest;
    if (!request || !request.tmdbId || !request.title) {
      res.status(400).json({ error: 'Invalid MediaRequest payload' });
      return;
    }

    const mediaKey = sourceEngine.getMediaKey(request);
    const apiKey = getApiKey(req);

    // Fire and forget / background resolve
    sourceEngine.searchCandidates(request, 'best', apiKey).catch((err) => {
      console.warn(`Prefetch failed for ${mediaKey}.`);
    });

    res.status(202).json({
      status: 'prefetching',
      mediaKey,
    });
  });

  // 4. POST /sources/search
  router.post('/sources/search', async (req: Request, res: Response) => {
    try {
      const request = req.body.request as MediaRequest;
      const preset = (req.body.preset as QualityPreset) || 'best';
      if (!request || (!request.isAdult && !request.tmdbId) || !request.title) {
        res.status(400).json({ error: 'Invalid MediaRequest payload' });
        return;
      }

      const apiKey = getApiKey(req);
      const candidates = await sourceEngine.searchCandidates(request, preset, apiKey);
      res.json({
        mediaKey: sourceEngine.getMediaKey(request),
        candidates,
      });
    } catch (err: any) {
      res.status(err instanceof TorBoxError ? err.statusCode : 500).json({ error: err.message });
    }
  });

  // 4b. POST /sources/adult/search (Adult content search & catalog browse)
  router.post('/sources/adult/search', async (req: Request, res: Response) => {
    try {
      const query = typeof req.body.query === 'string' ? req.body.query.trim() : '';
      const preset = (req.body.preset as QualityPreset) || 'best';
      const effectiveQuery = query || 'Trending';

      const request: MediaRequest = {
        type: 'movie',
        tmdbId: -1,
        title: effectiveQuery,
        originalTitle: effectiveQuery,
        year: new Date().getFullYear(),
        isAdult: true,
      };

      const apiKey = getApiKey(req);
      const candidates = await sourceEngine.searchCandidates(request, preset, apiKey);
      res.json({
        query: effectiveQuery,
        mediaKey: sourceEngine.getMediaKey(request),
        candidates,
      });
    } catch (err: any) {
      res.status(err instanceof TorBoxError ? err.statusCode : 500).json({ error: err.message });
    }
  });

  // 5. POST /sources/rank (re-rank with different preset)
  router.post('/sources/rank', (req: Request, res: Response) => {
    const mediaKey = req.body.mediaKey as string;
    const preset = (req.body.preset as QualityPreset) || 'best';

    if (!mediaKey) {
      res.status(400).json({ error: 'Missing mediaKey' });
      return;
    }

    const cached = CacheManager.getCandidates(mediaKey, torboxAdapter.cacheScope(getApiKey(req)));
    if (!cached) {
      res.status(404).json({ error: 'No cached candidates found for this mediaKey' });
      return;
    }

    const reranked = RankingEngine.rank(cached, preset);
    res.json({ mediaKey, candidates: reranked });
  });

  // 6. POST /play/resolve (Section 09 & 15: Single-click instant play)
  router.post('/play/resolve', async (req: Request, res: Response) => {
    try {
      const request = req.body.request as MediaRequest;
      const candidateId = req.body.candidateId as string | undefined;
      const preset = (req.body.preset as QualityPreset) || 'best';

      if (!request || (!request.isAdult && !request.tmdbId) || !request.title) {
        res.status(400).json({ error: 'Invalid MediaRequest payload' });
        return;
      }

      const apiKey = getApiKey(req);
      console.log(`[PlayResolve] Starting resolve for tmdbId=${request.tmdbId} title="${request.title}" candidateId=${candidateId ?? 'auto'}`);
      const result = await sourceEngine.resolvePlay(request, candidateId, preset, apiKey);
      console.log(`[PlayResolve] Successfully resolved stream for "${result.candidate.fileName}"`);
      res.json(result);
    } catch (err: any) {
      console.error(`[PlayResolve Error] ${err.message} (status: ${err.statusCode || 500})`);
      res.status(err instanceof TorBoxError ? err.statusCode : 500).json({ error: err.message });
    }
  });

  // 7. GET /versions/:mediaKey (Section 10: Manual versions list)
  router.get('/versions/:mediaKey', (req: Request, res: Response) => {
    const mediaKey = req.params.mediaKey;
    const cached = CacheManager.getCandidates(mediaKey, torboxAdapter.cacheScope(getApiKey(req)));

    if (!cached) {
      res.status(404).json({ error: 'No versions found or expired for this mediaKey' });
      return;
    }

    res.json({
      mediaKey,
      versions: cached,
    });
  });

  // 8. POST /playback/failure (Section 15 & 17: Mark bad candidate and return fallback)
  router.post('/playback/failure', async (req: Request, res: Response) => {
    try {
      const { candidateId, mediaKey, request } = req.body;
      if (!candidateId || !mediaKey) {
        res.status(400).json({ error: 'Missing candidateId or mediaKey' });
        return;
      }

      if (!request || sourceEngine.getMediaKey(request) !== mediaKey) {
        res.status(400).json({ error: 'Playback media key does not match request.' });
        return;
      }

      // Mark candidate as bad
      CacheManager.markCandidateFailure(candidateId, undefined, torboxAdapter.cacheScope(getApiKey(req)));

      // Check if we can fallback to the next candidate
      const cached = CacheManager.getCandidates(mediaKey, torboxAdapter.cacheScope(getApiKey(req)));
      if (cached && cached.length > 0) {
        const nextCandidate = cached[0];
        const apiKey = getApiKey(req);
        if (request) {
          const fallbackResult = await sourceEngine.resolvePlay(
            request,
            nextCandidate.candidateId,
            'best',
            apiKey
          );
          res.json({
            status: 'fallback_ready',
            fallback: fallbackResult,
          });
          return;
        }
      }

      res.json({
        status: 'marked_failed',
        candidateId,
      });
    } catch (err: any) {
      res.status(err instanceof TorBoxError ? err.statusCode : 500).json({ error: err.message });
    }
  });

  return router;
}
