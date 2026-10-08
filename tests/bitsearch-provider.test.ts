import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BitsearchProvider } from '../src/providers/bitsearch-provider';
import { MediaRequest } from '../src/types';

const sampleBitsearchResponse = {
  success: true,
  query: 'Dune Part Two 2024',
  results: [
    {
      id: 'abc12345',
      infohash: '1234567890abcdef1234567890abcdef12345678',
      title: 'Dune Part Two 2024 1080p WEB-DL x264',
      size: 4500000000,
      seeders: 120,
      leechers: 15,
    },
  ],
};

describe('BitsearchProvider', () => {
  it('searches movies and parses mainstream releases correctly', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(JSON.stringify(sampleBitsearchResponse), { status: 200 });
    };

    const provider = new BitsearchProvider('https://bitsearch.to', fakeFetcher);
    const movieReq: MediaRequest = {
      type: 'movie',
      tmdbId: 693134,
      title: 'Dune Part Two',
      originalTitle: 'Dune: Part Two',
      year: 2024,
    };

    const results = await provider.search(movieReq);
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'bitsearch');
    assert.equal(results[0].name, 'Dune Part Two 2024 1080p WEB-DL x264');
    assert.equal(results[0].infoHash, '1234567890abcdef1234567890abcdef12345678');
    assert.equal(results[0].seeders, 120);
    assert.equal(results[0].sizeBytes, 4500000000);
    assert.ok(requestedUrl.includes('search?q=Dune%20Part%20Two%202024'));
  });

  it('reports health when endpoint returns success', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    const provider = new BitsearchProvider('https://bitsearch.to', fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'bitsearch');
  });
});
