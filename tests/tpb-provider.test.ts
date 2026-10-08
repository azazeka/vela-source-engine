import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TpbProvider } from '../src/providers/tpb-provider';
import { MediaRequest } from '../src/types';

const sampleTpbResponse = [
  {
    id: '12345678',
    name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265-FLUX',
    info_hash: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2',
    leechers: '25',
    seeders: '350',
    size: '25000000000',
    category: '207',
  },
];

describe('TpbProvider', () => {
  it('searches movies and parses mainstream releases correctly', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(JSON.stringify(sampleTpbResponse), { status: 200 });
    };

    const provider = new TpbProvider('https://apibay.org', fakeFetcher);
    const movieReq: MediaRequest = {
      type: 'movie',
      tmdbId: 693134,
      title: 'Dune Part Two',
      originalTitle: 'Dune: Part Two',
      year: 2024,
    };

    process.env.ENABLE_TPB_IN_TESTS = '1';
    try {
      const results = await provider.search(movieReq);
      assert.equal(results.length, 1);
      assert.equal(results[0].provider, 'tpb');
      assert.equal(results[0].name, 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265-FLUX');
      assert.equal(results[0].infoHash, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
      assert.equal(results[0].seeders, 350);
      assert.equal(results[0].sizeBytes, 25000000000);
      assert.ok(requestedUrl.includes('cat=200'));
    } finally {
      delete process.env.ENABLE_TPB_IN_TESTS;
    }
  });

  it('reports health when endpoint returns json array', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const provider = new TpbProvider('https://apibay.org', fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'tpb');
  });
});
