import {
  AudioFormat,
  HDRType,
  ParsedReleaseInfo,
  ReleaseSource,
  ReleaseType,
  Resolution,
  VideoCodec,
} from '../types';

export class ReleaseParser {
  public static parse(rawTitle: string): ParsedReleaseInfo {
    const clean = rawTitle.replace(/[\._\(\)\[\]\-]/g, ' ').trim();
    const lower = clean.toLowerCase();

    // 1. Detect Trash (samples, trailers, extras, OSTs)
    const trashCheck = this.checkTrash(lower);
    if (trashCheck.isTrash) {
      return {
        rawTitle,
        resolution: 'unknown',
        source: 'unknown',
        releaseType: 'unknown',
        videoCodec: 'unknown',
        hdr: [],
        audio: [],
        channels: null,
        languages: [],
        year: null,
        season: null,
        episode: null,
        isSeasonPack: false,
        isTrash: true,
        trashReason: trashCheck.reason,
      };
    }

    // 2. Resolution
    const resolution = this.parseResolution(lower);

    // 3. Source & Release Type
    const { source, releaseType } = this.parseSourceAndType(lower);

    // 4. Video Codec
    const videoCodec = this.parseVideoCodec(lower);

    // 5. HDR
    const hdr = this.parseHDR(lower);

    // 6. Audio formats & Channels
    const audio = this.parseAudio(lower);
    const channels = this.parseChannels(lower);

    // 7. Languages
    const languages = this.parseLanguages(lower);

    // 8. Year
    const year = this.parseYear(clean);

    // 9. Season / Episode
    const { season, episode, isSeasonPack } = this.parseSeasonEpisode(clean);

    return {
      rawTitle,
      resolution,
      source,
      releaseType,
      videoCodec,
      hdr,
      audio,
      channels,
      languages,
      year,
      season,
      episode,
      isSeasonPack,
      isTrash: false,
    };
  }

  private static checkTrash(lower: string): { isTrash: boolean; reason?: string } {
    if (/\b(sample|trailer|extras|featurette|behind the scenes|bonus|promo|ost|soundtrack)\b/i.test(lower)) {
      return { isTrash: true, reason: 'Contains trash/sample keywords' };
    }
    return { isTrash: false };
  }

  private static parseResolution(lower: string): Resolution {
    if (/\b(2160p|4k|uhd)\b/i.test(lower)) return '2160p';
    if (/\b(1080p|1080i|fhd)\b/i.test(lower)) return '1080p';
    if (/\b(720p|hd)\b/i.test(lower)) return '720p';
    if (/\b(480p|576p|sd)\b/i.test(lower)) return '480p';
    return 'unknown';
  }

  private static parseSourceAndType(lower: string): { source: ReleaseSource; releaseType: ReleaseType } {
    let source: ReleaseSource = 'unknown';
    let releaseType: ReleaseType = 'unknown';

    if (/\bremux\b/i.test(lower)) {
      releaseType = 'remux';
    }

    if (/\b(uhd bluray|uhd bd|bluray 2160p|2160p bluray)\b/i.test(lower)) {
      source = 'uhd_bluray';
    } else if (/\b(bluray|bdrip|brrip)\b/i.test(lower)) {
      source = 'bluray';
    } else if (/\b(web[- ]?dl|webrip)\b/i.test(lower)) {
      source = lower.includes('webrip') ? 'webrip' : 'web_dl';
    } else if (/\b(hdtv|pdtv|dsr)\b/i.test(lower)) {
      source = 'hdtv';
    } else if (/\b(dvd|dvdrip)\b/i.test(lower)) {
      source = 'dvd';
    } else if (/\b(cam|camrip|ts|telesync)\b/i.test(lower)) {
      source = 'cam';
    }

    if (releaseType === 'unknown') {
      if (/\b(iso|bdmv)\b/i.test(lower)) {
        releaseType = 'raw_disc';
      } else if (source !== 'unknown') {
        releaseType = 'encode';
      }
    }

    return { source, releaseType };
  }

  private static parseVideoCodec(lower: string): VideoCodec {
    if (/\b(hevc|h[- ]?265|x265)\b/i.test(lower)) return 'hevc';
    if (/\b(avc|h[- ]?264|x264)\b/i.test(lower)) return 'h264';
    if (/\b(av1)\b/i.test(lower)) return 'av1';
    if (/\b(vc[- ]?1)\b/i.test(lower)) return 'vc1';
    return 'unknown';
  }

  private static parseHDR(lower: string): HDRType[] {
    const list: HDRType[] = [];
    if (/\b(dv|dovi|dolby vision)\b/i.test(lower)) {
      list.push('dolby_vision');
    }
    if (/hdr10\+|hdr10plus/i.test(lower)) {
      list.push('hdr10_plus');
    } else if (/\b(hdr10|hdr)\b/i.test(lower)) {
      list.push('hdr10');
    }
    if (/\b(hlg)\b/i.test(lower)) {
      list.push('hlg');
    }
    if (list.length === 0) {
      list.push('sdr');
    }
    return list;
  }

  private static parseAudio(lower: string): AudioFormat[] {
    const formats: AudioFormat[] = [];
    if (/\batmos\b/i.test(lower)) formats.push('atmos');
    if (/\btruehd\b/i.test(lower)) formats.push('truehd');
    if (/\b(dts[- ]?hd|dts[- ]?ma)\b/i.test(lower)) formats.push('dts_hd_ma');
    else if (/\bdts\b/i.test(lower)) formats.push('dts');

    if (/\b(dd\+|ddp|e[- ]?ac3|eac3)/i.test(lower)) formats.push('dd_plus');
    else if (/\b(dd|ac3|ac[- ]?3)\b/i.test(lower)) formats.push('ac3');

    if (/\baac\b/i.test(lower)) formats.push('aac');
    if (/\bflac\b/i.test(lower)) formats.push('flac');

    if (formats.length === 0) formats.push('unknown');
    return formats;
  }

  private static parseChannels(lower: string): string | null {
    if (/(?:^|\D)7[ .]1(?:\D|$)/.test(lower)) return '7.1';
    if (/(?:^|\D)5[ .]1(?:\D|$)/.test(lower)) return '5.1';
    if (/(?:^|\D)2[ .]0(?:\D|$)|stereo/i.test(lower)) return '2.0';
    return null;
  }

  private static parseLanguages(lower: string): string[] {
    const langs: string[] = [];
    if (/\b(multi|multilingual|multi[- ]?audio)\b/i.test(lower)) langs.push('multi');
    if (/\b(rus|russian|русский|дубляж|itunes ru|mvo|avo|dub|lostfilm|hdrezka|hd-rezka|red head sound|rhs|кубик в кубе)\b/i.test(lower)) langs.push('ru');
    if (/\b(eng|english|en)\b/i.test(lower)) langs.push('en');
    if (/\b(dual|dual[- ]?audio)\b/i.test(lower)) langs.push('dual');
    return langs;
  }

  private static parseYear(clean: string): number | null {
    const match = clean.match(/\b(19\d\d|20\d\d)\b/);
    return match ? parseInt(match[1], 10) : null;
  }

  private static parseSeasonEpisode(clean: string): {
    season: number | null;
    episode: number | null;
    isSeasonPack: boolean;
  } {
    // S01E02 or S01E02E03
    const seMatch = clean.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
    if (seMatch) {
      return {
        season: parseInt(seMatch[1], 10),
        episode: parseInt(seMatch[2], 10),
        isSeasonPack: false,
      };
    }

    // 1x02
    const altMatch = clean.match(/\b(\d{1,2})x(\d{1,3})\b/i);
    if (altMatch) {
      return {
        season: parseInt(altMatch[1], 10),
        episode: parseInt(altMatch[2], 10),
        isSeasonPack: false,
      };
    }

    // Season pack: S01, Season 1, Seasons 1-3, Complete Series, Сезон 1, Сезоны 1-3
    const seasonOnly = clean.match(/\bS(\d{1,2})\b/i) || clean.match(/\b(?:Season|Сезон)\s*(\d{1,2})\b/i);
    if (seasonOnly) {
      return {
        season: parseInt(seasonOnly[1], 10),
        episode: null,
        isSeasonPack: true,
      };
    }

    if (/\b(complete series|all seasons|seasons \d+[-–]\d+|сезоны \d+[-–]\d+|все сезоны|полный сезон)\b/i.test(clean)) {
      return {
        season: null,
        episode: null,
        isSeasonPack: true,
      };
    }

    return { season: null, episode: null, isSeasonPack: false };
  }
}
