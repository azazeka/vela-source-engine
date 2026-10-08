import assert from 'node:assert';
import { describe, it } from 'node:test';
import { RankingEngine } from '../src/services/ranking-engine';
import { PlayCandidate } from '../src/types';

describe('RankingEngine', () => {
  it('chooses native video and audio across providers without penalizing large compatible files', () => {
    const native: PlayCandidate = {
      candidateId: 'native', mediaKey: 'movie:1', quality: '2160p', hdr: ['dolby_vision'],
      videoCodec: 'hevc', audio: ['dd_plus', 'atmos'], channels: '5.1', source: 'web_dl_encode',
      sizeBytes: 80e9, cached: true, torrentHash: 'a'.repeat(40), fileId: 1,
      fileName: 'Movie.mkv', provider: 'rutor', rawReleaseName: 'Movie', score: 0, badges: [],
    };
    const remux: PlayCandidate = { ...native, candidateId: 'remux', provider: 'torznab-torlock',
      source: 'uhd_bluray_remux', audio: ['truehd', 'atmos'], channels: '7.1' };
    const software: PlayCandidate = { ...native, candidateId: 'software', videoCodec: 'av1' };
    for (const preset of ['best', 'balanced']) {
      assert.equal(RankingEngine.rank([remux, software, native], preset)[0].candidateId, 'native');
      assert.equal(RankingEngine.rank([remux, { ...native, quality: '1080p' }], preset)[0].candidateId, 'native');
      assert.equal(RankingEngine.rank([remux, { ...native, cached: false }], preset)[0].candidateId, 'remux');
    }
    const compatibleRemux: PlayCandidate = { ...remux, audio: ['dd_plus', 'atmos'] };
    assert.equal(RankingEngine.rank([native, compatibleRemux], 'best')[0].candidateId, 'remux');
    assert.equal(RankingEngine.isDirectPlayApple({ ...native, audio: ['atmos'] }), false);
  });
  it('compares quality across providers while keeping cached releases first', () => {
    const primary: PlayCandidate = {
      candidateId: 'primary', mediaKey: 'movie:1', quality: '1080p', hdr: ['sdr'],
      videoCodec: 'h264', audio: [], channels: null, source: 'web_dl_encode',
      sizeBytes: 4e9, cached: true, torrentHash: 'a'.repeat(40), fileId: 1,
      fileName: 'Movie.mkv', provider: 'torznab-torlock', rawReleaseName: 'Movie.1080p.WEB-DL',
      score: 0, badges: [],
    };
    const fallback: PlayCandidate = { ...primary, candidateId: 'fallback', provider: 'rutor',
      quality: '2160p', hdr: ['dolby_vision'], source: 'bluray_remux' };
    const uncached = { ...fallback, candidateId: 'uncached', provider: 'torznab-torlock', cached: false };
    for (const preset of ['best', 'balanced'] as const) {
      assert.deepStrictEqual(RankingEngine.rank([fallback, uncached, primary], preset).map(c => c.candidateId),
        ['fallback', 'primary', 'uncached']);
      assert.strictEqual(RankingEngine.rank([uncached, fallback], preset)[0].candidateId, 'fallback');
    }
  });

  it('maps the retired data saver profile to maximum quality', () => {
    const compact: PlayCandidate = {
      candidateId: 'compact', mediaKey: 'movie:1', quality: '1080p', hdr: ['sdr'],
      videoCodec: 'hevc', audio: ['aac'], channels: '2.0', source: 'web_dl_encode',
      sizeBytes: 4 * 1024 ** 3, cached: true, torrentHash: 'a'.repeat(40), fileId: 1,
      fileName: 'Movie.mkv', provider: 'rutor', rawReleaseName: 'Movie.1080p.WEB-DL', score: 0, badges: [],
    };
    const heavy: PlayCandidate = { ...compact, candidateId: 'heavy', quality: '2160p',
      hdr: ['dolby_vision'], audio: ['dd_plus', 'atmos'], sizeBytes: 80 * 1024 ** 3,
      provider: 'torbox-library' };
    assert.equal(RankingEngine.rank([heavy, compact], 'data_saver')[0].candidateId, 'heavy');
    assert.equal(RankingEngine.rank([compact, heavy], 'best')[0].candidateId, 'heavy');
  });

  it('does not label AV1 or lossless audio as native just because it has HDR or Atmos', () => {
    const candidate: PlayCandidate = {
      candidateId: 'web', mediaKey: 'movie:1', quality: '2160p', hdr: ['dolby_vision'],
      videoCodec: 'av1', audio: ['dd_plus', 'atmos'], channels: '5.1', source: 'web_dl_encode',
      sizeBytes: 15e9, cached: true, torrentHash: 'a'.repeat(40), fileId: 1,
      fileName: 'Movie.mkv', provider: 'rutor', rawReleaseName: 'Movie', score: 0, badges: [],
    };
    for (const heavy of [candidate, { ...candidate, videoCodec: 'hevc' as const, audio: ['truehd', 'atmos'] as const }]) {
      const release = { ...heavy, audio: [...heavy.audio] };
      assert.equal(RankingEngine.isAppleNative(release), false);
      assert.equal(RankingEngine.generateBadges(release).includes(' Apple TV Native'), false);
    }
    assert.equal(RankingEngine.cpuLoadTier(candidate), 5);
  });

  it('uses seeders for uncached downloads and stable IDs for otherwise equal releases', () => {
    const candidate: PlayCandidate = {
      candidateId: 'a', mediaKey: 'movie:1', quality: '1080p', hdr: ['sdr'],
      videoCodec: 'hevc', audio: ['aac'], channels: null, source: 'web_dl_encode',
      sizeBytes: 4e9, cached: false, torrentHash: 'a'.repeat(40), fileId: 0,
      fileName: 'Movie.mkv', provider: 'rutor', rawReleaseName: 'Movie', score: 0, badges: [], seeders: 0,
    };
    const seeded = { ...candidate, candidateId: 'b', provider: 'torznab-torlock', seeders: 100 };
    assert.equal(RankingEngine.rank([candidate, seeded])[0].candidateId, 'b');
    for (const input of [[candidate, seeded], [seeded, candidate]]) {
      assert.deepEqual(RankingEngine.rank(input.map(c => ({ ...c, cached: true }))).map(c => c.candidateId), ['a', 'b']);
    }
  });

  it('ranks cached 4K REMUX with DV and Atmos above other fallbacks when native audio is unavailable', () => {
    const candidates: PlayCandidate[] = [
      {
        candidateId: 'c1',
        mediaKey: 'movie:1',
        quality: '1080p',
        hdr: ['sdr'],
        videoCodec: 'h264',
        audio: ['dts'],
        channels: '5.1',
        source: 'bluray_encode',
        sizeBytes: 8 * 1024 * 1024 * 1024,
        cached: true,
        torrentHash: 'hash1',
        fileId: 1,
        fileName: 'Movie.1080p.mkv',
        provider: 'mock',
        rawReleaseName: 'Movie.1080p.BluRay',
        score: 0,
        badges: [],
      },
      {
        candidateId: 'c2',
        mediaKey: 'movie:1',
        quality: '2160p',
        hdr: ['dolby_vision', 'hdr10'],
        videoCodec: 'hevc',
        audio: ['truehd', 'atmos'],
        channels: '7.1',
        source: 'uhd_bluray_remux',
        sizeBytes: 65 * 1024 * 1024 * 1024,
        cached: true,
        torrentHash: 'hash2',
        fileId: 2,
        fileName: 'Movie.2160p.REMUX.mkv',
        provider: 'mock',
        rawReleaseName: 'Movie.2160p.UHD.REMUX',
        score: 0,
        badges: [],
      },
      {
        candidateId: 'c3',
        mediaKey: 'movie:1',
        quality: '2160p',
        hdr: ['dolby_vision'],
        videoCodec: 'hevc',
        audio: ['truehd'],
        channels: '7.1',
        source: 'uhd_bluray_remux',
        sizeBytes: 70 * 1024 * 1024 * 1024,
        cached: false, // Uncached
        torrentHash: 'hash3',
        fileId: 3,
        fileName: 'Movie.2160p.Uncached.mkv',
        provider: 'mock',
        rawReleaseName: 'Movie.2160p.Uncached',
        score: 0,
        badges: [],
      },
    ];

    const ranked = RankingEngine.rank(candidates, 'best');

    // 1st should be c2 (4K REMUX cached)
    assert.strictEqual(ranked[0].candidateId, 'c2');
    assert.ok(ranked[0].badges.includes('4K'));
    assert.ok(ranked[0].badges.includes('Dolby Vision'));
    assert.ok(ranked[0].badges.includes('Atmos'));
    assert.ok(ranked[0].badges.includes('⚡ Ready on TorBox'));

    // 2nd should be c1 (cached 1080p is preferred over uncached 4K)
    assert.strictEqual(ranked[1].candidateId, 'c1');

    // 3rd should be c3 (uncached penalized)
    assert.strictEqual(ranked[2].candidateId, 'c3');
  });

  it('does not prefer compact files to lossless 4K on a fast connection', () => {
    const candidates: PlayCandidate[] = [
      {
        candidateId: 'remux',
        mediaKey: 'movie:1',
        quality: '2160p',
        hdr: ['hdr10'],
        videoCodec: 'hevc',
        audio: ['ac3'],
        channels: '7.1',
        source: 'uhd_bluray_remux',
        sizeBytes: 80 * 1024 * 1024 * 1024, // 80 GB
        cached: true,
        torrentHash: 'h1',
        fileId: 1,
        fileName: 'Heavy.mkv',
        provider: 'mock',
        rawReleaseName: 'Heavy.mkv',
        score: 0,
        badges: [],
      },
      {
        candidateId: 'compact',
        mediaKey: 'movie:1',
        quality: '1080p',
        hdr: ['sdr'],
        videoCodec: 'hevc',
        audio: ['aac'],
        channels: '2.0',
        source: 'web_dl_encode',
        sizeBytes: 4 * 1024 * 1024 * 1024, // 4 GB compact
        cached: true,
        torrentHash: 'h2',
        fileId: 2,
        fileName: 'Compact.mkv',
        provider: 'mock',
        rawReleaseName: 'Compact.mkv',
        score: 0,
        badges: [],
      },
    ];

    const ranked = RankingEngine.rank(candidates, 'data_saver');
    assert.strictEqual(ranked[0].candidateId, 'remux');
  });

  it('prioritizes native compatibility in both quality profiles', () => {
    const appleNative4K: PlayCandidate = {
      candidateId: 'apple_native_4k',
      mediaKey: 'movie:100',
      quality: '2160p',
      hdr: ['dolby_vision', 'hdr10'],
      videoCodec: 'hevc',
      audio: ['dd_plus', 'atmos'],
      channels: '5.1',
      source: 'web_dl_encode',
      sizeBytes: 18 * 1024 * 1024 * 1024,
      cached: true,
      torrentHash: 'hash_native',
      fileId: 1,
      fileName: 'Movie.4K.WEB-DL.DDP.Atmos.mkv',
      provider: 'rutor',
      rawReleaseName: 'Movie.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR',
      score: 0,
      badges: [],
    };

    const regular4KRemux: PlayCandidate = {
      candidateId: 'heavy_4k_remux',
      mediaKey: 'movie:100',
      quality: '2160p',
      hdr: ['dolby_vision'],
      videoCodec: 'hevc',
      audio: ['truehd', 'atmos'],
      channels: '7.1',
      source: 'uhd_bluray_remux',
      sizeBytes: 65 * 1024 * 1024 * 1024,
      cached: true,
      torrentHash: 'hash_remux',
      fileId: 2,
      fileName: 'Movie.4K.REMUX.mkv',
      provider: 'rutor',
      rawReleaseName: 'Movie.2024.2160p.UHD.BluRay.REMUX',
      score: 0,
      badges: [],
    };

    const light4KEncode: PlayCandidate = {
      candidateId: 'light_4k_encode',
      mediaKey: 'movie:100',
      quality: '2160p',
      hdr: ['hdr10'],
      videoCodec: 'hevc',
      audio: ['ac3'],
      channels: '5.1',
      source: 'uhd_bluray_encode',
      sizeBytes: 15 * 1024 * 1024 * 1024,
      cached: true,
      torrentHash: 'hash_encode',
      fileId: 3,
      fileName: 'Movie.4K.Encode.mkv',
      provider: 'rutor',
      rawReleaseName: 'Movie.2024.2160p.BluRay.x265.AC3',
      score: 0,
      badges: [],
    };

    const appleNative1080p: PlayCandidate = {
      candidateId: 'apple_native_1080p',
      mediaKey: 'movie:100',
      quality: '1080p',
      hdr: ['sdr'],
      videoCodec: 'hevc',
      audio: ['dd_plus'],
      channels: '5.1',
      source: 'web_dl_encode',
      sizeBytes: 5 * 1024 * 1024 * 1024,
      cached: true,
      torrentHash: 'hash_native_1080',
      fileId: 4,
      fileName: 'Movie.1080p.WEB-DL.mkv',
      provider: 'rutor',
      rawReleaseName: 'Movie.2024.1080p.WEB-DL.DDP5.1',
      score: 0,
      badges: [],
    };

    const uncachedNative4K: PlayCandidate = {
      ...appleNative4K,
      candidateId: 'uncached_native_4k',
      cached: false,
    };

    const ranked = RankingEngine.rank(
      [regular4KRemux, uncachedNative4K, appleNative1080p, light4KEncode, appleNative4K],
      'balanced'
    );

    assert.strictEqual(RankingEngine.rank([appleNative4K, regular4KRemux], 'best')[0].candidateId, 'apple_native_4k');

    // 1st: Cached Apple Native 4K (instant play + 0% CPU load + 4K)
    assert.strictEqual(ranked[0].candidateId, 'apple_native_4k');
    assert.ok(ranked[0].badges.includes(' Apple TV Native'));
    assert.ok(ranked[0].badges.includes('4K'));

    // 2nd: Light 4K encode (4K with lower CPU tier than Remux)
    assert.strictEqual(ranked[1].candidateId, 'light_4k_encode');

    // 3rd: Native 1080p remains preferable to non-native audio.
    assert.strictEqual(ranked[2].candidateId, 'apple_native_1080p');

    // 4th: Ready REMUX remains a fallback when native releases are absent.
    assert.strictEqual(ranked[3].candidateId, 'heavy_4k_remux');

    // 5th: Uncached version
    assert.strictEqual(ranked[4].candidateId, 'uncached_native_4k');
  });
});
