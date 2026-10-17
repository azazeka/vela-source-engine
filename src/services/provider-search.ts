import { MediaRequest, RawRelease } from '../types';
import { ReleaseIdentity } from './release-identity';

/** Bound the entire query fan-out so a slow fallback cannot discard earlier valid results. */
export class ProviderSearch {
  static async collect(request: MediaRequest, queries: string[], search: (query: string) => Promise<RawRelease[]>): Promise<RawRelease[]> {
    const found = new Map<string, RawRelease>();
    const planned = [...new Set(queries.filter(Boolean))].slice(0, 6);
    // Preserve movie-provider fallback behavior; episode queries must always include packs as well.
    if (request.type === 'movie') {
      let failed = 0;
      for (const query of planned) {
        try { const result = await search(query); if (result.length) return result; }
        catch { failed++; }
      }
      if (planned.length && failed === planned.length) throw new Error('Provider search is temporarily unavailable.');
      return [];
    }
    let failed = 0;
    await Promise.all(planned.map(async query => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const results = await Promise.race([search(query), new Promise<RawRelease[]>(resolve => {
          timer = setTimeout(() => resolve([]), 8500);
        })]);
        for (const release of results) {
          if (!ReleaseIdentity.matches(release.name, request)) continue;
          const hash = release.infoHash.toLowerCase();
          const existing = found.get(hash);
          if (!existing || release.seeders > existing.seeders) found.set(hash, release);
        }
      } catch { failed++; }
      finally { if (timer) clearTimeout(timer); }
    }));
    if (planned.length && failed === planned.length) throw new Error('Provider search is temporarily unavailable.');
    return [...found.values()].sort((a, b) => b.seeders - a.seeders || a.infoHash.localeCompare(b.infoHash));
  }
}
