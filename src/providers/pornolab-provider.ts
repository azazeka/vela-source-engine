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
    гб: 1024 * 1024 * 1024,
    mb: 1024 * 1024,
    мб: 1024 * 1024,
    tb: 1024 * 1024 * 1024 * 1024,
    тб: 1024 * 1024 * 1024 * 1024,
    kb: 1024,
    кб: 1024,
    b: 1,
    bytes: 1,
  };

  const multiplier = multipliers[unit] ?? 1;
  const bytes = Math.round(val * multiplier);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0;
}

export class PornolabProvider implements TorrentProvider {
  private readonly mirrors: string[];
  private readonly cookie: string;

  constructor(
    customBaseUrl = process.env.PORNOLAB_URL?.trim(),
    cookie = process.env.PORNOLAB_COOKIE?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'pornolab',
    readonly name = 'Pornolab',
    readonly isAdult = true
  ) {
    this.cookie = cookie || '';
    if (customBaseUrl) {
      this.mirrors = [customBaseUrl];
    } else {
      this.mirrors = [
        'https://pornolab.net',
        'https://pornolab.cc',
      ];
    }
  }

  private async fetchHtml(path: string): Promise<{ html: string; mirror: string }> {
    let lastError: Error | null = null;
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
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
    throw new Error(`Pornolab indexer is temporarily unavailable (${lastError?.message || 'mirrors unreachable'}).`);
  }

  public parseReleasesFromHtml(html: string, baseUrl: string): RawRelease[] {
    const releases: RawRelease[] = [];

    // Pornolab uses TorrentPier: table rows have class hl-tr or tCenter
    const rowMatches = html.match(/<tr\b[^>]*class=["'][^"']*hl-tr[^"']*["'][\s\S]*?<\/tr>/gi)
      || html.match(/<tr\b[^>]*id=["']tor-\d+["'][\s\S]*?<\/tr>/gi)
      || [];

    for (const row of rowMatches) {
      // 1. Topic link and title
      const titleMatch = row.match(/<a\b[^>]*class=["'][^"']*tt-text[^"']*["'][^>]*href=["'](?:viewtopic\.php\?t=|\.\/viewtopic\.php\?t=)?(\d+)["'][^>]*>([\s\S]*?)<\/a>/i)
        || row.match(/<a\b[^>]*href=["'](?:viewtopic\.php\?t=|\.\/viewtopic\.php\?t=)?(\d+)["'][^>]*class=["'][^"']*tt-text[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
        || row.match(/<a\b[^>]*href=["'](?:viewtopic\.php\?t=|\.\/viewtopic\.php\?t=)?(\d+)["'][^>]*>([\s\S]*?)<\/a>/i);

      if (!titleMatch) continue;

      const topicId = titleMatch[1];
      const rawTitle = titleMatch[2].replace(/<[^>]+>/g, '').trim();
      const name = decodeHtml(rawTitle);
      if (!name) continue;

      // 2. Magnet link or hash
      let magnet = '';
      let infoHash = '';

      const magnetMatch = row.match(/href=["'](magnet:\?[^"']+)["']/i);
      if (magnetMatch) {
        magnet = decodeHtml(magnetMatch[1]);
        const h = magnetHash(magnet);
        if (h) infoHash = h;
      }

      // If no direct magnet in table row, look for data-topic_hash or hash attribute
      if (!infoHash) {
        const hashMatch = row.match(/(?:data-topic_hash|data-hash|info_hash)=["']([a-f\d]{40})["']/i);
        if (hashMatch) {
          infoHash = hashMatch[1].toLowerCase();
          magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}&tr=http://bt.pornolab.net/ann`;
        }
      }

      // If no hash in row, skip since we can't create stream without infoHash
      if (!infoHash) continue;

      // 3. Size
      let sizeBytes = 0;
      const dataSizeMatch = row.match(/data-ts_text=["'](\d+)["']/i);
      if (dataSizeMatch) {
        sizeBytes = parseInt(dataSizeMatch[1], 10);
      } else {
        const textSizeMatch = row.match(/<a\b[^>]*class=["'][^"']*tr-dl[^"']*["'][^>]*>([\d.,]+)\s*([a-zA-Zа-яА-Я]+)<\/a>/i)
          || row.match(/(?:size|размер)[^>]*>([\d.,]+)\s*([a-zA-Zа-яА-Я]+)/i);
        if (textSizeMatch) {
          sizeBytes = parseSize(textSizeMatch[1], textSizeMatch[2]);
        }
      }

      // 4. Seeders
      let seeders = 0;
      const seedersMatch = row.match(/class=["'][^"']*seedmed[^"']*["'][^>]*><b>(\d+)<\/b>/i)
        || row.match(/class=["'][^"']*seedmed[^"']*["'][^>]*><u>(\d+)<\/u>/i)
        || row.match(/class=["'][^"']*seedmed[^"']*["'][^>]*>(\d+)</i)
        || row.match(/<b\b[^>]*class=["'][^"']*seed[^"']*["'][^>]*>(\d+)<\/b>/i);
      if (seedersMatch) {
        seeders = parseInt(seedersMatch[1], 10);
      }

      const detailsUrl = `${baseUrl}/forum/viewtopic.php?t=${topicId}`;

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
    const rawQuery = request.title?.trim() || request.originalTitle?.trim() || '';
    if (!rawQuery) return [];

    const path = `/forum/tracker.php?nm=${encodeURIComponent(rawQuery)}`;

    try {
      const { html, mirror } = await this.fetchHtml(path);
      return this.parseReleasesFromHtml(html, mirror);
    } catch (err) {
      console.warn(`[PornolabProvider] Search failed for "${rawQuery}": ${(err as Error).message}`);
      return [];
    }
  }

  public async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const { html } = await this.fetchHtml('/forum/index.php');
      const healthy = html.includes('pornolab') || html.includes('TorrentPier');
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: 'Pornolab returned unexpected HTML response.' }),
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
