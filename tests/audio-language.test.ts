import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ReleaseParser } from '../src/services/release-parser';
import { RankingEngine } from '../src/services/ranking-engine';
import { PlayCandidate } from '../src/types';

describe('Audio Language Parsing & Ranking', () => {
  it('correctly parses Ukrainian audio and dubbing studios', () => {
    const r1 = ReleaseParser.parse('Dune.Part.Two.2024.2160p.UHD.BluRay.x265.TrueHD.Atmos.7.1-FLUX [UKR]');
    assert.deepStrictEqual(r1.languages.includes('uk'), true);

    const r2 = ReleaseParser.parse('Avatar.The.Way.of.Water.2022.BDRip.1080p.DVO.Незупиняйсь');
    assert.deepStrictEqual(r2.languages.includes('uk'), true);
    assert.deepStrictEqual(r2.audioStudios?.includes('НеЗупиняйСя'), true);

    const r3 = ReleaseParser.parse('Oppenheimer.2023.WEB-DL.1080p.Postmodern.Так Треба Продакшн');
    assert.deepStrictEqual(r3.languages.includes('uk'), true);
    assert.deepStrictEqual(r3.audioStudios?.includes('Postmodern'), true);
    assert.deepStrictEqual(r3.audioStudios?.includes('Так Треба'), true);
  });

  it('correctly parses Russian audio and studios', () => {
    const r1 = ReleaseParser.parse('Deadpool.and.Wolverine.2024.2160p.WEB-DL.DDP5.1.Atmos.H.265-RHS [Red Head Sound]');
    assert.deepStrictEqual(r1.languages.includes('ru'), true);
    assert.deepStrictEqual(r1.audioStudios?.includes('Red Head Sound'), true);

    const r2 = ReleaseParser.parse('Breaking.Bad.S05E16.1080p.BluRay.x264-LostFilm');
    assert.deepStrictEqual(r2.languages.includes('ru'), true);
    assert.deepStrictEqual(r2.audioStudios?.includes('LostFilm'), true);
  });

  it('does not falsely classify subtitle-only releases as Ukrainian audio', () => {
    const r1 = ReleaseParser.parse('Inception.2010.1080p.BluRay.x264 [Sub: Ukr]');
    assert.strictEqual(r1.languages.includes('uk'), false);
  });

  it('RankingEngine prioritizes candidate matching preferred language', () => {
    const englishOnly: PlayCandidate = {
      candidateId: 'cand_en',
      mediaKey: 'movie:1',
      quality: '2160p',
      hdr: ['dolby_vision'],
      videoCodec: 'hevc',
      audio: ['dd_plus'],
      channels: '5.1',
      languages: ['en'],
      source: 'web_dl_encode',
      sizeBytes: 15 * 1024 * 1024 * 1024,
      cached: true,
      torrentHash: '1111111111111111111111111111111111111111',
      fileId: 1,
      fileName: 'Movie.2024.2160p.WEB-DL.en.mkv',
      provider: 'torrentio',
      rawReleaseName: 'Movie 2024 2160p WEB-DL',
      score: 0,
      badges: [],
    };

    const ukrainianRelease: PlayCandidate = {
      candidateId: 'cand_uk',
      mediaKey: 'movie:1',
      quality: '1080p',
      hdr: ['sdr'],
      videoCodec: 'h264',
      audio: ['dd_plus'],
      channels: '5.1',
      languages: ['uk', 'en'],
      audioStudios: ['Postmodern'],
      source: 'web_dl_encode',
      sizeBytes: 6 * 1024 * 1024 * 1024,
      cached: true,
      torrentHash: '2222222222222222222222222222222222222222',
      fileId: 2,
      fileName: 'Movie.2024.1080p.UKR.Postmodern.mkv',
      provider: 'rutor',
      rawReleaseName: 'Movie 2024 1080p UKR Postmodern',
      score: 0,
      badges: [],
    };

    // When no language preference is given, 2160p English wins by quality
    const defaultRank = RankingEngine.rank([ukrainianRelease, englishOnly], 'best');
    assert.strictEqual(defaultRank[0].candidateId, 'cand_en');

    // When Ukrainian is preferred, ukrainianRelease wins!
    const ukRank = RankingEngine.rank([englishOnly, ukrainianRelease], 'best', ['uk']);
    assert.strictEqual(ukRank[0].candidateId, 'cand_uk');
    assert.strictEqual(ukRank[0].badges.some(b => b.includes('🇺🇦')), true);
  });
});
