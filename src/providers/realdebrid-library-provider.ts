import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { RealDebridAdapter } from '../services/realdebrid-adapter';
import { ReleaseIdentity } from '../services/release-identity';
import { FileMatcher } from '../services/file-matcher';
import { TorrentProvider } from './provider.interface';

export class RealDebridLibraryProvider implements TorrentProvider {
  readonly id = 'realdebrid-library';
  readonly name = 'Real-Debrid Library';

  constructor(private readonly adapter: RealDebridAdapter) {}

  async search(request: MediaRequest, apiKey?: string): Promise<RawRelease[]> {
    try {
      const torrents = await this.adapter.listTorrents(apiKey);
      const matchedTorrents = torrents.filter(t => t.ready && ReleaseIdentity.matches(t.name, request));

      const releases: RawRelease[] = [];
      for (const torrent of matchedTorrents) {
        let files = torrent.files;
        if (!files || files.length === 0) {
          const full = await this.adapter.getTorrentById(torrent.id, apiKey);
          if (full?.files) files = full.files;
        }
        if (!files || files.length === 0) continue;

        const file = FileMatcher.matchFile(request, files, torrent.name);
        if (!file) continue;

        releases.push({
          provider: this.id,
          name: torrent.name,
          infoHash: torrent.hash,
          sizeBytes: file.size,
          seeders: 0,
          libraryFiles: files,
        });
      }
      return releases;
    } catch {
      return [];
    }
  }

  async health(apiKey?: string): Promise<ProviderHealth> {
    const start = Date.now();
    const status = await this.adapter.health(apiKey);
    return { id: this.id, healthy: status === 'ok', latencyMs: Date.now() - start };
  }
}
