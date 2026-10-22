import { createHash } from 'node:crypto';
import { MediaRequest, StreamDescriptor, TorBoxCachedTorrent, TorBoxFile } from '../types';
import { DebridAdapter, DebridDiagnostic, DebridError } from './debrid-adapter.interface';
import { FileMatcher } from './file-matcher';
import { LibraryTorrent, retryAfterSeconds } from './torbox-adapter';

export class RealDebridError extends DebridError {
  constructor(
    message: string,
    statusCode: number = 502,
    code?: string,
    diagnostic?: DebridDiagnostic
  ) {
    super(message, statusCode, code, diagnostic);
  }
}

export class RealDebridAdapter implements DebridAdapter {
  readonly id = 'realdebrid' as const;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = 'https://api.real-debrid.com/rest/1.0',
    private readonly defaultToken = process.env.REALDEBRID_API_KEY
  ) {}

  private token(apiKey?: string): string {
    const token = apiKey?.trim() || this.defaultToken?.trim();
    if (!token) throw new RealDebridError('Real-Debrid API key is required.', 401);
    return token;
  }

  public cacheScope(apiKey?: string): string {
    return createHash('sha256').update(this.token(apiKey) + ':realdebrid').digest('hex');
  }

  private async request(
    path: string,
    apiKey?: string,
    query?: URLSearchParams,
    options: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}
  ): Promise<any> {
    const token = this.token(apiKey);
    const url = new URL(`${this.baseUrl}/${path}`);
    if (query) url.search = query.toString();

    let response: Response;
    const failure = (
      message: string,
      statusCode = 502,
      code?: string,
      reason: DebridDiagnostic['reason'] = 'http'
    ) => {
      const diagnostic: DebridDiagnostic = {
        stage: 'realdebridAPI',
        operation: path,
        reason,
        status: response?.status,
        retryAfterSeconds: retryAfterSeconds(response?.headers.get('retry-after') ?? null),
      };
      console.error('[RealDebrid failure]', JSON.stringify({ ...diagnostic, message }));
      return new RealDebridError(message, statusCode, code, diagnostic);
    };

    try {
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        body: options.body,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.headers ?? {}),
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw failure('Real-Debrid connection failed. Check your network and try again.', 502, undefined, 'transport');
    }

    if ([401, 403].includes(response.status)) {
      throw failure(`Real-Debrid returned HTTP ${response.status}. Check your API key and account access.`, 401);
    }

    if (response.status === 204) {
      return null;
    }

    let json: any;
    try {
      json = await response.json();
    } catch {
      throw failure(
        response.ok ? 'Invalid Real-Debrid response.' : `Real-Debrid returned HTTP ${response.status}.`,
        response.ok ? 502 : response.status,
        undefined,
        response.ok ? 'invalidResponse' : 'http'
      );
    }

    if (!response.ok) {
      const rawError = typeof json?.error === 'string' ? json.error : json?.message;
      const detail = typeof rawError === 'string'
        ? rawError.split(token).join('[redacted]').replace(/(?:https?:\/\/|magnet:)\S+/gi, '[redacted URL]').trim()
        : `Real-Debrid returned HTTP ${response.status}.`;
      const code = json?.error_code ? String(json.error_code) : 'REALDEBRID_REJECTED';
      throw failure(detail, response.status, code);
    }

    return json;
  }

  public async health(apiKey?: string): Promise<'ok' | 'degraded' | 'unauthorized' | 'down'> {
    try {
      const user = await this.request('user', apiKey);
      if (user && (user.type === 'premium' || (typeof user.premium === 'number' && user.premium > 0))) {
        return 'ok';
      }
      return 'degraded';
    } catch (error) {
      return error instanceof RealDebridError && error.statusCode === 401 ? 'unauthorized' : 'down';
    }
  }

  public async checkCached(hashes: string[], apiKey?: string): Promise<Map<string, TorBoxCachedTorrent>> {
    this.token(apiKey);
    const result = new Map<string, TorBoxCachedTorrent>();
    if (!hashes.length) return result;

    // Real-Debrid allows batching up to 40 hashes separated by '/' in the URL
    const batchSize = 40;
    const batches: string[][] = [];
    for (let offset = 0; offset < hashes.length; offset += batchSize) {
      batches.push(hashes.slice(offset, offset + batchSize).map(h => h.toLowerCase().trim()));
    }

    const responses = await Promise.all(
      batches.map(async (batch) => {
        try {
          const path = `torrents/instantAvailability/${batch.join('/')}`;
          const data = await this.request(path, apiKey);
          return { batch, data };
        } catch (err: any) {
          if (err instanceof RealDebridError && err.statusCode === 401) {
            throw err;
          }
          console.warn(`[RealDebrid] Batch instantAvailability check failed:`, err?.message ?? err);
          return { batch, data: null };
        }
      })
    );

    for (const { batch, data } of responses) {
      if (!data || typeof data !== 'object') continue;

      for (const [hashKey, hashData] of Object.entries(data)) {
        const normHash = hashKey.toLowerCase();
        if (!batch.includes(normHash)) continue;

        const rdRaw = (hashData as any)?.rd;
        const rdVariants: any[] = Array.isArray(rdRaw)
          ? rdRaw
          : (rdRaw && typeof rdRaw === 'object' ? [rdRaw] : []);
        if (rdVariants.length === 0) continue;

        // Choose the best variant (the one with the largest total size / video files)
        let bestFiles: TorBoxFile[] = [];
        let bestTotalSize = 0;

        for (const variant of rdVariants) {
          if (!variant || typeof variant !== 'object') continue;
          const currentFiles: TorBoxFile[] = [];
          let currentSize = 0;

          for (const [idStr, fileData] of Object.entries(variant)) {
            const id = parseInt(idStr, 10);
            const name = (fileData as any)?.filename;
            const size = Number((fileData as any)?.filesize) || 0;
            if (!isNaN(id) && typeof name === 'string' && size > 0) {
              currentFiles.push({ id, name, size });
              currentSize += size;
            }
          }

          if (currentSize > bestTotalSize) {
            bestTotalSize = currentSize;
            bestFiles = currentFiles;
          }
        }

        if (bestFiles.length > 0) {
          // Sort files by size descending
          bestFiles.sort((a, b) => b.size - a.size);
          const name = bestFiles[0]?.name ?? normHash;
          result.set(normHash, {
            hash: normHash,
            name,
            size: bestTotalSize,
            files: bestFiles,
          });
        }
      }
    }

    return result;
  }

  public async listTorrents(apiKey?: string): Promise<LibraryTorrent[]> {
    const data = await this.request('torrents', apiKey, new URLSearchParams({ limit: '100' }));
    if (!Array.isArray(data)) throw new RealDebridError('Invalid Real-Debrid library response.');

    const torrents: LibraryTorrent[] = [];
    for (const row of data) {
      const id = String(row.id ?? '');
      const hash = typeof row.hash === 'string' ? row.hash.toLowerCase() : '';
      if (!hash || !id) continue;

      const ready = row.status === 'downloaded' || row.status === 'uploading' || row.progress === 100;
      torrents.push({
        id: id as any,
        hash,
        name: String(row.filename ?? ''),
        size: Number(row.bytes) || 0,
        files: [], // Detailed files fetched on demand via getTorrentById
        ready,
      });
    }

    return torrents;
  }

  public async getTorrentById(id: number | string, apiKey?: string): Promise<LibraryTorrent | null> {
    try {
      const data = await this.request(`torrents/info/${id}`, apiKey);
      if (!data || typeof data !== 'object') return null;

      const hash = typeof data.hash === 'string' ? data.hash.toLowerCase() : '';
      const ready = data.status === 'downloaded' || data.status === 'uploading' || data.progress === 100;
      const files: TorBoxFile[] = Array.isArray(data.files)
        ? data.files.map((f: any) => ({
            id: Number(f.id) || 0,
            name: (f.path ?? '').replace(/^\//, '') || `file_${f.id}`,
            size: Number(f.bytes) || 0,
          }))
        : [];

      return {
        id: id as any,
        hash,
        name: String(data.filename ?? data.original_filename ?? ''),
        size: Number(data.bytes) || 0,
        files,
        ready,
      };
    } catch (err: any) {
      if (err instanceof RealDebridError && err.statusCode === 404) return null;
      throw err;
    }
  }

  public async requestDownloadLink(
    torrentHash: string,
    fileId: number,
    apiKey?: string,
    request?: MediaRequest,
    cachedFiles?: TorBoxFile[],
    allowUncached: boolean = true,
    selectedFile?: { name: string; size: number }
  ): Promise<StreamDescriptor> {
    const normHash = torrentHash.toLowerCase().trim();

    // 1. Check if user already has this torrent in their RD list
    const torrents = await this.listTorrents(apiKey);
    let torrentInfo = torrents.find(t => t.hash === normHash);
    let torrentId: string;

    if (torrentInfo) {
      torrentId = String(torrentInfo.id);
    } else {
      // 2. Add magnet to user's RD account
      const form = new URLSearchParams();
      form.set('magnet', `magnet:?xt=urn:btih:${normHash}`);

      const addRes = await this.request('torrents/addMagnet', apiKey, undefined, {
        method: 'POST',
        body: form.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (!addRes?.id) {
        throw new RealDebridError('Failed to add magnet to Real-Debrid.', 502);
      }
      torrentId = String(addRes.id);
    }

    // 3. Get detailed torrent info (files & status)
    let info = await this.request(`torrents/info/${torrentId}`, apiKey);
    if (!info) throw new RealDebridError('Could not retrieve torrent info from Real-Debrid.', 502);

    // If magnet is actively converting metadata, poll briefly for files to become available
    if (info.status === 'magnet_conversion') {
      for (let attempt = 0; attempt < 8 && info.status === 'magnet_conversion'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        info = await this.request(`torrents/info/${torrentId}`, apiKey);
      }
    }

    // 4. If files need to be selected, select target file or all
    if (info.status === 'waiting_files_selection') {
      const files: TorBoxFile[] = (info.files ?? []).map((f: any) => ({
        id: Number(f.id) || 0,
        name: (f.path ?? '').replace(/^\//, '') || `file_${f.id}`,
        size: Number(f.bytes) || 0,
      }));

      let targetId = fileId > 0 ? fileId : 0;
      if (!targetId && selectedFile) {
        const found = files.find(f => f.name.toLowerCase() === selectedFile.name.toLowerCase() && f.size === selectedFile.size);
        if (found) targetId = found.id;
      }
      if (!targetId && request) {
        const matched = FileMatcher.matchFile(request, files, info.filename);
        if (matched) targetId = matched.id;
      }

      const filesPayload = targetId > 0 ? String(targetId) : 'all';
      const selectForm = new URLSearchParams();
      selectForm.set('files', filesPayload);

      await this.request(`torrents/selectFiles/${torrentId}`, apiKey, undefined, {
        method: 'POST',
        body: selectForm.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      // Refresh info after selecting files
      info = await this.request(`torrents/info/${torrentId}`, apiKey);
    }

    // 5. Verify download status (poll briefly if cached torrent is converting/finalizing)
    if (info.status !== 'downloaded') {
      for (let attempt = 0; attempt < 4 && info.status !== 'downloaded'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        info = await this.request(`torrents/info/${torrentId}`, apiKey);
      }
    }

    if (info.status !== 'downloaded') {
      if (!allowUncached) {
        throw new RealDebridError(
          'This torrent is not cached in Real-Debrid yet. It has been added to your cloud.',
          409,
          'REALDEBRID_NOT_CACHED'
        );
      }
      throw new RealDebridError(
        'Torrent is downloading in Real-Debrid cloud. Please wait until ready.',
        409,
        'REALDEBRID_DOWNLOADING'
      );
    }

    // 6. Find the right link from info.links
    const links: string[] = Array.isArray(info.links) ? info.links : [];
    if (links.length === 0) {
      throw new RealDebridError('No download links available for this Real-Debrid torrent.', 404);
    }

    // Map selected files to links (RD returns links corresponding to files with selected=1 in order)
    const selectedFiles = (info.files ?? []).filter((f: any) => f.selected === 1);
    let linkToUnrestrict = links[0];
    let matchedFileName = info.filename;
    let matchedFileSize = info.bytes;

    if (selectedFiles.length > 0 && links.length === selectedFiles.length) {
      let targetIndex = 0;
      if (fileId > 0) {
        const idx = selectedFiles.findIndex((f: any) => f.id === fileId);
        if (idx >= 0) targetIndex = idx;
      } else if (selectedFile) {
        const idx = selectedFiles.findIndex((f: any) => {
          const name = (f.path ?? '').replace(/^\//, '');
          return name.toLowerCase() === selectedFile.name.toLowerCase();
        });
        if (idx >= 0) targetIndex = idx;
      } else if (request) {
        const converted: TorBoxFile[] = selectedFiles.map((f: any) => ({
          id: Number(f.id) || 0,
          name: (f.path ?? '').replace(/^\//, '') || `file_${f.id}`,
          size: Number(f.bytes) || 0,
        }));
        const matched = FileMatcher.matchFile(request, converted, info.filename);
        if (matched) {
          const idx = converted.findIndex((c: TorBoxFile) => c.id === matched.id);
          if (idx >= 0) targetIndex = idx;
        }
      }

      linkToUnrestrict = links[targetIndex] || links[0];
      const sel = selectedFiles[targetIndex] || selectedFiles[0];
      matchedFileName = (sel.path ?? '').replace(/^\//, '') || matchedFileName;
      matchedFileSize = Number(sel.bytes) || matchedFileSize;
    }

    // 7. Unrestrict the target link
    const unrestrictForm = new URLSearchParams();
    unrestrictForm.set('link', linkToUnrestrict);

    const unrestrictRes = await this.request('unrestrict/link', apiKey, undefined, {
      method: 'POST',
      body: unrestrictForm.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const streamUrl = unrestrictRes?.download;
    if (!streamUrl || typeof streamUrl !== 'string') {
      throw new RealDebridError('Could not unrestrict Real-Debrid stream link.', 502);
    }

    return {
      streamUrl,
      mimeType: /\.mkv$/i.test(unrestrictRes.filename || matchedFileName) ? 'video/x-matroska' : 'video/mp4',
      fileName: unrestrictRes.filename || matchedFileName,
      sizeBytes: Number(unrestrictRes.filesize) || matchedFileSize,
      expiresAt: null,
      ...(request?.type === 'episode' ? { seasonNumber: request.season ?? 1, episodeNumber: request.episode ?? 1 } : {}),
    };
  }
}
