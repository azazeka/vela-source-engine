import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

function parseNyaaSize(rawVal: string, rawUnit: string): number {
  const val = parseFloat(rawVal.replace(',', '.'));
  if (isNaN(val) || val <= 0) return 0;
  const unit = rawUnit.toLowerCase();
  const multipliers: Record<string, number> = {
    tib: 1024 * 1024 * 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
    gib: 1024 * 1024 * 1024,
    gb: 1024 * 1024 * 1024,
    mib: 1024 * 1024,
    mb: 1024 * 1024,
    kib: 1024,
    kb: 1024,
    b: 1,
    bytes: 1,
  };
  const multiplier = multipliers[unit] ?? 1;
  const bytes = Math.round(val * multiplier);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}

export class NyaaProvider implements TorrentProvider {
  private readonly baseUrl: string;

  constructor(
    customBaseUrl = process.env.NYAA_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'nyaa',
    readonly name = 'Nyaa'
  ) {
    this.baseUrl = customBaseUrl || 'https://nyaa.si';
  }

  public parseReleasesFromRss(xml: string): RawRelease[] {
    const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi) || [];
    const releases: RawRelease[] = [];

    for (const item of items) {
      const rawTitle = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
      const hash = item.match(/<nyaa:infoHash>([a-f\d]{40})<\/nyaa:infoHash>/i)?.[1]?.toLowerCase();
      if (!rawTitle || !hash) continue;

      const name = rawTitle.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
      const seeders = parseInt(item.match(/<nyaa:seeders>(\d+)<\/nyaa:seeders>/i)?.[1] || '0', 10);
      const sizeMatch = item.match(/<nyaa:size>([\d.,]+)\s*([a-zA-Z]+)<\/nyaa:size>/i);
      const sizeBytes = sizeMatch ? parseNyaaSize(sizeMatch[1], sizeMatch[2]) : 0;
      const guid = item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim() || null;

      const magnet = `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}&tr=http://nyaa.tracker.wf:7777/announce&tr=udp://open.stealth.si:80/announce&tr=udp://tracker.opentrackr.org:1337/announce`;

      releases.push({
        provider: this.id,
        name,
        infoHash: hash,
        magnet,
        sizeBytes,
        seeders: Number.isFinite(seeders) ? Math.max(0, seeders) : 0,
        detailsUrl: guid,
      });
    }

    return releases;
  }

  async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_NYAA_IN_TESTS) {
      return [];
    }

    const title = (
      request.type === 'episode'
        ? (request.seriesTitle || request.originalTitle || request.title)
        : (request.originalTitle || request.title)
    ).replace(/[:\/\\?*|"<>]/g, ' ').replace(/\s+/g, ' ').trim();

    if (!title) return [];

    let query: string;
    if (request.type === 'episode') {
      const e = String(request.episode ?? 1).padStart(2, '0');
      query = `${title} - ${e}`;
    } else {
      query = `${title} ${request.year || ''}`.trim();
    }

    const url = `${this.baseUrl}/?page=rss&q=${encodeURIComponent(query)}&c=0_0&f=0`;

    try {
      const response = await this.fetcher(url, {
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
        },
      });

      if (!response.ok) return [];
      const xml = await response.text();
      return this.parseReleasesFromRss(xml);
    } catch {
      return [];
    }
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await this.fetcher(`${this.baseUrl}/?page=rss&q=test`, {
        signal: AbortSignal.timeout(8000),
      });
      const healthy = response.ok;
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: `Nyaa returned HTTP ${response.status}` }),
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
