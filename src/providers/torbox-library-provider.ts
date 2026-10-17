import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorBoxAdapter } from '../services/torbox-adapter';
import { ReleaseIdentity } from '../services/release-identity';
import { FileMatcher } from '../services/file-matcher';
import { TorrentProvider } from './provider.interface';

// This provider searches the authenticated account's library, not an external index.
export class TorBoxLibraryProvider implements TorrentProvider {
  readonly id = 'torbox-library';
  readonly name = 'TorBox Library';
  constructor(private readonly adapter: TorBoxAdapter) {}

  async search(request: MediaRequest, apiKey?: string): Promise<RawRelease[]> {
    const torrents = await this.adapter.listTorrents(apiKey);
    return torrents.flatMap(torrent => {
      if (!torrent.ready) return [];
      const file = FileMatcher.matchFile(request, torrent.files, torrent.name);
      if (!file) return [];

      if (!ReleaseIdentity.matches(torrent.name, request)) return [];

      // The verified torrent title identifies the release; a generic file name cannot replace it.
      const releaseName = torrent.name;

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
