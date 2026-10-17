import { MediaRequest } from '../types';

export interface SeriesTitles {
  primary: string;
  original?: string;
  cyrillic?: string;
  latin?: string;
  all: string[];
}

export class QueryBuilder {
  static getEpisodeSearchQueries(request: MediaRequest): string[] {
    const title = this.cleanTitle(this.getEnglishOrOriginalTitle(request));
    const alternate = this.cleanTitle(request.title);
    const season = String(request.season ?? 1).padStart(2, '0');
    const episode = String(request.episode ?? 1).padStart(2, '0');
    return [...new Set([
      `${title} S${season}E${episode}`, `${title} S${season}`, `${title} complete`, title,
      ...(alternate && alternate.toLowerCase() !== title.toLowerCase() ? [`${alternate} S${season}`, alternate] : [])
    ])].filter(q => !!title && !!q);
  }
  public static cleanTitle(title?: string): string {
    if (!title) return '';
    return title
      .replace(/[:\/\\?*|"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public static getTitles(request: MediaRequest): SeriesTitles {
    const rawCandidates = [
      request.seriesTitle,
      request.title,
      request.originalTitle,
    ].filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

    const seen = new Set<string>();
    const all: string[] = [];
    let cyrillic: string | undefined;
    let latin: string | undefined;

    for (const raw of rawCandidates) {
      const cleaned = this.cleanTitle(raw);
      if (!cleaned) continue;
      const lower = cleaned.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        all.push(cleaned);
        if (/[\u0400-\u04FF]/i.test(cleaned)) {
          if (!cyrillic) cyrillic = cleaned;
        } else {
          if (!latin) latin = cleaned;
        }
      }
    }

    const primary = all[0] || '';
    const cleanOrig = this.cleanTitle(request.originalTitle);
    const original = cleanOrig && cleanOrig.toLowerCase() !== primary.toLowerCase() ? cleanOrig : undefined;

    return { primary, original, cyrillic, latin, all };
  }

  /**
   * Returns the best Latin/English title for Western indexers (TPB, TGX, EZTV, BitSearch, Torznab).
   * Prioritizes non-Cyrillic originalTitle or Latin series title if the primary title is localized in Cyrillic.
   */
  public static getEnglishOrOriginalTitle(request: MediaRequest): string {
    const { latin, primary, original } = this.getTitles(request);
    if (latin) return latin;
    if (original && !/[\u0400-\u04FF]/.test(original)) return original;
    return primary;
  }

  /**
   * Prioritized list of episode and season queries tailored for Russian indexers (e.g. Rutor).
   */
  public static getRussianEpisodeQueries(request: MediaRequest): string[] {
    const queries = new Set<string>();
    const { cyrillic, latin, primary } = this.getTitles(request);
    const season = request.season ?? 1;
    const episode = request.episode ?? 1;
    const sPad = String(season).padStart(2, '0');
    const ePad = String(episode).padStart(2, '0');

    if (cyrillic) {
      // 1. Russian season format: "Укрытие 2 сезон" / "Укрытие сезон 2"
      queries.add(`${cyrillic} ${season} сезон`);
      queries.add(`${cyrillic} сезон ${season}`);
      // 2. Bilingual format: "Укрытие Silo"
      if (latin) {
        queries.add(`${cyrillic} ${latin}`);
        queries.add(`${cyrillic} ${latin} ${season} сезон`);
      }
      // 3. Precise SxxExx and Sxx
      queries.add(`${cyrillic} S${sPad}E${ePad}`);
      queries.add(`${cyrillic} S${sPad}`);
    }

    if (latin) {
      queries.add(`${latin} S${sPad}E${ePad}`);
      queries.add(`${latin} S${sPad}`);
      queries.add(`${latin} ${season} сезон`);
    }

    if (!cyrillic && !latin && primary) {
      queries.add(`${primary} S${sPad}E${ePad}`);
      queries.add(`${primary} S${sPad}`);
    }

    return Array.from(queries);
  }

  public static buildQueries(request: MediaRequest): string[] {
    const queries = new Set<string>();

    if (request.type === 'movie') {
      const cleanTitle = this.cleanTitle(request.title);
      const cleanOrig = this.cleanTitle(request.originalTitle);

      if (cleanTitle) {
        if (request.year) queries.add(`${cleanTitle} ${request.year}`);
        queries.add(cleanTitle);
      }

      if (cleanOrig && cleanOrig.toLowerCase() !== cleanTitle.toLowerCase()) {
        if (request.year) queries.add(`${cleanOrig} ${request.year}`);
        queries.add(cleanOrig);
      }

      // Bilingual movie query for Russian indexers if Cyrillic + Latin exist
      const isCyrillic = /[\u0400-\u04FF]/i.test(cleanTitle);
      const origIsLatin = !/[\u0400-\u04FF]/i.test(cleanOrig);
      if (isCyrillic && origIsLatin && cleanOrig) {
        queries.add(`${cleanTitle} ${cleanOrig}`);
        if (request.year) queries.add(`${cleanTitle} ${cleanOrig} ${request.year}`);
      }
    } else if (request.type === 'episode') {
      const { all, cyrillic, latin } = this.getTitles(request);
      const season = request.season ?? 1;
      const episode = request.episode ?? 1;

      const sPad = String(season).padStart(2, '0');
      const ePad = String(episode).padStart(2, '0');

      for (const title of all) {
        // 1. Precise episode query: e.g. "Silo S02E04"
        queries.add(`${title} S${sPad}E${ePad}`);
        // 2. Alt episode query: e.g. "Silo 2x04"
        queries.add(`${title} ${season}x${ePad}`);
        // 3. Season pack query: e.g. "Silo S02"
        queries.add(`${title} S${sPad}`);
        // 4. Word-based season: e.g. "Silo Season 2"
        queries.add(`${title} Season ${season}`);

        // 5. Russian localization queries if Cyrillic
        if (/[\u0400-\u04FF]/i.test(title)) {
          queries.add(`${title} ${season} сезон`);
          queries.add(`${title} Сезон ${season}`);
        }
      }

      // 6. Bilingual combinations (e.g. "Укрытие Silo")
      if (cyrillic && latin) {
        queries.add(`${cyrillic} ${latin}`);
        queries.add(`${cyrillic} ${latin} S${sPad}`);
        queries.add(`${cyrillic} ${latin} ${season} сезон`);
      }
    }

    return Array.from(queries);
  }
}
