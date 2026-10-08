import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface TasteProfile {
  feedback: Record<string, unknown>;
  watchlist: unknown[];
  history: unknown[];
  moviesOnly: boolean;
  hideWatched: boolean;
  updatedAt: number;
}

// Store only catalog data, never credentials or playback URLs.
export function validateTasteProfile(value: any): TasteProfile {
  if (!value || typeof value !== 'object' || !Array.isArray(value.watchlist) || !Array.isArray(value.history)
      || !value.feedback || typeof value.feedback !== 'object' || Array.isArray(value.feedback)
      || typeof value.moviesOnly !== 'boolean' || typeof value.hideWatched !== 'boolean'
      || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) throw new Error('Invalid profile');
  if (value.watchlist.length > 500 || value.history.length > 1000 || Object.keys(value.feedback).length > 1000) throw new Error('Profile too large');
  const item = (input: any): Record<string, unknown> => {
    if (!input || !Number.isInteger(input.id) || input.id <= 0 || !['movie', 'tv'].includes(input.mediaType)
        || typeof input.title !== 'string' || input.title.length > 500) throw new Error('Invalid catalog item');
    const allowed = ['id', 'mediaType', 'title', 'originalTitle', 'overview', 'posterPath', 'backdropPath', 'releaseYear', 'voteAverage', 'genreIds'];
    return Object.fromEntries(allowed.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  };
  const feedback = Object.fromEntries(Object.entries(value.feedback).map(([key, raw]: [string, any]) => {
    const catalog = item(raw?.item);
    if (key !== `${catalog.mediaType}:${catalog.id}` || (raw.opinion != null && !['liked', 'notInterested'].includes(raw.opinion)) || typeof raw.watched !== 'boolean') throw new Error('Invalid feedback');
    return [key, { item: catalog, opinion: raw.opinion ?? null, watched: raw.watched }];
  }));
  const history = value.history.map((raw: any) => {
    if (!raw || !Number.isInteger(raw.tmdbId) || raw.tmdbId <= 0 || !['movie', 'tv'].includes(raw.mediaType)
        || typeof raw.title !== 'string' || !Number.isFinite(raw.position) || !Number.isFinite(raw.duration)
        || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) throw new Error('Invalid viewing history');
    return Object.fromEntries(['tmdbId', 'mediaType', 'season', 'episode', 'title', 'posterPath', 'position', 'duration', 'updatedAt']
      .filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
  });
  return { feedback, watchlist: value.watchlist.map(item), history, moviesOnly: value.moviesOnly, hideWatched: value.hideWatched, updatedAt: value.updatedAt };
}

export class TasteProfileStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private directory = process.env.VELA_PROFILE_DIRECTORY || join(process.cwd(), 'data', 'profiles')) {}
  private path(scope: string): string {
    if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('Invalid profile scope');
    return join(this.directory, `${scope}.json`);
  }
  async load(scope: string): Promise<TasteProfile | null> {
    try { return validateTasteProfile(JSON.parse(await readFile(this.path(scope), 'utf8'))); }
    catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async save(scope: string, profile: TasteProfile): Promise<TasteProfile> {
    const validated = validateTasteProfile(profile);
    const operation = this.writes.catch(() => {}).then(async () => {
      const existing = await this.load(scope);
      if (existing && existing.updatedAt > validated.updatedAt) return existing;
      await mkdir(this.directory, { recursive: true });
      const path = this.path(scope);
      await writeFile(`${path}.tmp`, JSON.stringify(validated), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
      return validated;
    });
    this.writes = operation;
    return operation;
  }
}
