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
    const value = alphabet.indexOf(char);
    if (value < 0) return undefined;
    bits += value.toString(2).padStart(5, '0');
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

export class RutorProvider implements TorrentProvider {
  private readonly mirrors: string[];

  constructor(
    customBaseUrl = process.env.RUTOR_URL?.trim(),
    private readonly fetcher: typeof fetch = fetch,
    readonly id = 'rutor',
    readonly name = 'Rutor'
  ) {
    if (customBaseUrl) {
      this.mirrors = [customBaseUrl];
    } else {
      this.mirrors = ['http://rutor.info', 'http://rutor.is', 'https://rutor.info', 'https://rutor.is'];
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
    throw new Error(`Rutor indexer is temporarily unavailable (${lastError?.message || 'mirrors unreachable'}).`);
  }

  public parseReleasesFromHtml(html: string, baseUrl: string): RawRelease[] {
    const releases: RawRelease[] = [];
    const rowRegex = /<tr class="(?:gai|tum)">([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1];
      const magnetMatch = row.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/i);
      if (!magnetMatch) continue;

      const magnet = magnetMatch[1];
      const infoHash = magnetHash(magnet);
      if (!infoHash) continue;

      const titleMatch = row.match(/<a href="(\/torrent\/\d+\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleMatch) continue;

      const detailsPath = titleMatch[1];
      const rawName = titleMatch[2];
      const name = decodeHtml(rawName.replace(/<[^>]+>/g, '')).trim();
      if (!name) continue;

      const sizeMatch = row.match(/<td align="right">([\d.,]+)&nbsp;([a-zA-Zа-яА-Я]+)<\/td>/i);
      const sizeBytes = sizeMatch ? parseSize(sizeMatch[1], sizeMatch[2]) : 0;

      const seedersMatch = row.match(/<span class="green">(?:<img[^>]*>)?&nbsp;(\d+)<\/span>/i);
      const seeders = seedersMatch ? parseInt(seedersMatch[1], 10) : 0;

      const fullDetailsUrl = detailsPath.startsWith('http') ? detailsPath : `${baseUrl}${detailsPath}`;

      releases.push({
        provider: this.id,
        name,
        infoHash,
        magnet,
        sizeBytes,
        seeders: Number.isFinite(seeders) ? Math.max(0, seeders) : 0,
        detailsUrl: fullDetailsUrl,
      });
    }

    return releases;
  }

  async search(request: MediaRequest): Promise<RawRelease[]> {
    if (process.env.NODE_ENV === 'test' && !process.env.ENABLE_RUTOR_IN_TESTS) {
      return [];
    }

    const title = (
      request.type === 'episode'
        ? (request.seriesTitle || request.title)
        : (request.title || request.originalTitle)
    ).replace(/[:\/\\?*|"<>]/g, ' ').replace(/\s+/g, ' ').trim();

    if (!title) return [];

    let query: string;
    if (request.type === 'episode') {
      const s = String(request.season ?? 1).padStart(2, '0');
      const e = String(request.episode ?? 1).padStart(2, '0');
      query = `${title} S${s}E${e}`;
    } else {
      query = request.originalTitle && request.originalTitle !== request.title
        ? `${request.title} ${request.originalTitle}`
        : `${title} ${request.year}`;
    }

    const path = `/search/0/0/0/0/${encodeURIComponent(query)}`;
    let result = await this.fetchHtml(path);
    let releases = this.parseReleasesFromHtml(result.html, result.mirror);

    // If exact SxxExx had no results for series, retry with season pack (e.g. S01)
    if (releases.length === 0 && request.type === 'episode') {
      const seasonQuery = `${title} S${String(request.season ?? 1).padStart(2, '0')}`;
      const seasonPath = `/search/0/0/0/0/${encodeURIComponent(seasonQuery)}`;
      try {
        result = await this.fetchHtml(seasonPath);
        releases = this.parseReleasesFromHtml(result.html, result.mirror);
      } catch {
        // Ignore fallback error
      }
    }

    // If combined movie search had no results, retry with just originalTitle or title
    if (releases.length === 0 && request.type === 'movie' && request.originalTitle && request.originalTitle !== request.title) {
      const fallbackPath = `/search/0/0/0/0/${encodeURIComponent(`${request.originalTitle} ${request.year}`)}`;
      try {
        result = await this.fetchHtml(fallbackPath);
        releases = this.parseReleasesFromHtml(result.html, result.mirror);
      } catch {
        // Ignore fallback error
      }
    }

    return releases;
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const { html } = await this.fetchHtml('/search/0/0/0/0/test');
      const healthy = html.includes('rutor') || html.includes('Результатов поиска');
      return {
        id: this.id,
        healthy,
        latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: 'Rutor returned unexpected HTML.' }),
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
