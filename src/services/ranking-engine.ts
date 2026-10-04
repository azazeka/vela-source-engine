import { PlayCandidate, QualityPreset } from '../types';

export class RankingEngine {
  public static rank(candidates: PlayCandidate[], preset: QualityPreset = 'best'): PlayCandidate[] {
    const scored = candidates.map((cand) => {
      const score = this.calculateScore(cand, preset);
      const badges = this.generateBadges(cand);
      return {
        ...cand,
        score,
        badges,
      };
    });

    // Playable versions come first; Torlock is the primary source within each
    // readiness group. Other sources remain available as fallbacks.
    scored.sort((a, b) => Number(b.cached) - Number(a.cached)
      || Number(b.provider === 'torznab-torlock') - Number(a.provider === 'torznab-torlock')
      || b.score - a.score);
    return scored;
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
        score += preset === 'data_saver' ? 300 : 1200;
        break;
      case '1080p':
        score += preset === 'data_saver' ? 1200 : 600;
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
      score += preset === 'best' ? 900 : preset === 'balanced' ? 500 : 100;
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

    // 7. Size penalties / bonuses depending on preset
    const sizeGB = cand.sizeBytes / (1024 * 1024 * 1024);
    if (preset === 'best') {
      if (sizeGB >= 20 && sizeGB <= 95) score += 200;
    } else if (preset === 'balanced') {
      if (sizeGB >= 10 && sizeGB <= 40) score += 300;
      if (sizeGB > 70) score -= 150; // Heavy remux slightly penalized for network stability
    } else if (preset === 'data_saver') {
      if (sizeGB >= 3 && sizeGB <= 15) score += 400;
      if (sizeGB > 25) score -= 800; // Heavily penalize large files
    }

    return score;
  }

  public static generateBadges(cand: PlayCandidate): string[] {
    const badges: string[] = [];

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
    const srcLower = cand.source.toLowerCase();
    if (srcLower.includes('remux')) badges.push('Blu-ray REMUX');
    else if (srcLower.includes('bluray')) badges.push('Blu-ray');
    else if (srcLower.includes('web_dl')) badges.push('WEB-DL');
    else if (srcLower.includes('webrip')) badges.push('WEBRip');

    // Size
    const sizeGB = (cand.sizeBytes / (1024 * 1024 * 1024)).toFixed(1);
    badges.push(`${sizeGB} GB`);

    // Readiness
    if (cand.cached) {
      badges.push('⚡ Ready on TorBox');
    }

    return badges;
  }
}
