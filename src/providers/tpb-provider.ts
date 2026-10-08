import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

interface ApibayItem {
  id: string;
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  size: string;
  category: string;
}

export class TpbProvider implements TorrentProvider {
  private readonly endpoints: string[];

  constructor(
    customBaseUrl = process.env.TPB_API_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'tpb',
    readonly name = 'ThePirateBay'
  ) {
    if (customBaseUrl) {
      this.endpoints = [customBaseUrl];
    } else {
      this.endpoints = [
        'https://apibay.org',
      ];
    }
  }

  private async fetchJson(path: string): Promise<any> {
    let lastError: Error | null = null;
    for (const base of this.endpoints) {
      try {
        const url = `${base}${path}`;
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(8000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
            'Accept': 'application/json',
          },
        });
        if (response.ok) {
          return await response.json();
        }
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new Error(`ThePirateBay API is temporarily unavailable (${lastError?.message || 'endpoint failed'}).`);
  }

  async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_TPB_IN_TESTS) {
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
      // Category 200 = Video (Movies, TV shows, HD, UHD)
      const data: ApibayItem[] = await this.fetchJson(`/q.php?q=${encodeURIComponent(cleanQuery)}&cat=200`);
      if (!Array.isArray(data)) return [];

      const releases: RawRelease[] = [];
      for (const item of data) {
        if (!item || !item.name || item.id === '0' || !item.info_hash) continue;
        const normalizedHash = item.info_hash.trim().toLowerCase();
        if (normalizedHash === '0000000000000000000000000000000000000000' || !/^[a-f0-9]{40}$/.test(normalizedHash)) {
          continue;
        }

        const sizeBytes = parseInt(item.size, 10);
        const seeders = parseInt(item.seeders, 10);

        releases.push({
          provider: this.id,
          name: item.name.trim(),
          infoHash: normalizedHash,
          magnet: `magnet:?xt=urn:btih:${normalizedHash}&dn=${encodeURIComponent(item.name.trim())}`,
          sizeBytes: Number.isSafeInteger(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
          seeders: Number.isFinite(seeders) ? Math.max(0, seeders) : 0,
          detailsUrl: `https://thepiratebay.org/description.php?id=${item.id}`,
        });
      }

      return releases;
    } catch (error) {
      console.warn(`[TpbProvider] Search failed for "${cleanQuery}": ${(error as Error).message}`);
      return [];
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const data = await this.fetchJson('/q.php?q=test&cat=200');
      const healthy = Array.isArray(data);
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: 'Invalid response from ThePirateBay API.' }),
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
