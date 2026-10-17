import { MediaRequest, TorBoxFile } from '../types';
import { ReleaseIdentity } from './release-identity';

const VIDEO_EXTENSIONS = /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i;
const EXTRAS = /(?:^|[\s._/\\-])(sample|trailer|extras?|bonus|featurette|interview|behind[ ._-]*the[ ._-]*scenes)(?:$|[\s._/\\-])/i;
export interface EpisodeIdentity { season?: number; episode?: number; endEpisode?: number }

export class FileMatcher {
  static episodeIdentity(name: string): EpisodeIdentity {
    const clean = name.replace(/_/g, ' ').replace(/\\/g, '/');
    const full = /\bs(\d{1,2})[ .-]*e(\d{1,3})(?:[ .-]*(?:e|-)[ .-]*e?(\d{1,3}))?\b/i.exec(clean)
      ?? /\b(\d{1,2})x(\d{1,3})(?:-(\d{1,3}))?\b/i.exec(clean);
    if (full) return { season: Number(full[1]), episode: Number(full[2]), endEpisode: full[3] ? Number(full[3]) : undefined };
    const season = /(?:^|[^\p{L}\p{N}])(?:s|season[ .-]*|сезон[ .-]*)(\d{1,2})(?=$|[^\p{L}\p{N}])/iu.exec(clean)
      ?? /(?:^|[^\p{L}\p{N}])(\d{1,2})[ .-]*сезон(?=$|[^\p{L}\p{N}])/iu.exec(clean);
    const base = clean.split('/').pop()!;
    const combined = /(?:^|[^\p{L}\p{N}])(?:e|ep|episode[ .-]*|серия[ .-]*)(\d{1,3})[ .-]*(?:e|-)[ .-]*e?(\d{1,3})(?=$|[^\p{L}\p{N}])/iu.exec(base)
      ?? /^(\d{1,3})-(\d{1,3})(?:[ .-]|$)/.exec(base);
    if (combined) return { season: season ? Number(season[1]) : undefined, episode: Number(combined[1]), endEpisode: Number(combined[2]) };
    const episode = /(?:^|[^\p{L}\p{N}])(?:e|ep|episode[ .-]*|серия[ .-]*)(\d{1,3})(?=$|[^\p{L}\p{N}])/iu.exec(base)
      ?? /^(\d{1,3})(?:[ .-]|$)/.exec(base)
      ?? /(?:^|[^\p{L}\p{N}])(\d{1,3})[ .-]*сери[яи](?=$|[^\p{L}\p{N}])/iu.exec(base);
    return { season: season ? Number(season[1]) : undefined, episode: episode ? Number(episode[1]) : undefined };
  }

  static matchFile(request: MediaRequest, files: TorBoxFile[], contextTitle?: string): TorBoxFile | null {
    const videos = (files ?? []).filter(f => VIDEO_EXTENSIONS.test(f.name) && !EXTRAS.test(f.name)
      && f.size > 0 && (request.type === 'episode' || f.size >= 80 * 1024 * 1024));
    if (request.type === 'movie') return videos.sort((a, b) => b.size - a.size)[0] ?? null;
    const season = request.season ?? 1, episode = request.episode ?? 1;
    const context = this.episodeIdentity(contextTitle ?? '');
    const matches = videos.filter(file => {
      if (!ReleaseIdentity.fileMatches(file.name, request)) return false;
      const parsed = this.episodeIdentity(file.name);
      // No reliable segment boundaries: never replay a combined file as the next episode.
      if (parsed.endEpisode != null && parsed.endEpisode !== parsed.episode) return false;
      const metaSeason = file.s_num == null ? undefined : Number(file.s_num);
      const metaEpisode = file.e_num == null ? undefined : Number(file.e_num);
      if ([parsed.season, metaSeason].some(s => s != null && s !== season)) return false;
      if ([parsed.episode, metaEpisode].some(e => e != null && e !== episode)) return false;
      const actualSeason = parsed.season ?? metaSeason ?? context.season;
      const actualEpisode = parsed.episode ?? metaEpisode
        ?? (videos.length === 1 && context.endEpisode == null ? context.episode : undefined);
      if (videos.length === 1 && context.episode != null && context.endEpisode == null && context.episode !== actualEpisode) return false;
      return actualSeason === season && actualEpisode === episode;
    });
    return matches.sort((a, b) => b.size - a.size || a.id - b.id)[0] ?? null;
  }
}
