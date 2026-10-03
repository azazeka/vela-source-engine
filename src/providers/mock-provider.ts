import { MediaRequest, ProviderHealth, RawRelease } from '../types';
import { TorrentProvider } from './provider.interface';

export class MockTorrentProvider implements TorrentProvider {
  public readonly id = 'mock-provider';
  public readonly name = 'Mock Built-in Provider';

  public async search(request: MediaRequest): Promise<RawRelease[]> {
    const title = (request.type === 'episode' ? request.seriesTitle || request.title : request.title).replace(/\s+/g, '.');
    const year = request.year;

    if (request.type === 'movie') {
      return [
        {
          provider: this.id,
          name: `${title}.${year}.2160p.UHD.BluRay.REMUX.DV.HDR10+.HEVC.TrueHD.7.1.Atmos.MULTi-GROUP`,
          infoHash: '1111111111111111111111111111111111111111',
          sizeBytes: 73400000000,
          seeders: 154,
        },
        {
          provider: this.id,
          name: `${title}.${year}.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX`,
          infoHash: '2222222222222222222222222222222222222222',
          sizeBytes: 26800000000,
          seeders: 320,
        },
        {
          provider: this.id,
          name: `${title}.${year}.1080p.BluRay.x264.DTS-HD.MA.7.1-SPARKS`,
          infoHash: '3333333333333333333333333333333333333333',
          sizeBytes: 14500000000,
          seeders: 95,
        },
        {
          provider: this.id,
          name: `${title}.${year}.sample.mkv`,
          infoHash: '4444444444444444444444444444444444444444',
          sizeBytes: 45000000, // < 50MB trash sample
          seeders: 12,
        },
      ];
    } else {
      const sPad = String(request.season ?? 1).padStart(2, '0');
      const ePad = String(request.episode ?? 1).padStart(2, '0');

      return [
        {
          provider: this.id,
          name: `${title}.S${sPad}.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-FLUX`, // Season pack
          infoHash: '5555555555555555555555555555555555555555',
          sizeBytes: 48000000000,
          seeders: 210,
        },
        {
          provider: this.id,
          name: `${title}.S${sPad}E${ePad}.1080p.WEB-DL.DDP5.1.H.264-NTb`, // Single episode
          infoHash: '6666666666666666666666666666666666666666',
          sizeBytes: 4200000000,
          seeders: 140,
        },
      ];
    }
  }

  public async health(): Promise<ProviderHealth> {
    return {
      id: this.id,
      healthy: true,
      latencyMs: 15,
    };
  }
}
