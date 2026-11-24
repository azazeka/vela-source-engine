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
  private static parseCache = new Map<string, ParsedReleaseInfo>();
  private static readonly MAX_CACHE_SIZE = 5000;

  public static clearCache(): void {
    this.parseCache.clear();
  }

  public static parse(rawTitle: string): ParsedReleaseInfo {
    const cached = this.parseCache.get(rawTitle);
    if (cached) return cached;

    const clean = rawTitle.replace(/[\._\(\)\[\]\-]/g, ' ').trim();
    const lower = clean.toLowerCase();

    // 1. Detect Trash (samples, trailers, extras, OSTs)
    const trashCheck = this.checkTrash(lower);
    if (trashCheck.isTrash) {
      const trashResult: ParsedReleaseInfo = {
        rawTitle,
        resolution: 'unknown',
        source: 'unknown',
        releaseType: 'unknown',
        videoCodec: 'unknown',
        hdr: [],
        audio: [],
        channels: null,
        languages: [],
        audioStudios: [],
        year: null,
        season: null,
        episode: null,
        isSeasonPack: false,
        isTrash: true,
        trashReason: trashCheck.reason,
      };
      if (this.parseCache.size >= this.MAX_CACHE_SIZE) {
        const firstKey = this.parseCache.keys().next().value;
        if (firstKey) this.parseCache.delete(firstKey);
      }
      this.parseCache.set(rawTitle, trashResult);
      return trashResult;
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

    // 7. Languages & Audio Studios
    const { languages, audioStudios } = this.parseAudioMetadata(lower);

    // 8. Year
    const year = this.parseYear(clean);

    // 9. Season / Episode
    const { season, episode, isSeasonPack } = this.parseSeasonEpisode(clean);

    const result: ParsedReleaseInfo = {
      rawTitle,
      resolution,
      source,
      releaseType,
      videoCodec,
      hdr,
      audio,
      channels,
      languages,
      audioStudios,
      year,
      season,
      episode,
      isSeasonPack,
      isTrash: false,
    };

    if (this.parseCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.parseCache.keys().next().value;
      if (firstKey) this.parseCache.delete(firstKey);
    }
    this.parseCache.set(rawTitle, result);
    return result;
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

  private static readonly UKR_STUDIOS: { pattern: RegExp; name: string }[] = [
    { pattern: /(?<![\p{L}\p{N}])(postmodern|постмодерн)(?![\p{L}\p{N}])/iu, name: 'Postmodern' },
    { pattern: /(?<![\p{L}\p{N}])(le[- ]?doyen|ле[- ]?до[еє]н)(?![\p{L}\p{N}])/iu, name: 'Le Doyen' },
    { pattern: /(?<![\p{L}\p{N}])(так треба|tak треба|tak treba)(?![\p{L}\p{N}])/iu, name: 'Так Треба' },
    { pattern: /(?<![\p{L}\p{N}])(незупиняйсь\w*|незупиняйся)(?![\p{L}\p{N}])/iu, name: 'НеЗупиняйСя' },
    { pattern: /(?<![\p{L}\p{N}])(цікава ідея|tsikava ideya)(?![\p{L}\p{N}])/iu, name: 'Цікава Ідея' },
    { pattern: /(?<![\p{L}\p{N}])(dniprofilm|дніпрофільм)(?![\p{L}\p{N}])/iu, name: 'DniproFilm' },
    { pattern: /(?<![\p{L}\p{N}])(baibako|байбако)(?![\p{L}\p{N}])/iu, name: 'BaibaKo' },
    { pattern: /(?<![\p{L}\p{N}])(воднерило|в одне рило|vodnerylo)(?![\p{L}\p{N}])/iu, name: 'В одне рило' },
    { pattern: /(?<![\p{L}\p{N}])(ufdub|uf dub)(?![\p{L}\p{N}])/iu, name: 'UFDub' },
    { pattern: /(?<![\p{L}\p{N}])(hurtom|гуртом)(?![\p{L}\p{N}])/iu, name: 'Hurtom' },
    { pattern: /(?<![\p{L}\p{N}])(starlight|старлайт)(?![\p{L}\p{N}])/iu, name: 'Starlight' },
    { pattern: /(?<![\p{L}\p{N}])(1\+1|плюси)(?![\p{L}\p{N}])/iu, name: '1+1' },
  ];

  private static readonly RUS_STUDIOS: { pattern: RegExp; name: string }[] = [
    { pattern: /(?<![\p{L}\p{N}])(red[- ]?head[- ]?sound|rhs)(?![\p{L}\p{N}])/iu, name: 'Red Head Sound' },
    { pattern: /(?<![\p{L}\p{N}])(hdrezka|hd-rezka|резка)(?![\p{L}\p{N}])/iu, name: 'HDRezka' },
    { pattern: /(?<![\p{L}\p{N}])(lostfilm|лостфильм)(?![\p{L}\p{N}])/iu, name: 'LostFilm' },
    { pattern: /(?<![\p{L}\p{N}])(кубик в кубе|квк)(?![\p{L}\p{N}])/iu, name: 'Кубик в кубе' },
    { pattern: /(?<![\p{L}\p{N}])(newstudio|ньюстудио)(?![\p{L}\p{N}])/iu, name: 'NewStudio' },
    { pattern: /(?<![\p{L}\p{N}])(кураж[- ]?бамбей)(?![\p{L}\p{N}])/iu, name: 'Кураж-Бамбей' },
    { pattern: /(?<![\p{L}\p{N}])(пифагор)(?![\p{L}\p{N}])/iu, name: 'Пифагор' },
    { pattern: /(?<![\p{L}\p{N}])(невафильм)(?![\p{L}\p{N}])/iu, name: 'Невафильм' },
    { pattern: /(?<![\p{L}\p{N}])(flarrow[- ]?films)(?![\p{L}\p{N}])/iu, name: 'Flarrow Films' },
    { pattern: /(?<![\p{L}\p{N}])(jaskier|яскьер)(?![\p{L}\p{N}])/iu, name: 'Jaskier' },
    { pattern: /(?<![\p{L}\p{N}])(alexfilm|алексфильм)(?![\p{L}\p{N}])/iu, name: 'AlexFilm' },
  ];

  public static parseAudioMetadata(lower: string): { languages: string[]; audioStudios: string[] } {
    const langs: string[] = [];
    const studios: string[] = [];

    // 1. Ukrainian detection (with negative lookahead for subtitle-only releases)
    const isUkrSubOnly = /(?<![\p{L}\p{N}])(sub|subs|субтитр\w*)[:\s-]*.*(ukr|укр)(?![\p{L}\p{N}])/iu.test(lower)
      && !/(?<![\p{L}\p{N}])(ukr|укр).*?(audio|sound|дво|мво|дубл|звук|itunes|лицензия)(?![\p{L}\p{N}])/iu.test(lower);

    const matchedUkr = this.UKR_STUDIOS.filter(s => s.pattern.test(lower));
    const hasUkrAudio = !isUkrSubOnly && (
      /(?<![\p{L}\p{N}])(ukr|ukrainian|укр|українськ\w*)(?![\p{L}\p{N}])/iu.test(lower) ||
      matchedUkr.length > 0
    );

    if (hasUkrAudio) {
      langs.push('uk');
      for (const m of matchedUkr) {
        if (!studios.includes(m.name)) studios.push(m.name);
      }
    }

    // 2. Russian detection
    const matchedRus = this.RUS_STUDIOS.filter(s => s.pattern.test(lower));
    const hasRusAudio = /(?<![\p{L}\p{N}])(rus|russian|рус|русск\w*|дубляж|лицензия|itunes ru|mvo|avo|dvo)(?![\p{L}\p{N}])/iu.test(lower) ||
      matchedRus.length > 0;

    if (hasRusAudio) {
      langs.push('ru');
      for (const m of matchedRus) {
        if (!studios.includes(m.name)) studios.push(m.name);
      }
    }

    // 3. English detection
    if (/(?<![\p{L}\p{N}])(eng|english|en|original|orig)(?![\p{L}\p{N}])/iu.test(lower)) {
      langs.push('en');
    }

    // 4. Multi / Dual detection
    if (/(?<![\p{L}\p{N}])(multi|multilingual|multi[- ]?audio|мульти)(?![\p{L}\p{N}])/iu.test(lower)) langs.push('multi');
    if (/(?<![\p{L}\p{N}])(dual|dual[- ]?audio|дуал)(?![\p{L}\p{N}])/iu.test(lower)) langs.push('dual');

    return { languages: langs, audioStudios: studios };
  }

  private static parseLanguages(lower: string): string[] {
    return this.parseAudioMetadata(lower).languages;
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
    // S01E02, S01 E02, or S01E02E03
    const seMatch = clean.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);
    if (seMatch) {
      return {
        season: parseInt(seMatch[1], 10),
        episode: parseInt(seMatch[2], 10),
        isSeasonPack: false,
      };
    }

    // 1x02 or 01x02
    const altMatch = clean.match(/\b(\d{1,2})x(\d{1,3})\b/i);
    if (altMatch) {
      return {
        season: parseInt(altMatch[1], 10),
        episode: parseInt(altMatch[2], 10),
        isSeasonPack: false,
      };
    }

    // Russian explicit season & episode: "Сезон 1 Серия 2", "1 сезон 2 серия"
    const rusMatch = clean.match(/\b(?:Сезон|Season)\s*(\d{1,2})\s*(?:Сери[яи]|Episode)\s*(\d{1,3})\b/i)
      || clean.match(/\b(\d{1,2})\s*(?:сезон|сезона)\s*(\d{1,3})\s*(?:сери[яи])\b/i);
    if (rusMatch) {
      return {
        season: parseInt(rusMatch[1], 10),
        episode: parseInt(rusMatch[2], 10),
        isSeasonPack: false,
      };
    }

    // Season pack: S01, Season 1, 1 сезон, Seasons 1-3, Complete Series, Сезон 1, Сезоны 1-3
    const seasonOnly = clean.match(/\bS(\d{1,2})\b/i)
      || clean.match(/\b(?:Season|Сезон)\s*(\d{1,2})\b/i)
      || clean.match(/\b(\d{1,2})\s*(?:сезон|сезона|сезоны)\b/i);
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
