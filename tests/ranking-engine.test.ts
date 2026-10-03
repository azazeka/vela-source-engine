import assert from 'node:assert';
import { describe, it } from 'node:test';
import { RankingEngine } from '../src/services/ranking-engine';
import { PlayCandidate } from '../src/types';

describe('RankingEngine', () => {
  it('ranks cached 4K REMUX with DV and Atmos above 1080p and uncached', () => {
    const candidates: PlayCandidate[] = [
      {
        candidateId: 'c1',
        mediaKey: 'movie:1',
        quality: '1080p',
        hdr: ['sdr'],
        videoCodec: 'h264',
        audio: ['ac3'],
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

  it('adjusts priority when data_saver preset is active', () => {
    const candidates: PlayCandidate[] = [
      {
        candidateId: 'remux',
        mediaKey: 'movie:1',
        quality: '2160p',
        hdr: ['hdr10'],
        videoCodec: 'hevc',
        audio: ['truehd'],
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
    assert.strictEqual(ranked[0].candidateId, 'compact');
  });
});
