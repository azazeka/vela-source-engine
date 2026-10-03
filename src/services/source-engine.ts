import { TorrentProvider } from '../providers/provider.interface';
import {
  MediaRequest,
  PlayCandidate,
  PlayResolveResponse,
  ProviderHealth,
  QualityPreset,
  RawRelease,
} from '../types';
import { CacheManager } from './cache-manager';
import { FileMatcher } from './file-matcher';
import { Normalizer } from './normalizer';
import { QueryBuilder } from './query-builder';
import { RankingEngine } from './ranking-engine';
import { TorBoxAdapter } from './torbox-adapter';

export class SourceEngine {
  private providers: TorrentProvider[] = [];
  private torbox: TorBoxAdapter;

  constructor(torboxAdapter: TorBoxAdapter = new TorBoxAdapter()) {
    this.torbox = torboxAdapter;
  }

  public registerProvider(provider: TorrentProvider): void {
    this.providers.push(provider);
  }

  public getMediaKey(request: MediaRequest): string {
    if (request.type === 'movie') {
      return `movie:${request.tmdbId}`;
    }
    return `episode:${request.tmdbId}:${request.season ?? 1}:${request.episode ?? 1}`;
  }

  public async searchCandidates(
    request: MediaRequest,
    preset: QualityPreset = 'best',
    apiKey?: string
  ): Promise<PlayCandidate[]> {
    const mediaKey = this.getMediaKey(request);

    // 1. Check cache first
    const cached = CacheManager.getCandidates(mediaKey);
    if (cached && cached.length > 0) {
      return RankingEngine.rank(cached, preset);
    }

    // 2. Query Builder
    const queries = QueryBuilder.buildQueries(request);

    // 3. Provider fan-out with timeout protection (3.5s per provider)
    const rawReleases: RawRelease[] = [];
    const searchPromises = this.providers.map(async (provider) => {
      try {
        const timeoutPromise = new Promise<RawRelease[]>((_, reject) =>
          setTimeout(() => reject(new Error('Provider search timeout')), 3500)
        );
        const searchPromise = provider.search(request);
        const results = await Promise.race([searchPromise, timeoutPromise]);
        rawReleases.push(...results);
      } catch (err: any) {
        console.warn(`Provider ${provider.id} error:`, err.message);
      }
    });

    await Promise.all(searchPromises);

    // 4. Normalizer & Deduplicator
    const normalized = Normalizer.normalize(rawReleases);
    if (normalized.length === 0) {
      return [];
    }

    // 5. Batch TorBox cache check
    const hashes = normalized.map((n) => n.infoHash);
    const cachedTorrents = await this.torbox.checkCached(hashes, apiKey);

    // 6. File matching & candidate construction
    const candidates: PlayCandidate[] = [];

    for (const rel of normalized) {
      const cachedTorrent = cachedTorrents.get(rel.infoHash);
      const isCached = !!cachedTorrent;
      const files = cachedTorrent ? cachedTorrent.files : [];

      let fileId = 0;
      let fileName = rel.name;
      let fileSize = rel.sizeBytes;

      if (files.length > 0) {
        const matchedFile = FileMatcher.matchFile(request, files);
        if (!matchedFile) {
          // If files are listed but target episode/movie cannot be matched, skip this torrent
          continue;
        }
        fileId = matchedFile.id;
        fileName = matchedFile.name;
        fileSize = matchedFile.size;
      }

      const candidateId = `cand_${rel.infoHash.slice(0, 8)}_${fileId}`;

      candidates.push({
        candidateId,
        mediaKey,
        quality: rel.parsed.resolution,
        hdr: rel.parsed.hdr,
        videoCodec: rel.parsed.videoCodec,
        audio: rel.parsed.audio,
        channels: rel.parsed.channels,
        source: `${rel.parsed.source}_${rel.parsed.releaseType}`,
        sizeBytes: fileSize,
        cached: isCached,
        torrentHash: rel.infoHash,
        fileId,
        fileName,
        provider: rel.provider,
        rawReleaseName: rel.name,
        score: 0,
        badges: [],
      });
    }

    // 7. Ranking
    const ranked = RankingEngine.rank(candidates, preset);

    // 8. Save in cache
    if (ranked.length > 0) {
      CacheManager.setCandidates(mediaKey, ranked);
    }

    return ranked;
  }

  public async resolvePlay(
    request: MediaRequest,
    candidateId?: string,
    preset: QualityPreset = 'best',
    apiKey?: string
  ): Promise<PlayResolveResponse> {
    const candidates = await this.searchCandidates(request, preset, apiKey);
    if (candidates.length === 0) {
      throw new Error('No playable candidates found for this media.');
    }

    let selected = candidateId
      ? candidates.find((c) => c.candidateId === candidateId)
      : candidates.find((c) => c.cached) || candidates[0];

    if (!selected) {
      selected = candidates[0];
    }

    const stream = await this.torbox.requestDownloadLink(
      selected.torrentHash,
      selected.fileId,
      apiKey
    );

    return {
      candidate: selected,
      stream,
    };
  }

  public async checkProvidersHealth(): Promise<{ healthy: number; degraded: number; list: ProviderHealth[] }> {
    const results = await Promise.all(
      this.providers.map((p) =>
        p.health().catch((err) => ({
          id: p.id,
          healthy: false,
          latencyMs: 0,
          error: err.message,
        }))
      )
    );

    const healthy = results.filter((r) => r.healthy).length;
    const degraded = results.length - healthy;

    return {
      healthy,
      degraded,
      list: results,
    };
  }
}
