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

export class TpbAdultProvider implements TorrentProvider {
  private readonly endpoints: string[];

  constructor(
    customBaseUrl = process.env.TPB_API_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'tpb-adult',
    readonly name = 'ThePirateBay XXX',
    readonly isAdult = true
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

    const query = (request.title || request.originalTitle || '')
      .replace(/[:\/\\?*|"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!query) return [];

    try {
      // Category 500 = Porn
      const data: ApibayItem[] = await this.fetchJson(`/q.php?q=${encodeURIComponent(query)}&cat=500`);
      if (!Array.isArray(data)) return [];

      const isGaySearch = /\b(gay|belami|seancody|sean cody|falcon|lucas|raging stallion|cockyboys|corbin|helix|timtales|men\.com)\b/i.test(query);
      const femaleExcludePattern = /\b(milf|female|lesbian|pussy|tits|boobs|stepmom|stepsister|shemale)\b/i;

      const releases: RawRelease[] = [];
      for (const item of data) {
        if (!item || !item.name || item.id === '0' || !item.info_hash) continue;
        if (isGaySearch && femaleExcludePattern.test(item.name)) continue;
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
      console.warn(`[TpbAdultProvider] Search failed for "${query}": ${(error as Error).message}`);
      return [];
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const data = await this.fetchJson('/q.php?q=test&cat=500');
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
