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
    гб: 1024 * 1024 * 1024,
    mb: 1024 * 1024,
    mib: 1024 * 1024,
    мб: 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
    tib: 1024 * 1024 * 1024 * 1024,
    тб: 1024 * 1024 * 1024 * 1024,
    kb: 1024,
    kib: 1024,
    кб: 1024,
    b: 1,
    bytes: 1,
  };

  const multiplier = multipliers[unit] ?? 1;
  const bytes = Math.round(val * multiplier);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}

export class GayTorrentRuProvider implements TorrentProvider {
  protected readonly mirrors: string[];
  protected readonly cookie: string;

  constructor(
    customBaseUrl = process.env.GAYTORRENT_URL?.trim(),
    cookie = process.env.GAYTORRENT_COOKIE?.trim() || process.env.GTR_COOKIE?.trim(),
    protected readonly fetcher: typeof fetch = fetch,
    readonly id = 'gaytorrent-ru',
    readonly name = 'GayTorrent.ru',
    readonly isAdult = true
  ) {
    this.cookie = cookie || '';
    if (customBaseUrl) {
      this.mirrors = [customBaseUrl];
    } else {
      this.mirrors = [
        'https://www.gaytor.rent',
        'https://gaytorrent.ru',
      ];
    }
  }

  protected async fetchHtml(path: string): Promise<{ html: string; mirror: string }> {
    let lastError: Error | null = null;
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
      'Referer': `${this.mirrors[0]}/search.php?view=legacy`,
    };
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    for (const mirror of this.mirrors) {
      try {
        const url = `${mirror}${path}`;
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(8000),
          headers,
        });
        if (response.ok) {
          const html = await response.text();
          return { html, mirror };
        }
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw new Error(`GayTorrent.ru indexer is temporarily unavailable (${lastError?.message || 'mirrors unreachable'}).`);
  }

  public parseReleasesFromHtml(html: string, baseUrl: string): RawRelease[] {
    const releases: RawRelease[] = [];

    // Rows in gaytor.rent: table#browsetable > tbody > tr.browse_row or tr
    const rowMatches = html.match(/<tr\b[^>]*class=["'][^"']*browse_row[^"']*["'][\s\S]*?<\/tr>/gi)
      || html.match(/<tr\b[^>]*id=["']torrent_\d+["'][\s\S]*?<\/tr>/gi)
      || html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)
      || [];

    for (const row of rowMatches) {
      // 1. Topic/Details link and title
      const detailsMatch = row.match(/<a\b[^>]*href=["'](?:details\.php\?id=|\.\/details\.php\?id=)?(\d+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!detailsMatch) continue;

      const torrentId = detailsMatch[1];
      const rawTitle = detailsMatch[2].replace(/<[^>]+>/g, '').trim();
      const name = decodeHtml(rawTitle);
      if (!name) continue;

      // 2. InfoHash / Magnet
      let magnet = '';
      let infoHash = '';

      const magnetMatch = row.match(/href=["'](magnet:\?[^"']+)["']/i);
      if (magnetMatch) {
        magnet = decodeHtml(magnetMatch[1]);
        const h = magnetHash(magnet);
        if (h) infoHash = h;
      }

      if (!infoHash) {
        const hashMatch = row.match(/(?:data-hash|data-info_hash|info_hash)=["']([a-f\d]{40})["']/i);
        if (hashMatch) {
          infoHash = hashMatch[1].toLowerCase();
          magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
        }
      }

      // If no hash in row, check for 40-hex hash in download link or comments
      if (!infoHash) {
        const genericHashMatch = row.match(/\b([a-f0-9]{40})\b/i);
        if (genericHashMatch) {
          infoHash = genericHashMatch[1].toLowerCase();
          magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
        }
      }

      // If still no hash, skip because TorBox requires infoHash
      if (!infoHash) continue;

      // 3. Size
      let sizeBytes = 0;
      const sizeMatch = row.match(/class=["'][^"']*size[^"']*["'][^>]*>([\d.,]+)\s*([a-zA-Zа-яА-Я]+)/i)
        || row.match(/\b([\d.,]+)\s*(GB|GiB|MB|MiB|TB|TiB|KB|KiB|ГБ|МБ|ТБ|КБ|bytes?)\b/i);
      if (sizeMatch) {
        sizeBytes = parseSize(sizeMatch[1], sizeMatch[2]);
      }

      // 4. Seeders
      let seeders = 0;
      const seedersMatch = row.match(/class=["'][^"']*seeds?[^"']*["'][^>]*><b>?(\d+)<?\/b?>?/i)
        || row.match(/class=["'][^"']*green[^"']*["'][^>]*><b>?(\d+)<?\/b?>?/i)
        || row.match(/title=["']Seeders["'][^>]*>(\d+)/i)
        || row.match(/align=["']right["'][^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>/i);
      if (seedersMatch) {
        seeders = parseInt(seedersMatch[1], 10);
      }

      const detailsUrl = `${baseUrl}/details.php?id=${torrentId}`;

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
    if (process.env.NODE_ENV === 'test' && this.fetcher === fetch) {
      return [];
    }

    const rawQuery = request.title?.trim() || request.originalTitle?.trim() || '';
    const isTrending = !rawQuery || rawQuery.toLowerCase() === 'trending' || rawQuery.toLowerCase() === 'popular';

    const path = isTrending
      ? `/search.php?search=&view=legacy&setview=1&incldead=0&page=0&orderby=seeds&sort=desc`
      : `/search.php?search=${encodeURIComponent(rawQuery)}&view=legacy&setview=1&incldead=1&inname=1&page=0&orderby=seeds&sort=desc`;

    try {
      const { html, mirror } = await this.fetchHtml(path);
      return this.parseReleasesFromHtml(html, mirror);
    } catch (err) {
      console.warn(`[GayTorrentRuProvider] Search failed for "${rawQuery}": ${(err as Error).message}`);
      return [];
    }
  }

  public async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const { html } = await this.fetchHtml('/');
      const healthy = html.includes('gaytor') || html.includes('GayTorrent') || html.includes('browsetable');
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: 'GayTorrent.ru returned unexpected response.' }),
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
