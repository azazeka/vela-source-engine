export type MediaType = 'movie' | 'episode';

export interface MediaRequest {
  type: MediaType;
  tmdbId: number;
  title: string;
  originalTitle: string;
  year: number;
  preferredLanguages?: string[];
  season?: number;
  episode?: number;
  seriesTitle?: string;
  episodeTitle?: string;
  isAdult?: boolean;
}

export interface RawRelease {
  provider: string;
  name: string;
  infoHash: string;
  magnet?: string;
  sizeBytes: number;
  seeders: number;
  detailsUrl?: string | null;
}

export type Resolution = '2160p' | '1080p' | '720p' | '480p' | 'unknown';
export type ReleaseSource = 'uhd_bluray' | 'bluray' | 'web_dl' | 'webrip' | 'hdtv' | 'dvd' | 'cam' | 'unknown';
export type ReleaseType = 'remux' | 'encode' | 'raw_disc' | 'unknown';
export type VideoCodec = 'hevc' | 'h264' | 'av1' | 'vc1' | 'unknown';
export type HDRType = 'dolby_vision' | 'hdr10_plus' | 'hdr10' | 'hlg' | 'sdr';
export type AudioFormat = 'truehd' | 'atmos' | 'dts_hd_ma' | 'dts' | 'dd_plus' | 'ac3' | 'aac' | 'flac' | 'unknown';

export interface ParsedReleaseInfo {
  rawTitle: string;
  resolution: Resolution;
  source: ReleaseSource;
  releaseType: ReleaseType;
  videoCodec: VideoCodec;
  hdr: HDRType[];
  audio: AudioFormat[];
  channels: string | null;
  languages: string[];
  year: number | null;
  season: number | null;
  episode: number | null;
  isSeasonPack: boolean;
  isTrash: boolean;
  trashReason?: string;
}

export interface NormalizedRelease {
  provider: string;
  name: string;
  infoHash: string;
  magnet: string;
  sizeBytes: number;
  seeders: number;
  detailsUrl: string | null;
  parsed: ParsedReleaseInfo;
}

export interface TorBoxFile {
  id: number;
  name: string;
  size: number;
  s_num?: number;
  e_num?: number;
}

export interface TorBoxCachedTorrent {
  hash: string;
  name: string;
  size: number;
  files: TorBoxFile[];
}

export interface PlayCandidate {
  candidateId: string;
  mediaKey: string;
  quality: Resolution;
  hdr: HDRType[];
  videoCodec: VideoCodec;
  audio: AudioFormat[];
  channels: string | null;
  source: string;
  sizeBytes: number;
  cached: boolean;
  torrentHash: string;
  fileId: number;
  fileName: string;
  provider: string;
  rawReleaseName: string;
  score: number;
  badges: string[];
}

export type QualityPreset = 'best' | 'balanced' | 'data_saver';

export interface ProviderHealth {
  id: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export interface StreamDescriptor {
  streamUrl: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  expiresAt: string | null;
}

export interface SessionStartResponse {
  status: 'ready' | 'degraded' | 'error';
  sourceEngine: boolean;
  torbox: 'ok' | 'degraded' | 'unauthorized' | 'down';
  providers: {
    healthy: number;
    degraded: number;
  };
}

export interface PlayResolveResponse {
  candidate: PlayCandidate;
  stream: StreamDescriptor;
}

export interface VersionsResponse {
  mediaKey: string;
  versions: PlayCandidate[];
}
