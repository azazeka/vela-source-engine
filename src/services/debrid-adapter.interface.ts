import { MediaRequest, StreamDescriptor, TorBoxCachedTorrent, TorBoxFile } from '../types';
import { LibraryTorrent, TorBoxDiagnostic } from './torbox-adapter';

export interface DebridDiagnostic {
  stage: 'torboxAPI' | 'realdebridAPI';
  operation: string;
  reason: 'http' | 'transport' | 'invalidResponse';
  status?: number;
  retryAfterSeconds?: number;
}

export abstract class DebridError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 502,
    public readonly code?: string,
    public readonly diagnostic?: DebridDiagnostic | TorBoxDiagnostic
  ) {
    super(message);
  }
}

export interface DebridAdapter {
  readonly id: 'torbox' | 'realdebrid';
  health(apiKey?: string): Promise<'ok' | 'degraded' | 'unauthorized' | 'down'>;
  cacheScope(apiKey?: string): string;
  checkCached(hashes: string[], apiKey?: string): Promise<Map<string, TorBoxCachedTorrent>>;
  listTorrents(apiKey?: string): Promise<LibraryTorrent[]>;
  getTorrentById(id: number | string, apiKey?: string): Promise<LibraryTorrent | null>;
  requestDownloadLink(
    torrentHash: string,
    fileId: number,
    apiKey?: string,
    request?: MediaRequest,
    cachedFiles?: TorBoxFile[],
    allowUncached?: boolean,
    selectedFile?: { name: string; size: number }
  ): Promise<StreamDescriptor>;
}
