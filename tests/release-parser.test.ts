import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ReleaseParser } from '../src/services/release-parser';

describe('ReleaseParser', () => {
  it('parses UHD BluRay REMUX with DV, HDR10+, TrueHD Atmos and MULTi', () => {
    const raw = 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10+.HEVC.TrueHD.7.1.Atmos.MULTi-GROUP';
    const parsed = ReleaseParser.parse(raw);

    assert.strictEqual(parsed.resolution, '2160p');
    assert.strictEqual(parsed.source, 'uhd_bluray');
    assert.strictEqual(parsed.releaseType, 'remux');
    assert.strictEqual(parsed.videoCodec, 'hevc');
    assert.ok(parsed.hdr.includes('dolby_vision'));
    assert.ok(parsed.hdr.includes('hdr10_plus'));
    assert.ok(parsed.audio.includes('truehd'));
    assert.ok(parsed.audio.includes('atmos'));
    assert.strictEqual(parsed.channels, '7.1');
    assert.ok(parsed.languages.includes('multi'));
    assert.strictEqual(parsed.year, 2024);
    assert.strictEqual(parsed.isTrash, false);
  });

  it('parses 1080p WEB-DL with DD+ 5.1 and dual audio', () => {
    const raw = 'Movie.Title.2023.1080p.WEB-DL.DDP5.1.Atmos.H.264.Dual-Audio';
    const parsed = ReleaseParser.parse(raw);

    assert.strictEqual(parsed.resolution, '1080p');
    assert.strictEqual(parsed.source, 'web_dl');
    assert.strictEqual(parsed.releaseType, 'encode');
    assert.strictEqual(parsed.videoCodec, 'h264');
    assert.ok(parsed.audio.includes('dd_plus'));
    assert.strictEqual(parsed.channels, '5.1');
    assert.ok(parsed.languages.includes('dual'));
    assert.strictEqual(parsed.isTrash, false);
  });

  it('detects sample and trash releases', () => {
    const raw = 'Dune.Part.Two.2024.sample.mkv';
    const parsed = ReleaseParser.parse(raw);

    assert.strictEqual(parsed.isTrash, true);
    assert.ok(parsed.trashReason);
  });

  it('parses episode notation S02E04', () => {
    const raw = 'Silo.S02E04.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-FLUX';
    const parsed = ReleaseParser.parse(raw);

    assert.strictEqual(parsed.season, 2);
    assert.strictEqual(parsed.episode, 4);
    assert.strictEqual(parsed.isSeasonPack, false);
  });

  it('parses season pack S02', () => {
    const raw = 'Silo.S02.2160p.WEB-DL.DDP5.1.Atmos.DV.H.265-FLUX';
    const parsed = ReleaseParser.parse(raw);

    assert.strictEqual(parsed.season, 2);
    assert.strictEqual(parsed.episode, null);
    assert.strictEqual(parsed.isSeasonPack, true);
  });
});
