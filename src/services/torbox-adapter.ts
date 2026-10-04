import { createHash } from 'node:crypto';
import { MediaRequest, StreamDescriptor, TorBoxCachedTorrent, TorBoxFile } from '../types';
import { FileMatcher } from './file-matcher';

export interface LibraryTorrent extends TorBoxCachedTorrent {
  id: number;
  ready: boolean;
}

export class TorBoxError extends Error {
  constructor(message: string, public readonly statusCode: number = 502) { super(message); }
}

export class TorBoxAdapter {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.torbox.app/v1/api',
    private readonly defaultToken = process.env.TORBOX_API_KEY
  ) {}

  private token(apiKey?: string): string {
    const token = apiKey?.trim() || this.defaultToken?.trim();
    if (!token) throw new TorBoxError('TorBox API key is required.', 401);
    return token;
  }

  public cacheScope(apiKey?: string): string {
    return createHash('sha256').update(this.token(apiKey)).digest('hex');
  }

  private async request(
    path: string,
    apiKey?: string,
    query?: URLSearchParams,
    options: { method?: string; body?: BodyInit } = {}
  ): Promise<any> {
    const token = this.token(apiKey);
    const url = new URL(`${this.baseUrl}/${path}`);
    if (query) url.search = query.toString();
    if (path === 'torrents/requestdl') url.searchParams.set('token', token);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        body: options.body,
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      // Fetch errors can include the sensitive request URL. Do not forward them.
      throw new TorBoxError('TorBox is temporarily unavailable.');
    }
    if (!response.ok) {
      throw new TorBoxError(`TorBox returned HTTP ${response.status}.`,
        [401, 403].includes(response.status) ? 401 : 502);
    }
    let json: any;
    try { json = await response.json(); } catch { throw new TorBoxError('Invalid TorBox response.'); }
    if (json?.success !== true || json.data == null) throw new TorBoxError('TorBox request was not successful.');
    return json.data;
  }

  private files(value: any): TorBoxFile[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((file: any) => {
      const id = Number(file.id), size = Number(file.size);
      const name = file.name ?? file.short_name;
      if (file.id == null || !Number.isSafeInteger(id) || id < 0 ||
          !Number.isFinite(size) || size <= 0 || typeof name !== 'string') return [];
      return [{ id, size, name, s_num: file.s_num, e_num: file.e_num }];
    });
  }

  public async listTorrents(apiKey?: string): Promise<LibraryTorrent[]> {
    const torrents: LibraryTorrent[] = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const data = await this.request('torrents/mylist', apiKey, new URLSearchParams({
        offset: String(offset), limit: String(pageSize), bypass_cache: 'true',
      }));
      if (!Array.isArray(data)) throw new TorBoxError('Invalid TorBox library response.');
      for (const row of data) {
        const id = Number(row.id);
        const hash = typeof row.hash === 'string' ? row.hash.toLowerCase() : '';
        if (row.id == null || !Number.isSafeInteger(id) || id < 0 || !/^[a-f0-9]{40}$/.test(hash)) continue;
        const ready = row.download_state === 'cached' ||
          row.download_state === 'completed' ||
          row.download_state === 'seeding' ||
          (row.download_finished === true && row.download_present !== false);
        torrents.push({
          id, hash, name: String(row.name ?? ''), size: Number(row.size) || 0,
          files: this.files(row.files),
          ready,
        });
      }
      if (data.length < pageSize) return torrents;
    }
  }

  public async checkCached(hashes: string[], apiKey?: string): Promise<Map<string, TorBoxCachedTorrent>> {
    this.token(apiKey);
    const result = new Map<string, TorBoxCachedTorrent>();
    for (let offset = 0; offset < hashes.length; offset += 100) {
      const batch = hashes.slice(offset, offset + 100).map(hash => hash.toLowerCase());
      const data = await this.request('torrents/checkcached', apiKey, new URLSearchParams({
        hash: batch.join(','), format: 'list', list_files: 'true',
      }));
      const rows = Array.isArray(data) ? data :
        (typeof data === 'object' ? Object.entries(data).map(([hash, row]: [string, any]) => ({ ...row, hash })) : null);
      if (!rows) throw new TorBoxError('Invalid TorBox cache response.');
      for (const row of rows) {
        const hash = typeof row.hash === 'string' ? row.hash.toLowerCase() : '';
        if (!batch.includes(hash)) continue;
        result.set(hash, { hash, name: String(row.name ?? ''), size: Number(row.size) || 0, files: this.files(row.files) });
      }
    }
    return result;
  }

  public async requestDownloadLink(
    torrentHash: string, fileId: number, apiKey?: string, request?: MediaRequest
  ): Promise<StreamDescriptor> {
    // Resolve the hash to the account's numeric torrent ID and real file IDs.
    let torrent = (await this.listTorrents(apiKey)).find(t => t.hash === torrentHash.toLowerCase());
    if (!torrent) {
      // TorBox requires torrents to belong to the user's library before it will issue a stream link.
      // Only add items already cached by TorBox, so selecting an uncached result never starts a download.
      const form = new FormData();
      form.set('magnet', `magnet:?xt=urn:btih:${torrentHash.toLowerCase()}`);
      form.set('add_only_if_cached', 'true');
      try {
        await this.request('torrents/createtorrent', apiKey, undefined, { method: 'POST', body: form });
      } catch (error) {
        if (error instanceof TorBoxError && /HTTP (400|404)\./.test(error.message)) {
          throw new TorBoxError('This torrent is not cached or could not be added to your TorBox library.', 409);
        }
        throw error;
      }
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 600));
        torrent = (await this.listTorrents(apiKey)).find(t => t.hash === torrentHash.toLowerCase());
        if (torrent?.ready && torrent.files.length > 0) break;
      }
    }
    if (!torrent) throw new TorBoxError('TorBox did not add this cached torrent to your library.', 409);
    if (!torrent.ready) throw new TorBoxError('This torrent is still downloading.', 409);

    // 1. Match using request metadata
    let file = request ? FileMatcher.matchFile(request, torrent.files) : null;

    // 2. Fall back to fileId if provided
    if (!file && fileId > 0) {
      file = torrent.files.find(f => f.id === fileId) || null;
    }

    // 3. Fall back to picking video file directly if matching was too strict
    if (!file && torrent.files.length > 0) {
      const videoFiles = torrent.files.filter((f) => {
        const lower = f.name.toLowerCase();
        const isVideo = /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(f.name);
        const isSample = /\b(sample|trailer|extras|bonus|featurette)\b/i.test(lower);
        return isVideo && !isSample;
      });

      if (videoFiles.length === 1) {
        file = videoFiles[0];
      } else if (videoFiles.length > 1) {
        if (request?.type === 'movie') {
          videoFiles.sort((a, b) => b.size - a.size);
          file = videoFiles[0];
        } else if (request?.type === 'episode') {
          const ep = request.episode ?? 1;
          const epPad = String(ep).padStart(2, '0');
          file = videoFiles.find(f => new RegExp(`(?:^|[^\\d])${epPad}(?:[^\\d]|$)`).test(f.name)) || videoFiles[0];
        }
      }
    }

    if (!file) throw new TorBoxError('The requested media file is unavailable.', 404);
    const data = await this.request('torrents/requestdl', apiKey, new URLSearchParams({
      torrent_id: String(torrent.id), file_id: String(file.id), redirect: 'false', zip_link: 'false',
    }));
    const rawURL = typeof data === 'string' ? data : data.url ?? data.download_url ?? data.download ?? data.link;
    let url: URL;
    try { url = new URL(rawURL); } catch { throw new TorBoxError('Invalid TorBox stream URL.'); }
    if (url.protocol !== 'https:') throw new TorBoxError('TorBox stream URL must use HTTPS.');
    return { streamUrl: url.toString(), mimeType: /\.mkv$/i.test(file.name) ? 'video/x-matroska' : 'video/mp4',
      fileName: file.name, sizeBytes: file.size, expiresAt: null };
  }

  public async health(apiKey?: string): Promise<'ok' | 'degraded' | 'unauthorized' | 'down'> {
    try { await this.request('user/me', apiKey); return 'ok'; }
    catch (error) { return error instanceof TorBoxError && error.statusCode === 401 ? 'unauthorized' : 'down'; }
  }
}
