import assert from 'node:assert';
import { describe, it } from 'node:test';
import { Normalizer } from '../src/services/normalizer';
import { RawRelease } from '../src/types';

describe('Normalizer', () => {
  it('keeps complete metadata and maximum seeders regardless of provider response order', () => {
    const sparse: RawRelease = { provider: 'torznab-torlock', name: 'Movie.2024',
      infoHash: 'a'.repeat(40), sizeBytes: 4e9, seeders: 120 };
    const detailed = { ...sparse, provider: 'rutor', seeders: 5,
      name: 'Movie.2024.2160p.WEB-DL.HEVC.DDP5.1.Atmos.DV' };
    const first = Normalizer.normalize([sparse, detailed]);
    assert.deepStrictEqual(first, Normalizer.normalize([detailed, sparse]));
    assert.strictEqual(first.length, 1);
    assert.strictEqual(first[0].provider, 'rutor');
    assert.strictEqual(first[0].parsed.resolution, '2160p');
    assert.strictEqual(first[0].seeders, 120);
  });

  it('deduplicates identical infoHash keeping highest seeders', () => {
    const rawReleases: RawRelease[] = [
      {
        provider: 'provider-1',
        name: 'Movie.2024.1080p.WEB-DL',
        infoHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        sizeBytes: 4000000000,
        seeders: 25,
      },
      {
        provider: 'provider-2',
        name: 'Movie.2024.1080p.WEB-DL',
        infoHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // uppercase
        sizeBytes: 4000000000,
        seeders: 120, // higher seeders
      },
    ];

    const normalized = Normalizer.normalize(rawReleases);
    assert.strictEqual(normalized.length, 1);
    assert.strictEqual(normalized[0].infoHash, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.strictEqual(normalized[0].seeders, 120);
    assert.ok(normalized[0].magnet.startsWith('magnet:?xt=urn:btih:'));
  });

  it('filters out samples and tiny files', () => {
    const rawReleases: RawRelease[] = [
      {
        provider: 'p1',
        name: 'Movie.2024.sample.mkv',
        infoHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        sizeBytes: 25000000,
        seeders: 5,
      },
      {
        provider: 'p1',
        name: 'Movie.2024.trailer.mp4',
        infoHash: 'cccccccccccccccccccccccccccccccccccccccc',
        sizeBytes: 30000000,
        seeders: 2,
      },
    ];

    const normalized = Normalizer.normalize(rawReleases);
    assert.strictEqual(normalized.length, 0);
  });
});
