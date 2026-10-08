import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorBoxAdapter } from '../services/torbox-adapter';
import { FileMatcher } from '../services/file-matcher';
import { TorrentProvider } from './provider.interface';

// This provider searches the authenticated account's library, not an external index.
export class TorBoxLibraryProvider implements TorrentProvider {
  readonly id = 'torbox-library';
  readonly name = 'TorBox Library';
  constructor(private readonly adapter: TorBoxAdapter) {}

  async search(request: MediaRequest, apiKey?: string): Promise<RawRelease[]> {
    const normalize = (name: string) =>
      name
        .toLowerCase()
        .replace(/\b(?:part|pt)\s+ii\b/gi, 'part 2')
        .replace(/\b(?:part|pt)\s+iii\b/gi, 'part 3')
        .replace(/\b(?:part|pt)\s+iv\b/gi, 'part 4')
        .replace(/\b(?:part|pt)\s+v\b/gi, 'part 5')
        .replace(/\b(?:part|pt)\s+vi\b/gi, 'part 6')
        .replace(/\b(?:part|pt)\s+vii\b/gi, 'part 7')
        .replace(/\b(?:part|pt)\s+viii\b/gi, 'part 8')
        .replace(/\b(?:part|pt)\s+(\d+)\b/gi, 'part $1')
        .replace(/\bpt\s+(\d+)\b/gi, 'part $1')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

    const titles = [request.title, request.originalTitle, request.seriesTitle]
      .filter((title): title is string => !!title?.trim())
      .map(normalize);

    const titleWordsList = titles
      .map(t =>
        t
          .split(/\s+/)
          .filter(
            w =>
              !['and', 'the', 'of', 'in', 'a', 'an', 'и', 'в', 'на', 'с', 'по', 'часть', 'part'].includes(w) &&
              w.length > 0
          )
      )
      .filter(words => words.length > 0);

    const torrents = await this.adapter.listTorrents(apiKey);
    return torrents.flatMap(torrent => {
      if (!torrent.ready) return [];
      const file = FileMatcher.matchFile(request, torrent.files);
      if (!file) return [];

      const normalizedTorrent = normalize(torrent.name);
      const normalizedFile = normalize(file.name);
      const combined = ` ${normalizedTorrent} ${normalizedFile} `;

      const directMatch = titles.some(title => combined.includes(` ${title} `));
      const wordsMatch = titleWordsList.some(words => words.every(word => combined.includes(` ${word} `)));

      if (!directMatch && !wordsMatch) return [];

      if (request.type === 'movie' && request.year) {
        const years = torrent.name.match(/\b(?:19|20)\d{2}\b/g)?.map(Number);
        if (years?.length && !years.some(y => Math.abs(y - request.year!) <= 1)) return [];
      }

      // Pick whichever name contains more release metadata (e.g. 1080p, Remux, BluRay)
      const releaseName = torrent.name.length >= file.name.length ? torrent.name : file.name;

      return [{
        provider: this.id,
        name: releaseName,
        infoHash: torrent.hash,
        sizeBytes: file.size,
        seeders: 0,
        libraryFiles: torrent.files
      }];
    });
  }

  async health(apiKey?: string): Promise<ProviderHealth> {
    const start = Date.now();
    const status = await this.adapter.health(apiKey);
    return { id: this.id, healthy: status === 'ok', latencyMs: Date.now() - start };
  }
}
