import { Innertube, ClientType } from 'youtubei.js';

export interface TrailerStreamInfo {
  streamUrl: string;
  format: 'hls' | 'mp4';
  quality: string;
  title?: string;
  expiresAt: number;
}

export class TrailerResolver {
  private visionYt: Innertube | null = null;
  private androidVRClient: Innertube | null = null;
  private androidClient: Innertube | null = null;
  private iosClient: Innertube | null = null;
  private cache = new Map<string, TrailerStreamInfo>();
  private readonly CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

  private async getVisionClient(): Promise<Innertube> {
    if (!this.visionYt) {
      this.visionYt = await Innertube.create({
        client_type: ClientType.VISIONOS,
        retrieve_player: false,
      });
    }
    return this.visionYt;
  }

  private async getAndroidVRClient(): Promise<Innertube> {
    if (!this.androidVRClient) {
      this.androidVRClient = await Innertube.create({
        client_type: ClientType.ANDROID_VR,
        retrieve_player: false,
      });
    }
    return this.androidVRClient;
  }

  private async getAndroidClient(): Promise<Innertube> {
    if (!this.androidClient) {
      this.androidClient = await Innertube.create({
        client_type: ClientType.ANDROID,
        retrieve_player: false,
      });
    }
    return this.androidClient;
  }

  private async getIOSClient(): Promise<Innertube> {
    if (!this.iosClient) {
      this.iosClient = await Innertube.create({
        client_type: ClientType.IOS,
        retrieve_player: false,
      });
    }
    return this.iosClient;
  }

  public async resolve(videoId: string): Promise<TrailerStreamInfo> {
    const cleanId = videoId.trim();
    if (!cleanId) {
      throw new Error('Video ID is required');
    }

    // Check cache
    const cached = this.cache.get(cleanId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const diagnostics: string[] = [];

    // 1. Try Apple VisionOS client for full native Apple HLS Master Manifest (1080p)
    try {
      const yt = await this.getVisionClient();
      const info = await yt.getBasicInfo(cleanId);
      const hls = info.streaming_data?.hls_manifest_url;

      if (hls) {
        const adaptive = info.streaming_data?.adaptive_formats || [];
        const maxH = Math.max(...adaptive.map((f: any) => f.height || 0), 1080);
        const hasHdr = adaptive.some((f: any) => (f.quality_label || '').includes('HDR'));
        let q = '1080p FHD';
        if (maxH >= 2160) q = hasHdr ? '4K ULTRA HD • HDR' : '4K ULTRA HD';
        else if (maxH >= 1440) q = hasHdr ? '1440p QHD • HDR' : '1440p QHD';
        else if (maxH >= 1080) q = '1080p FHD';
        else q = `${maxH}p HD`;

        const result: TrailerStreamInfo = {
          streamUrl: hls,
          format: 'hls',
          quality: q,
          title: info.basic_info.title,
          expiresAt: Date.now() + this.CACHE_TTL_MS,
        };
        this.cache.set(cleanId, result);
        return result;
      } else {
        diagnostics.push(`VisionOS: status=${info.playability_status?.status}, reason=${info.playability_status?.reason || 'no_hls'}`);
      }
    } catch (err: any) {
      diagnostics.push(`VisionOS error: ${err?.message ?? err}`);
      console.warn(`[TrailerResolver] VisionOS client failed for ${cleanId}: ${err?.message ?? err}`);
    }

    // 2. Fallback to Android VR client for direct high-res MP4
    try {
      const yt = await this.getAndroidClient();
      const info = await yt.getBasicInfo(cleanId);
      const adaptive = info.streaming_data?.adaptive_formats || [];
      const formats = info.streaming_data?.formats || [];

      // Find highest video mp4
      const videoCandidates = adaptive
        .filter((f) => f.has_video && f.mime_type.includes('mp4') && f.url)
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      const muxedCandidates = formats
        .filter((f) => f.has_video && f.url)
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      const bestStream = muxedCandidates[0] || videoCandidates[0];
      if (bestStream && bestStream.url) {
        const result: TrailerStreamInfo = {
          streamUrl: bestStream.url,
          format: 'mp4',
          quality: bestStream.quality_label || `${bestStream.height ?? 1080}p`,
          title: info.basic_info.title,
          expiresAt: Date.now() + this.CACHE_TTL_MS,
        };
        this.cache.set(cleanId, result);
        return result;
      } else {
        diagnostics.push(`Android: status=${info.playability_status?.status}, reason=${info.playability_status?.reason || 'no_formats'}`);
      }
    } catch (err: any) {
      diagnostics.push(`Android error: ${err?.message ?? err}`);
      console.warn(`[TrailerResolver] Android client failed for ${cleanId}: ${err?.message ?? err}`);
    }

    // 3. Fallback to iOS client
    try {
      const yt = await this.getIOSClient();
      const info = await yt.getBasicInfo(cleanId);
      const adaptive = info.streaming_data?.adaptive_formats || [];
      const formats = info.streaming_data?.formats || [];

      const videoCandidates = adaptive
        .filter((f) => f.has_video && f.mime_type.includes('mp4') && f.url)
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      const muxedCandidates = formats
        .filter((f) => f.has_video && f.url)
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      const bestStream = muxedCandidates[0] || videoCandidates[0];
      if (bestStream && bestStream.url) {
        const result: TrailerStreamInfo = {
          streamUrl: bestStream.url,
          format: 'mp4',
          quality: bestStream.quality_label || `${bestStream.height ?? 1080}p`,
          title: info.basic_info.title,
          expiresAt: Date.now() + this.CACHE_TTL_MS,
        };
        this.cache.set(cleanId, result);
        return result;
      } else {
        diagnostics.push(`iOS: status=${info.playability_status?.status}, reason=${info.playability_status?.reason || 'no_formats'}`);
      }
    } catch (err: any) {
      diagnostics.push(`iOS error: ${err?.message ?? err}`);
      console.warn(`[TrailerResolver] iOS client failed for ${cleanId}: ${err?.message ?? err}`);
    }

    throw new Error(`Unable to resolve playable stream for trailer: ${cleanId}. (${diagnostics.join('; ')})`);
  }
}
