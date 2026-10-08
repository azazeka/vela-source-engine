import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

interface EztvTorrent {
  id: number;
  hash: string;
  filename: string;
  episode_url?: string;
  torrent_url?: string;
  magnet_url?: string;
  title: string;
  imdb_id?: string;
  season?: string;
  episode?: string;
  seeds?: number;
  peers?: number;
  size_bytes?: string | number;
}

interface EztvResponse {
  imdb_id?: string;
  torrents_count?: number;
  limit?: number;
  page?: number;
  torrents?: EztvTorrent[];
}

export class EztvProvider implements TorrentProvider {
  private readonly endpoints: string[];

  constructor(
    customBaseUrl = process.env.EZTV_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'eztv',
    readonly name = 'EZTV'
  ) {
    if (customBaseUrl) {
      this.endpoints = [customBaseUrl];
    } else {
      this.endpoints = [
        'https://eztv.re/api',
        'https://eztv.wf/api',
        'https://eztv.tf/api',
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
    throw new Error(`EZTV API is temporarily unavailable (${lastError?.message || 'endpoint failed'}).`);
  }

  async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_EZTV_IN_TESTS) {
      return [];
    }

    // EZTV is TV-shows only
    if (request.type !== 'episode') {
      return [];
    }

    const seriesTitle = (request.seriesTitle || request.originalTitle || request.title || '')
      .replace(/[:\/\\?*|"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!seriesTitle) return [];

    try {
      const data: EztvResponse = await this.fetchJson(`/get-torrents?search=${encodeURIComponent(seriesTitle)}&limit=100`);
      if (!data || !Array.isArray(data.torrents)) return [];

      const targetSeason = request.season ?? 1;
      const targetEpisode = request.episode ?? 1;
      const seasonPadded = String(targetSeason).padStart(2, '0');
      const episodePadded = String(targetEpisode).padStart(2, '0');
      const epPattern = new RegExp(`S${seasonPadded}E${episodePadded}|\\b${targetSeason}x${episodePadded}\\b`, 'i');

      const releases: RawRelease[] = [];
      for (const item of data.torrents) {
        if (!item || !item.hash || !item.title) continue;

        const normalizedHash = item.hash.trim().toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(normalizedHash)) continue;

        const releaseName = item.filename || item.title;
        // Filter for specific episode if requested
        if (!epPattern.test(releaseName)) {
          // Check if it's explicitly matched by item properties
          const itemS = parseInt(item.season || '0', 10);
          const itemE = parseInt(item.episode || '0', 10);
          if (itemS !== targetSeason || itemE !== targetEpisode) {
            continue;
          }
        }

        const size = typeof item.size_bytes === 'string' ? parseInt(item.size_bytes, 10) : Number(item.size_bytes);
        const seeds = Number(item.seeds ?? 0);

        releases.push({
          provider: this.id,
          name: releaseName.trim(),
          infoHash: normalizedHash,
          magnet: item.magnet_url || `magnet:?xt=urn:btih:${normalizedHash}&dn=${encodeURIComponent(releaseName.trim())}`,
          sizeBytes: Number.isSafeInteger(size) && size > 0 ? size : 0,
          seeders: Number.isFinite(seeds) ? Math.max(0, seeds) : 0,
          detailsUrl: item.episode_url || null,
        });
      }

      return releases;
    } catch (error) {
      console.warn(`[EztvProvider] Search failed for "${seriesTitle}": ${(error as Error).message}`);
      return [];
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.fetchJson('/get-torrents?limit=1');
      return {
        id: this.id,
        healthy: true,
        latencyMs: Date.now() - start,
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
