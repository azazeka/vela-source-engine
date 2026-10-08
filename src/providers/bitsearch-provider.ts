import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

interface BitsearchItem {
  id: string;
  infohash: string;
  title: string;
  size: number;
  category?: number;
  subCategory?: number | null;
  seeders?: number;
  leechers?: number;
  verified?: boolean;
}

interface BitsearchResponse {
  success: boolean;
  query?: string;
  results?: BitsearchItem[];
  error?: string;
}

export class BitsearchProvider implements TorrentProvider {
  private readonly mirrors: string[];

  constructor(
    customBaseUrl = process.env.BITSEARCH_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'bitsearch',
    readonly name = 'BitSearch'
  ) {
    if (customBaseUrl) {
      this.mirrors = [customBaseUrl];
    } else {
      this.mirrors = [
        'https://bitsearch.eu',
        'https://bitsearch.to',
      ];
    }
  }

  private async fetchJson(path: string): Promise<{ data: BitsearchResponse; mirror: string }> {
    let lastError: Error | null = null;
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
      'Accept': 'application/json',
    };

    for (const mirror of this.mirrors) {
      try {
        const url = `${mirror}${path}`;
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(8000),
          headers,
        });
        if (response.ok) {
          const data = (await response.json()) as BitsearchResponse;
          return { data, mirror };
        }
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new Error(`BitSearch API is temporarily unavailable (${lastError?.message || 'mirrors unreachable'}).`);
  }

  public async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && this.fetcher === fetch) {
      return [];
    }

    let query: string;
    if (request.type === 'episode') {
      const title = request.seriesTitle || request.originalTitle || request.title;
      const s = String(request.season ?? 1).padStart(2, '0');
      const e = String(request.episode ?? 1).padStart(2, '0');
      query = `${title} S${s}E${e}`;
    } else {
      const title = request.originalTitle || request.title;
      query = `${title} ${request.year || ''}`.trim();
    }

    const cleanQuery = query
      .replace(/[:\/\\?*|"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanQuery) return [];

    try {
      const { data, mirror } = await this.fetchJson(
        `/api/v1/search?q=${encodeURIComponent(cleanQuery)}&sort=seeders&limit=80`
      );

      if (!data.success || !Array.isArray(data.results)) {
        return [];
      }

      const releases: RawRelease[] = [];
      for (const item of data.results) {
        if (!item || !item.title || !item.infohash) continue;

        const infoHash = item.infohash.trim().toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(infoHash)) continue;

        const name = item.title.trim();
        const sizeBytes = Number(item.size);
        const seeders = Number(item.seeders);

        releases.push({
          provider: this.id,
          name,
          infoHash,
          magnet: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`,
          sizeBytes: Number.isSafeInteger(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
          seeders: Number.isFinite(seeders) ? Math.max(0, seeders) : 0,
          detailsUrl: `${mirror}/torrents/${item.id}`,
        });
      }

      return releases;
    } catch (err) {
      console.warn(`[BitsearchProvider] Search failed for "${cleanQuery}": ${(err as Error).message}`);
      return [];
    }
  }

  public async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const { data } = await this.fetchJson('/api/v1/search?q=test&limit=1');
      const healthy = data.success === true;
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: data.error || 'BitSearch API returned unsuccessful response.' }),
      };
    } catch (error) {
      return {
        id: this.id,
        healthy: false,
        latencyMs: Date.now() - start,
        error: (error as Error).message,
      };
    }
  }
}
