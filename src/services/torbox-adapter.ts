import { createHash } from 'node:crypto';
import { MediaRequest, StreamDescriptor, TorBoxCachedTorrent, TorBoxFile } from '../types';
import { FileMatcher } from './file-matcher';

export interface LibraryTorrent extends TorBoxCachedTorrent {
  id: number;
  ready: boolean;
}

export interface TorBoxDiagnostic {
  stage: 'torboxAPI';
  operation: string;
  reason: 'http' | 'transport' | 'invalidResponse';
  status?: number;
  retryAfterSeconds?: number;
}

export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const text = value.trim();
  const seconds = /^\d+$/.test(text) ? Number(text) : Math.ceil((Date.parse(text) - now) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400 ? seconds : undefined;
}

export class TorBoxError extends Error {
  constructor(message: string, public readonly statusCode: number = 502, public readonly code?: string,
    public readonly diagnostic?: TorBoxDiagnostic) { super(message); }
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
    const failure = (message: string, statusCode = 502, code?: string, reason: TorBoxDiagnostic['reason'] = 'http') => {
      const diagnostic: TorBoxDiagnostic = { stage: 'torboxAPI', operation: path, reason,
        status: response?.status, retryAfterSeconds: retryAfterSeconds(response?.headers.get('retry-after') ?? null) };
      // Log controlled fields only; fetch errors can contain URLs and credentials.
      console.error('[TorBox failure]', JSON.stringify({ ...diagnostic, message }));
      return new TorBoxError(message, statusCode, code, diagnostic);
    };
    try {
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        body: options.body,
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      // Fetch errors can include the sensitive request URL. Do not forward them.
      throw failure('TorBox connection failed. Check the network and try again.', 502, undefined, 'transport');
    }
    if ([401, 403].includes(response.status)) {
      throw failure(`TorBox returned HTTP ${response.status}. Check your API key and account access.`, 401);
    }
    let json: any;
    try { json = await response.json(); } catch {
      throw failure(response.ok ? 'Invalid TorBox response.' : `TorBox returned HTTP ${response.status}.`, response.ok ? 502 : response.status, undefined, response.ok ? 'invalidResponse' : 'http');
    }
    if (!response.ok || json?.success !== true) {
      const rawDetail = [json?.detail, json?.error].find(value => typeof value === 'string' && value.trim());
      // API rejection reasons are useful, but signed URLs and credentials must never reach the UI.
      const detail = typeof rawDetail === 'string'
        ? rawDetail.split(token).join('[redacted]').replace(/(?:https?:\/\/|magnet:)\S+/gi, '[redacted URL]').replace(/\b(?:bearer\s+|(?:token|api[_-]?key|signature)\s*[=:]\s*)[^\s,;]+/gi, '[redacted credential]').trim().slice(0, 512)
        : '';
      const notCached = /not[_ ]cached|not (?:in|available in) (?:the )?cache|cache[_ ]miss/i.test(detail);
      throw failure(detail || (response.ok ? 'TorBox request was not successful.' : `TorBox returned HTTP ${response.status}.`),
        notCached ? 409 : (response.ok ? 502 : response.status), notCached ? 'TORBOX_NOT_CACHED' : 'TORBOX_REJECTED');
    }
    if (json.data == null) throw failure('Invalid TorBox response.', 502, undefined, 'invalidResponse');
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
        const ready = row.download_present !== false && (row.download_state === 'cached' ||
          row.download_state === 'completed' ||
          row.download_state === 'seeding' ||
          row.download_state === 'uploading' ||
          row.download_finished === true);
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

  public async getTorrentById(id: number, apiKey?: string): Promise<LibraryTorrent | null> {
    try {
      const data = await this.request('torrents/mylist', apiKey, new URLSearchParams({
        id: String(id), bypass_cache: 'true',
      }));
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== 'object') return null;
      const tid = Number(row.id);
      const hash = typeof row.hash === 'string' ? row.hash.toLowerCase() : '';
      if (row.id == null || !Number.isSafeInteger(tid) || tid < 0) return null;
      const ready = row.download_present !== false && (row.download_state === 'cached' ||
        row.download_state === 'completed' ||
        row.download_state === 'seeding' ||
        row.download_state === 'uploading' ||
        row.download_finished === true);
      return {
        id: tid, hash, name: String(row.name ?? ''), size: Number(row.size) || 0,
        files: this.files(row.files),
        ready,
      };
    } catch (error) {
      if (error instanceof TorBoxError && error.statusCode === 404) return null;
      throw error;
    }
  }

  public async requestDownloadLink(
    torrentHash: string, fileId: number, apiKey?: string, request?: MediaRequest, cachedFiles?: TorBoxFile[], allowUncached: boolean = true
  ): Promise<StreamDescriptor> {
    const normHash = torrentHash.toLowerCase();
    // Resolve the hash to the account's numeric torrent ID and real file IDs.
    let torrent = (await this.listTorrents(apiKey)).find(t => t.hash === normHash);
    if (!torrent) {
      // TorBox requires torrents to belong to the user's library before it will issue a stream link.
      // If uncached, add it to TorBox so it downloads into user's cloud library.
      const form = new FormData();
      form.set('magnet', `magnet:?xt=urn:btih:${normHash}`);
      if (!allowUncached || (cachedFiles && cachedFiles.length > 0) || fileId > 0) {
        form.set('add_only_if_cached', 'true');
      }
      let createdId: number | undefined;
      try {
        const createRes = await this.request('torrents/createtorrent', apiKey, undefined, { method: 'POST', body: form });
        const idVal = createRes?.torrent_id ?? createRes?.id;
        if (idVal != null && Number.isSafeInteger(Number(idVal))) {
          createdId = Number(idVal);
        }
      } catch (error) {
        if (allowUncached && form.get('add_only_if_cached') === 'true' && error instanceof TorBoxError && error.code === 'TORBOX_NOT_CACHED') {
          // If it failed because it was not cached, try adding without add_only_if_cached to start download!
          const downloadForm = new FormData();
          downloadForm.set('magnet', `magnet:?xt=urn:btih:${normHash}`);
          const createRes = await this.request('torrents/createtorrent', apiKey, undefined, { method: 'POST', body: downloadForm });
          const idVal = createRes?.torrent_id ?? createRes?.id;
          if (idVal != null && Number.isSafeInteger(Number(idVal))) {
            createdId = Number(idVal);
          }
        } else {
          throw error;
        }
      }

      console.log(`[TorBox] Polling library for createdId=${createdId ?? 'unknown'} hash=${normHash}`);
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 1. Fast path: Direct query by ID if known
        if (createdId != null) {
          const direct = await this.getTorrentById(createdId, apiKey);
          if (direct) {
            torrent = direct;
            console.log(`[TorBox] Poll #${attempt + 1}: Found by ID=${createdId}, ready=${torrent.ready}, filesCount=${torrent.files.length}`);
            if (torrent.ready) break;
          }
        }

        // 2. Fallback: Query list
        const list = await this.listTorrents(apiKey);
        torrent = (createdId != null ? list.find(t => t.id === createdId) : undefined)
          ?? list.find(t => t.hash === normHash);

        if (torrent) {
          console.log(`[TorBox] Poll #${attempt + 1}: Found in list ID=${torrent.id}, ready=${torrent.ready}, filesCount=${torrent.files.length}`);
          if (torrent.ready) break;
        }
      }
    }
    if (!torrent) throw new TorBoxError('Added torrent to your TorBox library. Please wait while it initializes.', 409, 'TORBOX_PREPARING');
    if (!torrent.ready) throw new TorBoxError('Torrent added to TorBox and is still downloading. It will appear in your Library once ready!', 409, 'TORBOX_PREPARING');

    // Cache metadata IDs may differ from account file IDs; wait for account metadata.
    if (torrent.files.length === 0) {
      throw new TorBoxError('TorBox is still preparing the file list. Please try again shortly.', 409, 'TORBOX_PREPARING');
    }
    const availableFiles = torrent.files;

    // 1. Match using request metadata
    let file = request ? FileMatcher.matchFile(request, availableFiles) : null;

    // 2. Fall back to fileId if provided
    if (!file && !request && fileId >= 0) {
      file = availableFiles.find(f => f.id === fileId) || null;
    }

    // 3. Fall back to picking video file directly if matching was too strict
    if (!file && (request?.type === 'movie' || (!request && fileId < 0)) && availableFiles.length > 0) {
      const videoFiles = availableFiles.filter((f) => {
        const lower = f.name.toLowerCase();
        const isVideo = /\.(mkv|mp4|m4v|mov|avi|ts|m2ts|webm)$/i.test(f.name);
        const isSample = /\b(sample|trailer|extras|bonus|featurette)\b/i.test(lower);
        return isVideo && !isSample;
      });

      if (request?.type !== 'episode' && videoFiles.length === 1) {
        file = videoFiles[0];
      } else if (videoFiles.length > 1) {
        if (request?.type === 'movie') {
          videoFiles.sort((a, b) => b.size - a.size);
          file = videoFiles[0];
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
