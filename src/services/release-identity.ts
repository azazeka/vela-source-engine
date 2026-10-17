import { MediaRequest } from '../types';

/** Search results are suggestions; prove the title before issuing a playback URL. */
export class ReleaseIdentity {
  static seasonRangeContains(name: string, season: number): boolean {
    const clean = name.replace(/_/g, ' ');
    const match = /\bs(\d{1,2})\s*[-–]\s*s?(\d{1,2})\b/i.exec(clean)
      ?? /(?:seasons?|сезоны?)\s*(\d{1,2})\s*[-–]\s*(\d{1,2})/i.exec(clean)
      ?? /(?:^|[^\d])(\d{1,2})\s*[-–]\s*(\d{1,2})\s*сезон/i.exec(clean);
    return !!match && Number(match[1]) <= season && season <= Number(match[2]);
  }
  static releaseGroup(name: string): string | undefined {
    const group = /-([a-z0-9]+)(?:\.(?:mkv|mp4|avi|m4v))?$/i.exec(name)?.[1].toLowerCase();
    return group && !['dl', 'rip', 'ray', 'web'].includes(group) ? group : undefined;
  }

  private static normalizeCache = new Map<string, string>();
  private static readonly MAX_NORMALIZE_CACHE = 5000;

  static clearCache(): void {
    this.normalizeCache.clear();
  }

  static normalize(value: string): string {
    const cached = ReleaseIdentity.normalizeCache.get(value);
    if (cached !== undefined) return cached;

    const normalized = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

    if (ReleaseIdentity.normalizeCache.size >= ReleaseIdentity.MAX_NORMALIZE_CACHE) {
      const firstKey = ReleaseIdentity.normalizeCache.keys().next().value;
      if (firstKey) ReleaseIdentity.normalizeCache.delete(firstKey);
    }
    ReleaseIdentity.normalizeCache.set(value, normalized);
    return normalized;
  }

  static matches(name: string, request: MediaRequest): boolean {
    const aliases = [...new Set([request.title, request.originalTitle, request.seriesTitle]
      .filter((v): v is string => !!v?.trim()).map(this.normalize))];
    const clean = name.replace(/^(?:\s*\[[^\]]+\]\s*)+/, '').replace(/_/g, ' ');
    const value = this.normalize(clean.replace(/\.(mkv|mp4|m4v|avi|mov|webm|ts)$/i, ''));
    const titles = [...aliases, ...aliases.flatMap(a => aliases.filter(b => a !== b).map(b => `${a} ${b}`))];
    return titles.some(title => {
      if (value === title) return true;
      if (!value.startsWith(title + ' ')) return false;
      const suffix = value.slice(title.length + 1);
      if (!/^(?:s\d{1,2}(?:e\d+)?|\d{1,2}x\d+|e\d+|ep\d+|seasons? \d+|сезоны? \d+|\d+(?: \d+)? сезоны?|complete(?: series)?|all seasons|collection|полный сериал|все сезоны|(?:19|20)\d{2}|2160p|1080[pi]|720p|480p|uhd|bluray|blu ray|web dl|webrip|hdtv)(?: |$)/iu.test(suffix)) return false;
      const year = /^(19\d{2}|20\d{2})(?: |$)/.exec(suffix);
      return !request.year || !year || Number(year[1]) === request.year;
    });
  }

  static fileMatches(name: string, request: MediaRequest): boolean {
    if (request.type !== 'episode') return true;
    const base = name.replace(/\\/g, '/').split('/').pop()!.replace(/_/g, ' ');
    if (/^(?:s\d+[ .-]*e\d+|\d+x\d+|(?:e|ep|episode|серия)[ .-]*\d+|\d+)(?:\b|[ .-])/i.test(base)) return true;
    if (!/(?:^|[^a-z0-9])(?:s\d+[ .-]*e\d+|\d+x\d+|e\d+)(?:\b|[ .-])/i.test(base)) return true;
    return this.matches(base, request);
  }
}
