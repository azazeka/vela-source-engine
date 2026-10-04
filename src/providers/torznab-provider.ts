import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

function tag(item: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = item.match(new RegExp(`<(?:[\\w.-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}\\s*>`, 'i'));
  return match ? decodeXml(match[1]) : undefined;
}

function attribute(item: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = item.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, 'i'));
  if (!match) return undefined;
  return decodeXml(match[2] !== undefined ? match[2] : match[3]);
}

function torznabAttribute(item: string, name: string): string | undefined {
  const attrs = item.match(/<(?:[\w.-]+:)?attr\b[^>]*\/?\s*>/gi) ?? [];
  const element = attrs.find((entry) => attribute(entry, 'name')?.toLowerCase() === name.toLowerCase());
  return element ? attribute(element, 'value') : undefined;
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

export class TorznabProvider implements TorrentProvider {
  constructor(
    private readonly endpoint = process.env.TORZNAB_URL?.trim() ?? '',
    private readonly apiKey = process.env.TORZNAB_API_KEY?.trim() ?? '',
    private readonly fetcher: typeof fetch = fetch,
    private readonly categories = process.env.TORZNAB_CATEGORIES?.trim() ?? '',
    readonly id = 'torznab',
    readonly name = 'Torznab'
  ) {}

  private url(query?: string): URL {
    let url: URL;
    try { url = new URL(this.endpoint); } catch { throw new Error('Torznab endpoint is not configured.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Torznab endpoint must be an HTTP(S) URL without embedded credentials.');
    }
    if (this.apiKey && url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Torznab API keys require an HTTPS endpoint.');
    }
    url.searchParams.set('t', query === undefined ? 'caps' : 'search');
    if (query !== undefined) {
      url.searchParams.set('q', query);
      url.searchParams.set('limit', '100');
      if (this.categories) url.searchParams.set('cat', this.categories);
    }
    if (this.apiKey) url.searchParams.set('apikey', this.apiKey);
    return url;
  }

  private async get(url: URL): Promise<Response> {
    try {
      return await this.fetcher(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      // Fetch errors may include the URL, which can contain the indexer's API key.
      throw new Error('Torznab indexer is temporarily unavailable.');
    }
  }

  async search(request: MediaRequest): Promise<RawRelease[]> {
    if (!this.endpoint) return [];
    const rawTitle = request.type === 'episode' ? (request.seriesTitle || request.originalTitle || request.title) :
      (request.originalTitle || request.title);
    const title = rawTitle.replace(/[:\/\\?*|"<>]/g, ' ').replace(/\s+/g, ' ').trim();
    const query = request.type === 'episode'
      ? `${title} S${String(request.season ?? 1).padStart(2, '0')}E${String(request.episode ?? 1).padStart(2, '0')}`
      : `${title} ${request.year}`;
    const response = await this.get(this.url(query));
    if (!response.ok) throw new Error(`Torznab indexer returned HTTP ${response.status}.`);
    const xml = await response.text();
    if (xml.length > 2_000_000) throw new Error('Torznab response is too large.');
    let releases = this.parseReleasesFromXml(xml);

    // If no releases found, try searching with alternative title (e.g. localized Russian vs original English)
    if (releases.length === 0 && request.title && request.originalTitle) {
      const altTitleRaw = rawTitle === request.originalTitle ? request.title : request.originalTitle;
      const altTitle = altTitleRaw.replace(/[:\/\\?*|"<>]/g, ' ').replace(/\s+/g, ' ').trim();
      if (altTitle && altTitle.toLowerCase() !== title.toLowerCase()) {
        const altQuery = request.type === 'episode'
          ? `${altTitle} S${String(request.season ?? 1).padStart(2, '0')}E${String(request.episode ?? 1).padStart(2, '0')}`
          : `${altTitle} ${request.year}`;
        if (altQuery !== query) {
          try {
            const altResponse = await this.get(this.url(altQuery));
            if (altResponse.ok) {
              const altXml = await altResponse.text();
              releases = this.parseReleasesFromXml(altXml);
            }
          } catch {
            // Ignore secondary fallback errors
          }
        }
      }
    }

    return releases;
  }

  private parseReleasesFromXml(xml: string): RawRelease[] {
    const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi) ?? [];
    const releases: RawRelease[] = [];
    for (const item of items) {
      const name = tag(item, 'title');
      const enclosure = item.match(/<enclosure\b[^>]*\/?\s*>/i)?.[0];
      const candidateLink = [tag(item, 'link'), tag(item, 'guid'), enclosure && attribute(enclosure, 'url'),
        torznabAttribute(item, 'magneturl')].find(value => value?.startsWith('magnet:'));
      let hash = torznabAttribute(item, 'infohash') ?? (candidateLink ? magnetHash(candidateLink) : undefined);
      if (!hash) {
        const anyLink = [enclosure && attribute(enclosure, 'url'), tag(item, 'link'), tag(item, 'guid'),
          torznabAttribute(item, 'magneturl')].find(value => Boolean(value));
        if (anyLink) {
          const match = anyLink.match(/\b([a-f\d]{40}|[a-z2-7]{32})\b/i);
          if (match) {
            hash = magnetHash(`magnet:?xt=urn:btih:${match[1]}`);
          }
        }
      }
      const normalizedHash = hash ? magnetHash(`magnet:?xt=urn:btih:${hash}`) : undefined;
      if (!name || !normalizedHash) continue;
      let sizeValue = torznabAttribute(item, 'size') ?? tag(item, 'size') ??
        torznabAttribute(item, 'length') ??
        item.match(/<enclosure\b[^>]*\blength\s*=\s*(?:["']?(\d+)["']?)/i)?.[1];
      let size = Number(sizeValue);
      if (!Number.isSafeInteger(size) || size <= 0) {
        const desc = tag(item, 'description') ?? '';
        const sizeMatch = desc.match(/(?:size|размер)\s*:\s*([\d.,]+)\s*(gb|mb|tb|гб|мб|тб|bytes|b)/i);
        if (sizeMatch) {
          const val = parseFloat(sizeMatch[1].replace(',', '.'));
          const unit = sizeMatch[2].toLowerCase();
          const multipliers: Record<string, number> = {
            'gb': 1024 * 1024 * 1024,
            'гб': 1024 * 1024 * 1024,
            'mb': 1024 * 1024,
            'мб': 1024 * 1024,
            'tb': 1024 * 1024 * 1024 * 1024,
            'тб': 1024 * 1024 * 1024 * 1024,
            'b': 1,
            'bytes': 1
          };
          if (multipliers[unit]) {
            size = Math.round(val * multipliers[unit]);
          }
        }
      }

      const seedersVal = torznabAttribute(item, 'seeders') ??
        torznabAttribute(item, 'seeds') ??
        tag(item, 'seeders') ??
        (tag(item, 'description') ?? '').match(/(?:seeders?|seeds?|раздают|сиды)\s*:\s*(\d+)/i)?.[1];
      const seeders = Number(seedersVal);

      releases.push({
        provider: this.id,
        name,
        infoHash: normalizedHash,
        magnet: candidateLink ?? `magnet:?xt=urn:btih:${normalizedHash}&dn=${encodeURIComponent(name)}`,
        sizeBytes: Number.isSafeInteger(size) && size > 0 ? size : 0,
        seeders: Number.isFinite(seeders) ? Math.max(0, seeders) : 0,
        detailsUrl: tag(item, 'comments') ?? tag(item, 'guid') ?? null,
      });
    }
    return releases;
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    if (!this.endpoint) return { id: this.id, healthy: false, latencyMs: 0, error: 'Torznab endpoint is not configured.' };
    try {
      const response = await this.get(this.url());
      const xml = await response.text();
      const healthy = response.ok && /<(?:[\w.-]+:)?caps\b/i.test(xml);
      return { id: this.id, healthy, latencyMs: Date.now() - start,
        ...(healthy ? {} : { error: `Torznab indexer returned HTTP ${response.status} or invalid capabilities.` }) };
    } catch (error) {
      return { id: this.id, healthy: false, latencyMs: Date.now() - start, error: (error as Error).message };
    }
  }
}

export interface TorznabIndexerConfig {
  id?: string;
  name?: string;
  url: string;
  apiKey?: string;
  categories?: string;
}

export function createConfiguredTorznabProviders(
  rawConfig = process.env.TORZNAB_INDEXERS_JSON
): TorznabProvider[] {
  if (rawConfig?.trim()) {
    let entries: unknown;
    try { entries = JSON.parse(rawConfig); }
    catch { throw new Error('TORZNAB_INDEXERS_JSON must be a valid JSON array.'); }
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('TORZNAB_INDEXERS_JSON must contain at least one indexer.');
    }
    return entries.map((entry: any, index: number) => {
      if (!entry || typeof entry.url !== 'string' || !entry.url.trim()) {
        throw new Error(`Torznab indexer ${index + 1} must have a URL.`);
      }
      const id = typeof entry.id === 'string' && /^[a-z\d_-]{1,40}$/i.test(entry.id)
        ? `torznab-${entry.id}` : `torznab-${index + 1}`;
      const name = typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim().slice(0, 80) : `Torznab ${index + 1}`;
      return new TorznabProvider(entry.url.trim(), typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '',
        fetch, typeof entry.categories === 'string' ? entry.categories.trim() : '', id, name);
    });
  }
  if (process.env.TORZNAB_URL?.trim()) return [new TorznabProvider()];

  // Keep the offline test suite deterministic; production deployments use the
  // public defaults unless they provide an explicit custom configuration.
  if (process.env.NODE_ENV === 'test') return [];

  // These public endpoints document anonymous Torznab access. Keep this list
  // small and explicit: media search terms are sent to each configured source.
  return [
    new TorznabProvider('https://anibt.net/torznab/api', '', fetch, '5070', 'torznab-anibt', 'AniBT'),
    new TorznabProvider('https://www.torlock.com/torznab/api', '', fetch, '', 'torznab-torlock', 'Torlock'),
  ];
}
