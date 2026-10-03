import assert from 'node:assert';
import { describe, it } from 'node:test';
import { FileMatcher } from '../src/services/file-matcher';
import { MediaRequest, TorBoxFile } from '../src/types';

describe('FileMatcher', () => {
  it('matches largest video file for movie, ignoring samples', () => {
    const request: MediaRequest = {
      type: 'movie',
      tmdbId: 693134,
      title: 'Dune: Part Two',
      originalTitle: 'Dune: Part Two',
      year: 2024,
    };

    const files: TorBoxFile[] = [
      { id: 1, name: 'Sample/dune.sample.mkv', size: 50 * 1024 * 1024 },
      { id: 2, name: 'Dune.Part.Two.2024.2160p.mkv', size: 65 * 1024 * 1024 * 1024 },
      { id: 3, name: 'Extras/Featurette.mkv', size: 1024 * 1024 * 1024 },
      { id: 4, name: 'Subtitles/eng.srt', size: 100 * 1024 },
    ];

    const matched = FileMatcher.matchFile(request, files);
    assert.ok(matched);
    assert.strictEqual(matched.id, 2);
    assert.strictEqual(matched.name, 'Dune.Part.Two.2024.2160p.mkv');
  });

  it('matches exact episode inside season pack', () => {
    const request: MediaRequest = {
      type: 'episode',
      tmdbId: 125988,
      title: 'Silo',
      originalTitle: 'Silo',
      year: 2023,
      season: 2,
      episode: 4,
    };

    const files: TorBoxFile[] = [
      { id: 10, name: 'Silo.S02E01.mkv', size: 4 * 1024 * 1024 * 1024 },
      { id: 20, name: 'Silo.S02E02.mkv', size: 4 * 1024 * 1024 * 1024 },
      { id: 30, name: 'Silo.S02E03.mkv', size: 4 * 1024 * 1024 * 1024 },
      { id: 40, name: 'Silo.S02E04.mkv', size: 4 * 1024 * 1024 * 1024 },
    ];

    const matched = FileMatcher.matchFile(request, files);
    assert.ok(matched);
    assert.strictEqual(matched.id, 40);
    assert.strictEqual(matched.name, 'Silo.S02E04.mkv');
  });

  it('returns null if requested episode is missing in season pack', () => {
    const request: MediaRequest = {
      type: 'episode',
      tmdbId: 125988,
      title: 'Silo',
      originalTitle: 'Silo',
      year: 2023,
      season: 2,
      episode: 10, // Not present
    };

    const files: TorBoxFile[] = [
      { id: 10, name: 'Silo.S02E01.mkv', size: 4 * 1024 * 1024 * 1024 },
      { id: 20, name: 'Silo.S02E02.mkv', size: 4 * 1024 * 1024 * 1024 },
    ];

    const matched = FileMatcher.matchFile(request, files);
    assert.strictEqual(matched, null);
  });
});
