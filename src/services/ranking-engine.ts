import { PlayCandidate, QualityPreset } from '../types';

export class RankingEngine {
  private static normalizeLang(lang: string): string {
    const l = lang.trim().toLowerCase();
    if (l === 'uk' || l === 'ukr' || l === 'ukrainian' || l === 'укр') return 'uk';
    if (l === 'ru' || l === 'rus' || l === 'russian' || l === 'рус') return 'ru';
    if (l === 'en' || l === 'eng' || l === 'english') return 'en';
    return l;
  }

  private static matchesLanguage(cand: PlayCandidate, preferredNormalized: string[]): boolean {
    if (!cand.languages || cand.languages.length === 0) return false;
    const candNormalized = cand.languages.map(l => this.normalizeLang(l));
    return preferredNormalized.some(p => candNormalized.includes(p));
  }

  private static isMultiOrDual(cand: PlayCandidate): boolean {
    if (!cand.languages) return false;
    return cand.languages.includes('multi') || cand.languages.includes('dual');
  }

  public static rank(candidates: PlayCandidate[], preset: string = 'best', preferredLanguages?: string[]): PlayCandidate[] {
    const qualityPreset: QualityPreset = preset === 'balanced' ? 'balanced' : 'best';
    const normPreferred = (preferredLanguages || [])
      .map(l => this.normalizeLang(l))
      .filter(l => Boolean(l) && l !== 'auto');

    const scored = candidates.map((cand) => {
      let score = this.calculateScore(cand, qualityPreset);
      if (normPreferred.length > 0) {
        if (this.matchesLanguage(cand, normPreferred)) {
          score += 2500;
        } else if (this.isMultiOrDual(cand)) {
          score += 800;
        } else if (cand.languages && cand.languages.length > 0) {
          score -= 1500;
        }
      }
      const badges = this.generateBadges(cand);
      return {
        ...cand,
        score,
        badges,
      };
    });

    // Compare releases across all providers. Readiness is absolute; provider
    // attribution must never override quality or the user's traffic preset.
    scored.sort((a, b) => {
      // 1. Cached status (playable now)
      if (Number(b.cached) !== Number(a.cached)) {
        return Number(b.cached) - Number(a.cached);
      }

      // 2. Language match priority (when user explicitly requests a language)
      if (normPreferred.length > 0) {
        const aMatch = this.matchesLanguage(a, normPreferred);
        const bMatch = this.matchesLanguage(b, normPreferred);
        if (Number(bMatch) !== Number(aMatch)) {
          return Number(bMatch) - Number(aMatch);
        }
        const aMulti = this.isMultiOrDual(a);
        const bMulti = this.isMultiOrDual(b);
        if (Number(bMulti) !== Number(aMulti)) {
          return Number(bMulti) - Number(aMulti);
        }
      }

      // Native video and audio compatibility outrank bitrate in both profiles.
      const nativePreference = Number(this.isDirectPlayApple(b)) - Number(this.isDirectPlayApple(a));
      if (nativePreference) return nativePreference;

      if (qualityPreset === 'best') {
        const resolution = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1, unknown: 0 };
        const resolutionDifference = resolution[b.quality] - resolution[a.quality];
        if (resolutionDifference) return resolutionDifference;
      }

      // The native profile favors WEB playback; maximum quality compares
      // release quality within the same compatibility class.
      if (qualityPreset === 'balanced') {
        // Apple Native 4K first
        const aNative4K = Number(this.isAppleNative4K(a));
        const bNative4K = Number(this.isAppleNative4K(b));
        if (bNative4K !== aNative4K) return bNative4K - aNative4K;

        // 4. 4K releases with lowest CPU load
        const aIs4K = a.quality === '2160p';
        const bIs4K = b.quality === '2160p';
        if (aIs4K && bIs4K) {
          const aCpuTier = this.cpuLoadTier(a);
          const bCpuTier = this.cpuLoadTier(b);
          if (aCpuTier !== bCpuTier) return aCpuTier - bCpuTier;
        } else if (aIs4K !== bIs4K) {
          return Number(bIs4K) - Number(aIs4K);
        }
      }

      if (b.score !== a.score) return b.score - a.score;
      // Reuse the account copy with priority to Real-Debrid, then TorBox
      const isBLibrary = b.provider === 'realdebrid-library' || b.provider === 'torbox-library';
      const isALibrary = a.provider === 'realdebrid-library' || a.provider === 'torbox-library';
      if (Number(isBLibrary) !== Number(isALibrary)) {
        return Number(isBLibrary) - Number(isALibrary);
      }
      const rdPreference = Number(b.provider === 'realdebrid-library') - Number(a.provider === 'realdebrid-library');
      if (rdPreference) return rdPreference;
      const libraryPreference = Number(b.provider === 'torbox-library') - Number(a.provider === 'torbox-library');
      return libraryPreference || a.candidateId.localeCompare(b.candidateId);
    });
    return scored;
  }

  public static isAppleNative(cand: PlayCandidate): boolean {
    const srcLower = cand.source.toLowerCase();
    const isWebDL = srcLower.includes('web_dl') || srcLower.includes('web');
    return isWebDL && this.isDirectPlayApple(cand);
  }

  public static isDirectPlayApple(cand: PlayCandidate): boolean {
    const hasHardwareVideo = cand.videoCodec === 'hevc' || cand.videoCodec === 'h264';
    const hasHeavyAudio = cand.audio.some(format => ['truehd', 'dts_hd_ma', 'dts', 'flac'].includes(format));
    const hasHardwareAudio = cand.audio.some(format => ['dd_plus', 'ac3', 'aac'].includes(format));
    return hasHardwareVideo && hasHardwareAudio && !hasHeavyAudio;
  }

  public static isAppleNative4K(cand: PlayCandidate): boolean {
    return cand.quality === '2160p' && this.isAppleNative(cand);
  }

  /**
   * Estimates CPU load tier (lower is lighter CPU overhead for Apple TV hardware decoding):
   * 1: Apple Native (WEB-DL with standard streaming codecs / DD+/AAC/Atmos - native hardware decoder, almost 0% CPU)
   * 2: Efficient 4K Encodes (HEVC/H.264 standard containers and DD+/AC3/AAC audio)
   * 3: Lossless / Heavy Encodes (HEVC Bluray with DTS-HD / TrueHD requiring audio decoding)
   * 4: Heavy Remux (UHD BluRay REMUX with TrueHD/Atmos/DTS-HD MA, extreme bitrates and multiplexing)
   * 5: Non-hardware codecs (AV1, VC1, etc. requiring software decode)
   */
  public static cpuLoadTier(cand: PlayCandidate): number {
    if (this.isAppleNative(cand)) return 1;

    const codec = cand.videoCodec.toLowerCase();
    if (codec === 'av1' || codec === 'vc1') return 5;

    const srcLower = cand.source.toLowerCase();
    const hasHeavyAudio = cand.audio.some(format => ['truehd', 'dts_hd_ma', 'dts', 'flac'].includes(format));

    if (srcLower.includes('remux')) {
      return 4;
    }

    if (hasHeavyAudio || srcLower.includes('bluray')) {
      return 3;
    }

    return 2;
  }

  private static calculateScore(cand: PlayCandidate, preset: QualityPreset): number {
    let score = 0;

    // 1. TorBox Cached state is crucial (uncached cannot be played instantly)
    if (cand.cached) {
      score += 10000;
    } else {
      score -= 5000;
    }

    // 2. Resolution
    switch (cand.quality) {
      case '2160p':
        score += 1200;
        break;
      case '1080p':
        score += 600;
        break;
      case '720p':
        score += 200;
        break;
      case '480p':
        score += 50;
        break;
      default:
        score += 0;
    }

    // 3. Source & Release type
    const srcLower = cand.source.toLowerCase();
    if (srcLower.includes('remux')) {
      score += preset === 'best' ? 1200 : 500;
    } else if (srcLower.includes('bluray')) {
      score += 600;
    } else if (srcLower.includes('web_dl')) {
      score += preset === 'balanced' ? 700 : 500;
    } else if (srcLower.includes('webrip')) {
      score += 350;
    } else if (srcLower.includes('cam')) {
      score -= 5000;
    }

    // 4. HDR & Dolby Vision
    if (cand.hdr.includes('dolby_vision')) {
      score += 400;
    }
    if (cand.hdr.includes('hdr10_plus') || cand.hdr.includes('hdr10')) {
      score += 300;
    }

    // 5. Codec
    if (cand.videoCodec === 'hevc') {
      score += 250;
    }

    // 6. Audio
    if (cand.audio.includes('atmos')) score += 350;
    if (cand.audio.includes('truehd')) score += 300;
    if (cand.audio.includes('dts_hd_ma')) score += 250;
    if (cand.audio.includes('dd_plus')) score += 180;
    if (cand.channels === '7.1') score += 150;
    else if (cand.channels === '5.1') score += 100;

    // 7. Apple TV Native Streaming Bonus:
    // WEB-DL releases with Dolby Vision / HDR and DD+/Atmos play 100% hardware-accelerated like Netflix
    // with 0 CPU transcoding, 0 disk I/O, and no overheating.
    if (this.isAppleNative(cand)) {
      // In balanced preset (recommended for streaming on Apple TV), Apple TV Native takes the absolute #1 spot!
      // In 'best' preset, heavy Remux can still compete if user explicitly asks for maximum bitrate.
      score += preset === 'balanced' ? 650 : 350;
    }

    // Seeders affect download prospects, not playback of files already in cloud.
    if (!cand.cached && cand.seeders !== undefined) {
      const seeders = Number.isFinite(cand.seeders) ? Math.max(0, cand.seeders) : 0;
      score += seeders === 0 ? -300 : Math.min(200, Math.log2(seeders + 1) * 25);
    }
    return score;
  }

  public static generateBadges(cand: PlayCandidate): string[] {
    const badges: string[] = [];

    // Apple TV Native stream badge
    const srcLower = cand.source.toLowerCase();
    if (this.isAppleNative(cand)) {
      badges.push(' Apple TV Native');
    }

    // Resolution
    if (cand.quality === '2160p') badges.push('4K');
    else if (cand.quality === '1080p') badges.push('1080p');
    else if (cand.quality === '720p') badges.push('720p');

    // HDR
    if (cand.hdr.includes('dolby_vision')) badges.push('Dolby Vision');
    if (cand.hdr.includes('hdr10_plus')) badges.push('HDR10+');
    else if (cand.hdr.includes('hdr10')) badges.push('HDR10');

    // Audio
    if (cand.audio.includes('atmos')) badges.push('Atmos');
    else if (cand.audio.includes('truehd')) badges.push('TrueHD');
    else if (cand.audio.includes('dts_hd_ma')) badges.push('DTS-HD');
    else if (cand.audio.includes('dd_plus')) badges.push('DD+');
    else if (cand.channels) badges.push(cand.channels);

    // Source
    if (srcLower.includes('remux')) badges.push('Blu-ray REMUX');
    else if (srcLower.includes('bluray')) badges.push('Blu-ray');
    else if (srcLower.includes('web_dl')) badges.push('WEB-DL');
    else if (srcLower.includes('webrip')) badges.push('WEBRip');

    // Size
    const sizeGB = (cand.sizeBytes / (1024 * 1024 * 1024)).toFixed(1);
    badges.push(`${sizeGB} GB`);

    // Readiness
    if (cand.cached) {
      const isRD = cand.provider.toLowerCase().includes('realdebrid') || cand.provider.toLowerCase().includes('real-debrid');
      badges.push(isRD ? '⚡ Ready on Real-Debrid' : '⚡ Ready on TorBox');
    }

    // Languages & Studios
    if (cand.languages && cand.languages.length > 0) {
      if (cand.languages.includes('uk') || cand.languages.includes('ukr')) {
        const studio = cand.audioStudios?.find(s => ['Postmodern', 'Le Doyen', 'Так Треба', 'НеЗупиняйСя', 'Цікава Ідея', 'DniproFilm', 'Hurtom'].includes(s));
        badges.push(studio ? `🇺🇦 ${studio}` : '🇺🇦 UKR');
      }
      if (cand.languages.includes('ru') || cand.languages.includes('rus')) {
        const studio = cand.audioStudios?.find(s => ['Red Head Sound', 'HDRezka', 'LostFilm', 'Кубик в кубе', 'Пифагор'].includes(s));
        badges.push(studio ? `🇷🇺 ${studio}` : '🇷🇺 RUS');
      }
      if (cand.languages.includes('en') || cand.languages.includes('eng')) {
        badges.push('🇬🇧 ENG');
      } else if (cand.languages.includes('multi')) {
        badges.push('🌐 MULTI');
      }
    }

    return badges;
  }
}
