import { MediaRequest, TorBoxFile } from '../types';

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.mov', '.avi', '.ts', '.m2ts']);

export class FileMatcher {
  public static matchFile(request: MediaRequest, files: TorBoxFile[]): TorBoxFile | null {
    if (!files || files.length === 0) return null;

    // Filter valid video files
    const videoFiles = files.filter((f) => {
      const ext = this.getExtension(f.name);
      if (!VIDEO_EXTENSIONS.has(ext)) return false;
      // Exclude samples and extras
      const lower = f.name.toLowerCase();
      if (/\b(sample|trailer|extras|bonus|featurette)\b/i.test(lower)) return false;
      // Small files under 80MB are rarely full episodes or movies
      if (f.size < 80 * 1024 * 1024) return false;
      return true;
    });

    if (videoFiles.length === 0) return null;

    if (request.type === 'movie') {
      return this.matchMovie(videoFiles);
    } else {
      return this.matchEpisode(request, videoFiles);
    }
  }

  private static matchMovie(videoFiles: TorBoxFile[]): TorBoxFile | null {
    // For a movie, choose the largest primary video file
    videoFiles.sort((a, b) => b.size - a.size);
    return videoFiles[0] || null;
  }

  private static matchEpisode(request: MediaRequest, videoFiles: TorBoxFile[]): TorBoxFile | null {
    const season = request.season ?? 1;
    const episode = request.episode ?? 1;

    const sPad = String(season).padStart(2, '0');
    const ePad = String(episode).padStart(2, '0');

    // 1. Check TorBox parsed metadata if available
    const metaMatch = videoFiles.find((f) => f.s_num === season && f.e_num === episode);
    if (metaMatch) return metaMatch;

    // 2. Strict regex matching on file name
    // Matches S01E02 or S1E2 or 1x02 or E02
    const patterns = [
      new RegExp(`\\bS0?${season}E0?${episode}\\b`, 'i'),
      new RegExp(`\\b${season}x0?${episode}\\b`, 'i'),
      new RegExp(`\\bE0?${episode}\\b`, 'i'),
      new RegExp(`\\bEP0?${episode}\\b`, 'i'),
      new RegExp(`\\bEpisode\\s*0?${episode}\\b`, 'i'),
      new RegExp(`\\bСерия\\s*0?${episode}\\b`, 'i'),
    ];

    for (const pattern of patterns) {
      const matched = videoFiles.find((f) => pattern.test(f.name));
      if (matched) return matched;
    }

    return null;
  }

  private static getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.slice(lastDot).toLowerCase() : '';
  }
}
