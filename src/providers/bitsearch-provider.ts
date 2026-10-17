import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { ProviderSearch } from '../services/provider-search';
import { QueryBuilder } from '../services/query-builder';
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
          signal: AbortSignal.timeout(2500),
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

    const queries = request.type === 'episode'
      ? QueryBuilder.getEpisodeSearchQueries(request) : [request.originalTitle || request.title, request.title].map(title => `${QueryBuilder.cleanTitle(title)} ${request.year || ""}`.trim());

    if (queries.length === 0) return [];

    return ProviderSearch.collect(request, queries, async rawQuery => {
      const cleanQuery = rawQuery
        .replace(/[:\/\\?*|"<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanQuery) return [];

      try {
        const { data, mirror } = await this.fetchJson(
          `/api/v1/search?q=${encodeURIComponent(cleanQuery)}&sort=seeders&limit=80`
        );

        if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
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
      }
      return [];
    });
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
