import { TorrentProvider } from '../providers/provider.interface';
import {
  MediaRequest,
  PlayCandidate,
  PlayResolveResponse,
  ProviderHealth,
  QualityPreset,
  RawRelease,
  TorBoxCachedTorrent,
} from '../types';
import { CacheManager } from './cache-manager';
import { FileMatcher } from './file-matcher';
import { Normalizer } from './normalizer';
import { RankingEngine } from './ranking-engine';
import { ReleaseIdentity } from './release-identity';
import { TorBoxAdapter, TorBoxError } from './torbox-adapter';

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
    apiKey?: string,
    fresh: boolean = false
  ): Promise<PlayCandidate[]> {
    const mediaKey = this.getMediaKey(request);
    const scope = this.torbox.cacheScope(apiKey);

    // 1. Check cache first
    const cached = CacheManager.getCandidates(mediaKey, scope);
    if (!fresh && cached && cached.length > 0) {
      return RankingEngine.rank(cached.filter(candidate => ReleaseIdentity.matches(candidate.rawReleaseName, request)), preset);
    }

    if (fresh) CacheManager.setCandidates(mediaKey, [], undefined, scope);

    // Provider fan-out with bounded searches; account pagination may take longer than a single request.
    const rawReleases: RawRelease[] = [];
    const providerErrors: unknown[] = [];
    const targetProviders = this.providers;

    const searchPromises = targetProviders.map(async (provider) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutPromise = new Promise<RawRelease[]>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Provider search timeout')), 10000);
        });
        const results = await Promise.race([provider.search(request, apiKey), timeoutPromise]);
        rawReleases.push(...results);
      } catch (error) {
        providerErrors.push(error);
        console.warn(`Provider ${provider.id} search failed.`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    });

    await Promise.all(searchPromises);
    if (rawReleases.length === 0 && providerErrors.length > 0) throw providerErrors[0];

    // 4. Normalizer & Deduplicator
    const verifiedReleases = rawReleases.filter(rel => ReleaseIdentity.matches(rel.name, request));
    const normalized = Normalizer.normalize(verifiedReleases, request.type === 'episode' ? 1024 * 1024 : undefined);
    if (normalized.length === 0) {
      return [];
    }

    // Ready account files do not depend on the global cache-check endpoint.
    // Preserve them even when another provider wins hash deduplication.
    const libraryFiles = new Map(verifiedReleases
      .filter(rel => rel.provider === 'torbox-library' && rel.libraryFiles?.length)
      .map(rel => [Normalizer.normalizeHash(rel.infoHash), rel.libraryFiles!] as const));
    const hashes = normalized.map(n => n.infoHash).filter(hash => !libraryFiles.has(hash));
    let cachedTorrents = new Map<string, TorBoxCachedTorrent>();
    if (hashes.length > 0) {
      try {
        cachedTorrents = await this.torbox.checkCached(hashes, apiKey);
      } catch (error) {
        if (libraryFiles.size === 0 || (error instanceof TorBoxError && error.statusCode === 401)) throw error;
        console.warn('TorBox cache check failed; using ready library files.');
      }
    }

    // 6. File matching & candidate construction
    const candidates: PlayCandidate[] = [];

    for (const rel of normalized) {
      const cachedTorrent = cachedTorrents.get(rel.infoHash);
      const isCached = libraryFiles.has(rel.infoHash) || rel.provider === 'torbox-library' || !!cachedTorrent;
      const files = libraryFiles.get(rel.infoHash) ?? cachedTorrent?.files ?? [];

      let fileId = 0;
      let fileName = rel.name;
      let fileSize = rel.sizeBytes;

      if (files.length > 0) {
        const matchedFile = FileMatcher.matchFile(request, files, rel.name);
        if (!matchedFile) {
          // If files are listed but target episode/movie cannot be matched, skip this torrent
          continue;
        }
        fileId = matchedFile.id;
        fileName = matchedFile.name;
        fileSize = matchedFile.size;
      } else if (request.type === 'episode') {
        const identity = FileMatcher.episodeIdentity(rel.name);
        if (identity.season != null && identity.season !== (request.season ?? 1)
          && !ReleaseIdentity.seasonRangeContains(rel.name, request.season ?? 1)) continue;
        if (identity.episode != null && identity.episode !== (request.episode ?? 1)) continue;
        if (identity.endEpisode != null && identity.endEpisode !== identity.episode) continue;
      }

      // Cache metadata can omit file IDs; a failure of E01 must not blacklist an entire season pack.
      const candidateId = `cand_${rel.infoHash}_${fileId}${request.type === 'episode' ? `_${encodeURIComponent(mediaKey)}` : ''}`;

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
        seeders: rel.seeders,
        badges: [],
      });
    }

    // 7. Ranking
    const ranked = RankingEngine.rank(candidates.filter(candidate => !CacheManager.isFailed(candidate.candidateId, scope)), preset);

    // 8. Save in cache
    if (ranked.length > 0) {
      CacheManager.setCandidates(mediaKey, ranked, undefined, scope);
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
      throw new TorBoxError('No playable candidates found for this media.', 404);
    }

    const eligible = candidateId ? candidates.filter(c => c.candidateId === candidateId) : candidates.filter(c => c.cached);
    if (candidateId && !eligible.length) throw new TorBoxError('The selected version is unavailable.', 404);
    if (!eligible.length || (candidateId && !eligible[0].cached)) {
      throw new TorBoxError('This torrent is not cached in TorBox yet. Choose a version to download to your TorBox library.', 409, 'TORBOX_NOT_CACHED');
    }
    if (!candidateId) {
      const hash = request.preferredTorrentHash?.toLowerCase();
      const group = request.preferredReleaseGroup?.toLowerCase();
      eligible.sort((a, b) => Number(b.torrentHash === hash) - Number(a.torrentHash === hash)
        || (group ? Number(ReleaseIdentity.releaseGroup(b.rawReleaseName) === group)
          - Number(ReleaseIdentity.releaseGroup(a.rawReleaseName) === group) : 0));
    }
    for (const selected of eligible) {
      try {
        const selectedFile = /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(selected.fileName)
          ? { name: selected.fileName, size: selected.sizeBytes } : undefined;
        const stream = await this.torbox.requestDownloadLink(selected.torrentHash, selected.fileId, apiKey, request, undefined, false, selectedFile);
        return { candidate: selected, stream };
      } catch (error) {
        // Retry only another verified copy. Authorization, rate limits and account errors must surface.
        if (candidateId || !(error instanceof TorBoxError) || error.statusCode !== 404) throw error;
        CacheManager.markCandidateFailure(selected.candidateId, undefined, this.torbox.cacheScope(apiKey));
      }
    }
    throw new TorBoxError('No verified playable copy of this episode is available. Choose another version.', 404);
  }

  public async checkProvidersHealth(apiKey?: string): Promise<{ healthy: number; degraded: number; list: ProviderHealth[] }> {
    const results = await Promise.all(
      this.providers.map((p) =>
        p.health(apiKey).catch((err) => ({
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
