import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

interface TorrentioStream {
  name?: string;
  title?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
  };
  sources?: string[];
}

interface TorrentioResponse {
  streams?: TorrentioStream[];
}

function parseSize(rawSize: string, rawUnit: string): number {
  const val = parseFloat(rawSize.replace(',', '.'));
  if (isNaN(val) || val <= 0) return 0;

  const unit = rawUnit.toLowerCase();
  const multipliers: Record<string, number> = {
    gb: 1024 * 1024 * 1024,
    gib: 1024 * 1024 * 1024,
    mb: 1024 * 1024,
    mib: 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
    tib: 1024 * 1024 * 1024 * 1024,
    kb: 1024,
    kib: 1024,
    b: 1,
    bytes: 1,
  };

  const multiplier = multipliers[unit] ?? 1;
  const bytes = Math.round(val * multiplier);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}

export class TorrentioProvider implements TorrentProvider {
  private readonly endpoints: string[];

  constructor(
    customBaseUrl = process.env.TORRENTIO_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'torrentio',
    readonly name = 'Torrentio'
  ) {
    if (customBaseUrl) {
      this.endpoints = [customBaseUrl];
    } else {
      this.endpoints = [
        'https://torrentio.strem.fun',
      ];
    }
  }

  private cleanImdbId(imdbId?: string): string | undefined {
    if (!imdbId) return undefined;
    const trimmed = imdbId.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('tt')) return trimmed;
    if (/^\d+$/.test(trimmed)) return `tt${trimmed}`;
    return trimmed;
  }

  private async fetchJson(path: string): Promise<TorrentioResponse> {
    let lastError: Error | null = null;
    for (const base of this.endpoints) {
      try {
        const url = `${base}${path}`;
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(3500),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
            'Accept': 'application/json',
          },
        });
        if (response.ok) {
          return (await response.json()) as TorrentioResponse;
        }
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new Error(`Torrentio API is temporarily unavailable (${lastError?.message || 'endpoint failed'}).`);
  }

  public parseStreams(streams: TorrentioStream[]): RawRelease[] {
    const releases: RawRelease[] = [];

    for (const s of streams) {
      if (!s || !s.infoHash) continue;
      const infoHash = s.infoHash.trim().toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(infoHash)) continue;

      const rawText = s.title ?? s.name ?? '';
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
      const name = lines[0] || s.behaviorHints?.filename || infoHash;

      let seeders = 0;
      let sizeBytes = 0;

      const seedMatch = rawText.match(/👤\s*(\d+)/i) || rawText.match(/seeds?:\s*(\d+)/i);
      if (seedMatch) {
        seeders = parseInt(seedMatch[1], 10);
      }

      const sizeMatch = rawText.match(/💾\s*([\d.,]+)\s*([a-zA-Z]+)/i) || rawText.match(/size:\s*([\d.,]+)\s*([a-zA-Z]+)/i);
      if (sizeMatch) {
        sizeBytes = parseSize(sizeMatch[1], sizeMatch[2]);
      }

      const trackerParams = Array.isArray(s.sources)
        ? s.sources
            .filter(src => src.startsWith('tracker:'))
            .map(src => `&tr=${encodeURIComponent(src.replace(/^tracker:/, ''))}`)
            .join('')
        : '';

      const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}${trackerParams}`;

      releases.push({
        provider: this.id,
        name,
        infoHash,
        magnet,
        sizeBytes,
        seeders: Number.isFinite(seeders) ? Math.max(0, seeders) : 0,
        detailsUrl: null,
      });
    }

    return releases;
  }

  async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_TORRENTIO_IN_TESTS && this.fetcher === fetch) {
      return [];
    }

    const imdbId = this.cleanImdbId(request.imdbId);
    if (!imdbId) return [];

    let path: string;
    if (request.type === 'movie') {
      path = `/stream/movie/${encodeURIComponent(imdbId)}.json`;
    } else {
      const season = request.season ?? 1;
      const episode = request.episode ?? 1;
      path = `/stream/series/${encodeURIComponent(imdbId)}:${season}:${episode}.json`;
    }

    try {
      const data = await this.fetchJson(path);
      if (!data || !Array.isArray(data.streams) || data.streams.length === 0) {
        return [];
      }
      return this.parseStreams(data.streams);
    } catch (err) {
      console.warn(`[Torrentio] search failed for ${imdbId}: ${(err as Error).message}`);
      return [];
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Test movie tt15239678 (Dune 2) or standard ping
      const res = await this.fetchJson('/stream/movie/tt15239678.json');
      const healthy = Array.isArray(res.streams) && res.streams.length > 0;
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: 'Torrentio returned no streams.' }),
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
