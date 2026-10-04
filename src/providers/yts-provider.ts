import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

interface YtsTorrent {
  hash: string;
  quality: string;
  type: string;
  seeds: number;
  size_bytes: number;
}

interface YtsMovie {
  id: number;
  title: string;
  title_long?: string;
  year: number;
  url: string;
  torrents?: YtsTorrent[];
}

interface YtsResponse {
  status: string;
  data?: {
    movie_count: number;
    movies?: YtsMovie[];
  };
}

export class YtsProvider implements TorrentProvider {
  private readonly endpoints: string[];

  constructor(
    customBaseUrl = process.env.YTS_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'yts',
    readonly name = 'YTS'
  ) {
    if (customBaseUrl) {
      this.endpoints = [customBaseUrl];
    } else {
      this.endpoints = [
        'https://movies-api.accel.li/api/v2',
        'https://yts.lt/api/v2',
        'https://yts.pm/api/v2',
      ];
    }
  }

  private async get(path: string): Promise<Response> {
    let lastError: Error | null = null;
    for (const base of this.endpoints) {
      try {
        const url = `${base}${path}`;
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(8000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
          },
        });
        if (response.ok) return response;
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new Error(`YTS API is temporarily unavailable (${lastError?.message || 'all endpoints failed'}).`);
  }

  async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_YTS_IN_TESTS) {
      return [];
    }

    if (request.type !== 'movie') return [];

    const queryTitle = (request.originalTitle || request.title)
      .replace(/[:\/\\?*|"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!queryTitle) return [];

    const path = `/list_movies.json?query_term=${encodeURIComponent(queryTitle)}`;
    let response: Response;
    try {
      response = await this.get(path);
    } catch {
      return [];
    }

    let payload: YtsResponse;
    try {
      payload = (await response.json()) as YtsResponse;
    } catch {
      return [];
    }

    if (payload.status !== 'ok' || !payload.data?.movies) return [];

    const releases: RawRelease[] = [];

    for (const movie of payload.data.movies) {
      // Check year match if available
      if (request.year && movie.year && Math.abs(movie.year - request.year) > 1) {
        continue;
      }

      if (!movie.torrents || !Array.isArray(movie.torrents)) continue;

      for (const torrent of movie.torrents) {
        const hash = torrent.hash?.toLowerCase();
        if (!hash || !/^[a-f\d]{40}$/.test(hash)) continue;

        const releaseName = `${movie.title_long || movie.title} [${torrent.quality}] [${torrent.type || 'BluRay'}] [YTS]`;
        const magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(releaseName)}&tr=udp://open.stealth.si:80/announce&tr=udp://tracker.opentrackr.org:1337/announce`;

        releases.push({
          provider: this.id,
          name: releaseName,
          infoHash: hash,
          magnet,
          sizeBytes: Number.isSafeInteger(torrent.size_bytes) && torrent.size_bytes > 0 ? torrent.size_bytes : 0,
          seeders: Number.isFinite(torrent.seeds) ? Math.max(0, torrent.seeds) : 0,
          detailsUrl: movie.url || null,
        });
      }
    }

    return releases;
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await this.get('/list_movies.json?limit=1');
      const payload = (await response.json()) as YtsResponse;
      const healthy = payload.status === 'ok';
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: 'YTS returned status != ok' }),
      };
    } catch (err) {
      return {
        id: this.id,
        healthy: false,
        latencyMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }
}
