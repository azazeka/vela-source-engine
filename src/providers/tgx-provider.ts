import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function magnetHash(value: string): string | undefined {
  const match = value.match(/(?:[?&])xt=urn:btih:([a-f\d]{40}|[a-z2-7]{32})(?:&|$)/i);
  if (!match) return undefined;
  const hash = match[1].toLowerCase();
  if (/^[a-f\d]{40}$/.test(hash)) return hash;

  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = '';
  for (const char of hash) {
    const val = alphabet.indexOf(char);
    if (val < 0) return undefined;
    bits += val.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    hex += parseInt(bits.slice(index, index + 8), 2).toString(16).padStart(2, '0');
  }
  return hex.length === 40 ? hex : undefined;
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

export class TgxProvider implements TorrentProvider {
  private readonly mirrors: string[];

  constructor(
    customBaseUrl = process.env.TGX_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'tgx',
    readonly name = 'TorrentGalaxy'
  ) {
    if (customBaseUrl) {
      this.mirrors = [customBaseUrl];
    } else {
      this.mirrors = [
        'https://torrentgalaxy.to',
        'https://torrentgalaxy.mx',
        'https://tgx.rs',
      ];
    }
  }

  private async fetchHtml(path: string): Promise<{ html: string; mirror: string }> {
    let lastError: Error | null = null;
    for (const mirror of this.mirrors) {
      try {
        const url = `${mirror}${path}`;
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(8000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
          },
        });
        if (response.ok) {
          const html = await response.text();
          return { html, mirror };
        }
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new Error(`TorrentGalaxy indexer is temporarily unavailable (${lastError?.message || 'mirrors unreachable'}).`);
  }

  public parseReleasesFromHtml(html: string, baseUrl: string): RawRelease[] {
    const releases: RawRelease[] = [];

    const chunks = html.split(/<div[^>]*class=["'][^"']*tgxtablerow[^"']*["']/i).slice(1);
    const rowMatches = chunks.length > 0
      ? chunks
      : (html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []);

    for (const row of rowMatches) {
      const magnetMatch = row.match(/href=["'](magnet:\?[^"']+)["']/i);
      if (!magnetMatch) continue;

      const magnet = decodeHtml(magnetMatch[1]);
      const infoHash = magnetHash(magnet);
      if (!infoHash) continue;

      let name = '';
      const txlightMatch = row.match(/<a[^>]*class=["'][^"']*txlight[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
      if (txlightMatch) {
        name = decodeHtml(txlightMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (!name) {
        const titleAttrMatch = row.match(/<a[^>]*href=["']\/torrent\/[^"']+["'][^>]*title=["']([^"']+)["']/i);
        if (titleAttrMatch) {
          name = decodeHtml(titleAttrMatch[1].trim());
        }
      }
      if (!name) {
        const dnMatch = magnet.match(/[?&]dn=([^&]+)/i);
        if (dnMatch) {
          try {
            name = decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
          } catch {
            name = dnMatch[1];
          }
        }
      }
      if (!name) continue;

      let detailsUrl: string | null = null;
      const detailMatch = row.match(/href=["'](\/torrent\/[^"']+)["']/i);
      if (detailMatch) {
        detailsUrl = `${baseUrl}${detailMatch[1]}`;
      }

      let sizeBytes = 0;
      const sizeMatch = row.match(/(?:badge[^>]*>|Size:\s*)([\d.,]+)\s*([a-zA-Z]+)/i);
      if (sizeMatch) {
        sizeBytes = parseSize(sizeMatch[1], sizeMatch[2]);
      }

      let seeders = 0;
      const seedersMatch = row.match(/(?:color=["']?green["']?[^>]*>|style=["'][^"']*color:\s*green[^"']*["'][^>]*>)\s*<b>(\d+)<\/b>/i)
        || row.match(/<font\b[^>]*color=["']?green["']?[^>]*>(\d+)<\/font>/i)
        || row.match(/title=["']Seeders["'][^>]*>(\d+)/i);
      if (seedersMatch) {
        seeders = parseInt(seedersMatch[1], 10);
      }

      releases.push({
        provider: this.id,
        name,
        infoHash,
        magnet,
        sizeBytes,
        seeders: Number.isFinite(seeders) ? Math.max(0, seeders) : 0,
        detailsUrl,
      });
    }

    return releases;
  }

  public async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_TGX_IN_TESTS) {
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

    const cleanQuery = query.replace(/[:\/\\?*|"<>]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanQuery) return [];

    // Mainstream movies & TV packs/episodes categories on TGX:
    // c3=1 (Movies 4K UHD), c42=1 (Movies HD), c1=1 (Movies SD), c41=1 (TV HD), c5=1 (TV SD), c11=1 (TV Packs)
    const mediaCats = 'c3=1&c42=1&c1=1&c41=1&c5=1&c11=1';
    const path = `/torrents.php?search=${encodeURIComponent(cleanQuery)}&${mediaCats}&sort=seeders&order=desc`;

    try {
      const { html, mirror } = await this.fetchHtml(path);
      return this.parseReleasesFromHtml(html, mirror);
    } catch (err) {
      console.warn(`[TgxProvider] Search failed for "${cleanQuery}": ${(err as Error).message}`);
      return [];
    }
  }

  public async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const { html } = await this.fetchHtml('/torrents.php?c3=1&c42=1');
      const healthy = html.includes('tgxtable') || html.includes('tgxtablerow') || html.includes('TorrentGalaxy');
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: 'TorrentGalaxy returned unexpected HTML response.' }),
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
