import { MediaRequest } from '../types';

export class QueryBuilder {
  public static buildQueries(request: MediaRequest): string[] {
    const queries = new Set<string>();

    if (request.type === 'movie') {
      const cleanTitle = this.cleanTitle(request.title);
      const cleanOrig = this.cleanTitle(request.originalTitle);

      queries.add(`${cleanTitle} ${request.year}`);
      if (cleanOrig && cleanOrig.toLowerCase() !== cleanTitle.toLowerCase()) {
        queries.add(`${cleanOrig} ${request.year}`);
      }
      queries.add(cleanTitle);
    } else if (request.type === 'episode') {
      const seriesTitle = this.cleanTitle(request.seriesTitle || request.title);
      const season = request.season ?? 1;
      const episode = request.episode ?? 1;

      const sPad = String(season).padStart(2, '0');
      const ePad = String(episode).padStart(2, '0');

      // 1. Precise episode query: e.g. "Silo S02E04"
      queries.add(`${seriesTitle} S${sPad}E${ePad}`);
      // 2. Alt episode query: e.g. "Silo 2x04"
      queries.add(`${seriesTitle} ${season}x${ePad}`);
      // 3. Season pack query: e.g. "Silo S02"
      queries.add(`${seriesTitle} S${sPad}`);
    }

    return Array.from(queries);
  }

  private static cleanTitle(title: string): string {
    return title
      .replace(/[:\/\\?*|"<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
