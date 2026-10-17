import { createTasteProfileRepository } from '../services/cosmos-taste-profile-store';
import { validateTasteProfile } from '../services/taste-profile-store';
import { Router, Request, Response } from 'express';
import { AIService } from '../services/ai-service';
import { CacheManager } from '../services/cache-manager';
import { RankingEngine } from '../services/ranking-engine';
import { SourceEngine } from '../services/source-engine';
import { DebridAdapter, DebridError } from '../services/debrid-adapter.interface';
import { RealDebridAdapter } from '../services/realdebrid-adapter';
import { TorBoxAdapter, TorBoxError } from '../services/torbox-adapter';
import { TrailerResolver } from '../services/trailer-resolver';
import { CandidateSummary, MediaRequest, PlayCandidate, QualityPreset } from '../types';

export function createRouter(
  sourceEngine: SourceEngine,
  torboxAdapter: TorBoxAdapter,
  aiService: AIService = new AIService(),
  trailerResolver: TrailerResolver = new TrailerResolver(),
  realdebridAdapter: RealDebridAdapter = new RealDebridAdapter()
): Router {
  const router = Router();
  const tasteProfiles = createTasteProfileRepository();

  const getDebridProvider = (req: Request): 'torbox' | 'realdebrid' => {
    const provider = req.headers['x-debrid-provider'];
    if (typeof provider === 'string' && provider.toLowerCase() === 'realdebrid') {
      return 'realdebrid';
    }
    return 'torbox';
  };

  const getDebridAdapter = (req: Request): DebridAdapter => {
    return getDebridProvider(req) === 'realdebrid' ? realdebridAdapter : torboxAdapter;
  };

  // Helper to extract Bearer token if passed by tvOS client
  const getApiKey = (req: Request): string | undefined => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      return auth.substring(7).trim();
    }
    return typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : undefined;
  };

  const getGeminiKey = (req: Request): string | undefined => {
    const key = req.headers['x-gemini-key'];
    return typeof key === 'string' && key.trim().length > 0 ? key.trim() : undefined;
  };

  // 1. GET /health
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      build: process.env.VELA_BUILD_ID ?? 'development',
      episodeMatching: 'strict-v2',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // 2. POST /session/start (Section 14 & 15: Warm-up on app launch)
  router.post('/session/start', async (req: Request, res: Response) => {
    try {
      const apiKey = getApiKey(req);
      const adapter = getDebridAdapter(req);
      const debridHealth = await adapter.health(apiKey);
      const providersHealth = await sourceEngine.checkProvidersHealth(apiKey);

      const overallStatus =
        debridHealth !== 'ok' || providersHealth.healthy === 0 ? 'degraded' : 'ready';

      res.json({
        status: overallStatus,
        sourceEngine: true,
        debridProvider: adapter.id,
        debrid: debridHealth,
        torbox: debridHealth, // for backward compatibility with existing clients
        providers: {
          healthy: providersHealth.healthy,
          degraded: providersHealth.degraded,
        },
      });
    } catch (err: any) {
      res.status(err instanceof DebridError ? err.statusCode : 500).json({ error: err.message, code: err instanceof DebridError ? err.code : undefined, diagnostic: err instanceof DebridError ? err.diagnostic : undefined });
    }
  });

  // AI 1: POST /ai/discover - Semantic natural language & mood discovery
  router.post('/ai/discover', async (req: Request, res: Response) => {
    try {
      const { prompt, mode } = req.body;
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Prompt is required and must be a string' });
        return;
      }
      const customKey = getGeminiKey(req);
      const result = mode === 'description'
        ? await aiService.findByDescription(prompt, customKey)
        : await aiService.discover(prompt, customKey);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'AI discovery failed' });
    }
  });

  // AI 1b: POST /ai/find-by-description - Identify movie/series by plot description
  router.post('/ai/find-by-description', async (req: Request, res: Response) => {
    try {
      const description = req.body.description || req.body.prompt;
      if (!description || typeof description !== 'string') {
        res.status(400).json({ error: 'Description is required and must be a string' });
        return;
      }
      const customKey = getGeminiKey(req);
      const result = await aiService.findByDescription(description, customKey);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'AI find-by-description failed' });
    }
  });

  // AI 2: POST /ai/explain-releases - Intelligent release comparator
  router.post('/ai/explain-releases', async (req: Request, res: Response) => {
    try {
      const { title, releases } = req.body;
      if (!title || !Array.isArray(releases)) {
        res.status(400).json({ error: 'Title and releases array are required' });
        return;
      }
      const customKey = getGeminiKey(req);
      const result = await aiService.explainReleases(title, releases as CandidateSummary[], customKey);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'AI release explanation failed' });
    }
  });

  // 3. GET /trailer/stream/:key (Public trailer stream resolver for Apple TV)
  router.get('/trailer/stream/:key?', async (req: Request, res: Response) => {
    try {
      const key = (req.params.key || req.query.key) as string;
      if (!key) {
        res.status(400).json({ error: 'Missing trailer key' });
        return;
      }
      const redirect = req.query.redirect === 'true' || req.query.redirect === '1';
      const result = await trailerResolver.resolve(key);

      if (redirect) {
        res.redirect(302, result.streamUrl);
        return;
      }

      res.json({
        key,
        streamUrl: result.streamUrl,
        format: result.format,
        quality: result.quality,
        title: result.title,
      });
    } catch (err: any) {
      console.warn(`[API] /trailer/stream failed:`, err?.message ?? err);
      res.status(502).json({ error: err?.message ?? 'Failed to resolve trailer stream' });
    }
  });

  // Require an account for source caches and playback; health & AI stay public.
  router.use((req, res, next) => {
    try { getDebridAdapter(req).cacheScope(getApiKey(req)); next(); }
    catch { res.status(401).json({ error: `${getDebridProvider(req) === 'realdebrid' ? 'Real-Debrid' : 'TorBox'} API key is required.` }); }
  });

  router.get('/profile/taste', async (req, res) => {
    if (!getApiKey(req)) { res.status(401).json({ error: 'API key is required.' }); return; }
    try { res.json({ profile: await tasteProfiles.load(getDebridAdapter(req).cacheScope(getApiKey(req))) }); }
    catch { res.status(503).json({ error: 'Could not load your saved profile. Try again.' }); }
  });
  router.put('/profile/taste', async (req, res) => {
    if (!getApiKey(req)) { res.status(401).json({ error: 'API key is required.' }); return; }
    let profile;
    try { profile = validateTasteProfile(req.body); }
    catch { res.status(400).json({ error: 'Invalid taste profile.' }); return; }
    try { res.json({ profile: await tasteProfiles.save(getDebridAdapter(req).cacheScope(getApiKey(req)), profile) }); }
    catch { res.status(503).json({ error: 'Could not save your profile. Your local copy is still available.' }); }
  });

  // 3. POST /sources/prefetch (Section 04 & 14: background prefetch when user opens movie details)
  router.post('/sources/prefetch', (req: Request, res: Response) => {
    const request = req.body as MediaRequest;
    if (!request || !request.tmdbId || !request.title) {
      res.status(400).json({ error: 'Invalid MediaRequest payload' });
      return;
    }

    const provider = getDebridProvider(req);
    const mediaKey = sourceEngine.getMediaKey(request, provider);
    const apiKey = getApiKey(req);

    // Fire and forget / background resolve
    sourceEngine.searchCandidates(request, 'best', apiKey, false, provider).catch((err) => {
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
      if (!request || !request.tmdbId || !request.title) {
        res.status(400).json({ error: 'Invalid MediaRequest payload' });
        return;
      }

      const apiKey = getApiKey(req);
      const provider = getDebridProvider(req);
      const candidates = await sourceEngine.searchCandidates(request, preset, apiKey, req.body.fresh === true, provider);
      res.json({
        mediaKey: sourceEngine.getMediaKey(request, provider),
        candidates,
      });
    } catch (err: any) {
      res.status(err instanceof DebridError ? err.statusCode : 500).json({ error: err.message, code: err instanceof DebridError ? err.code : undefined, diagnostic: err instanceof DebridError ? err.diagnostic : undefined });
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

    const adapter = getDebridAdapter(req);
    const cached = CacheManager.getCandidates(mediaKey, adapter.cacheScope(getApiKey(req)));
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

      if (!request || !request.tmdbId || !request.title) {
        res.status(400).json({ error: 'Invalid MediaRequest payload' });
        return;
      }

      const apiKey = getApiKey(req);
      const provider = getDebridProvider(req);
      console.log(`[PlayResolve] Starting resolve for tmdbId=${request.tmdbId} title="${request.title}" candidateId=${candidateId ?? 'auto'} provider=${provider}`);
      const result = await sourceEngine.resolvePlay(request, candidateId, preset, apiKey, provider);
      console.log(`[PlayResolve] Successfully resolved stream for "${result.candidate.fileName}"`);
      res.json(result);
    } catch (err: any) {
      console.error('[PlayResolve failure]', JSON.stringify({
        status: err instanceof DebridError ? err.statusCode : 500,
        code: err instanceof DebridError ? err.code : undefined,
        diagnostic: err instanceof DebridError ? err.diagnostic : undefined,
      }));
      res.status(err instanceof DebridError ? err.statusCode : 500).json({ error: err.message, code: err instanceof DebridError ? err.code : undefined, diagnostic: err instanceof DebridError ? err.diagnostic : undefined });
    }
  });

  // 7. GET /versions/:mediaKey (Section 10: Manual versions list)
  router.get('/versions/:mediaKey', (req: Request, res: Response) => {
    const mediaKey = req.params.mediaKey;
    const adapter = getDebridAdapter(req);
    const cached = CacheManager.getCandidates(mediaKey, adapter.cacheScope(getApiKey(req)));

    if (!cached) {
      res.status(404).json({ error: 'No versions found or expired for this mediaKey' });
      return;
    }

    res.json({
      mediaKey,
      versions: RankingEngine.rank(cached, (req.query.preset as QualityPreset) || 'best'),
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

      const provider = getDebridProvider(req);
      if (!request || sourceEngine.getMediaKey(request, provider) !== mediaKey) {
        res.status(400).json({ error: 'Playback media key does not match request.' });
        return;
      }

      const adapter = getDebridAdapter(req);
      // Mark candidate as bad
      CacheManager.markCandidateFailure(candidateId, undefined, adapter.cacheScope(getApiKey(req)));

      // Check if we can fallback to the next candidate
      const cached = CacheManager.getCandidates(mediaKey, adapter.cacheScope(getApiKey(req)));
      if (cached && cached.length > 0) {
        const nextCandidate = cached[0];
        const apiKey = getApiKey(req);
        if (request) {
          const fallbackResult = await sourceEngine.resolvePlay(
            request,
            nextCandidate.candidateId,
            'best',
            apiKey,
            provider
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
      res.status(err instanceof DebridError ? err.statusCode : 500).json({ error: err.message, code: err instanceof DebridError ? err.code : undefined, diagnostic: err instanceof DebridError ? err.diagnostic : undefined });
    }
  });

  return router;
}
