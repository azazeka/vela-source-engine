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
    const normalize = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const titles = [request.title, request.originalTitle, request.seriesTitle]
      .filter((title): title is string => !!title?.trim()).map(normalize);
    const torrents = await this.adapter.listTorrents(apiKey);
    return torrents.flatMap(torrent => {
      if (!torrent.ready) return [];
      const file = FileMatcher.matchFile(request, torrent.files);
      if (!file) return [];
      const names = [torrent.name, file.name].map(name => ` ${normalize(name)} `);
      if (!titles.some(title => names.some(name => name.includes(` ${title} `)))) return [];
      if (request.type === 'movie') {
        const years = torrent.name.match(/\b(?:19|20)\d{2}\b/g);
        if (years?.length && !years.includes(String(request.year))) return [];
      }
      return [{ provider: this.id, name: file.name, infoHash: torrent.hash,
        sizeBytes: file.size, seeders: 0 }];
    });
  }

  async health(apiKey?: string): Promise<ProviderHealth> {
    const start = Date.now();
    const status = await this.adapter.health(apiKey);
    return { id: this.id, healthy: status === 'ok', latencyMs: Date.now() - start };
  }
}
