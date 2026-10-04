import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BitsearchAdultProvider } from '../src/providers/bitsearch-adult-provider';
import { MediaRequest } from '../src/types';

const testHash1 = '462f2407d6fd4b8dcb252492f092f04dc0b28191';
const testHash2 = '6b340ec8ec19174dd0452a43fe2bc58036dea062';

const sampleBitsearchResponse = {
  success: true,
  query: 'Sean Cody',
  results: [
    {
      id: '5c8a4e792c360a3a2bd6c6b9',
      infohash: testHash1.toUpperCase(),
      title: 'Sean Cody Owen Collection',
      size: 1603082217,
      category: 1,
      seeders: 15,
      leechers: 3,
    },
    {
      id: '5c462ee529dd4319e4aa05c8',
      infohash: testHash2.toUpperCase(),
      title: 'Sean Cody - Stu Collection - [1080p]',
      size: 22733797575,
      category: 1,
      seeders: 28,
      leechers: 5,
    },
  ],
};

describe('BitsearchAdultProvider', () => {
  it('parses JSON response correctly into RawReleases', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response(JSON.stringify(sampleBitsearchResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const provider = new BitsearchAdultProvider('https://bitsearch.eu', fakeFetcher);
    const adultReq: MediaRequest = {
      type: 'movie',
      tmdbId: -1,
      title: 'Sean Cody',
      originalTitle: 'Sean Cody',
      year: 2024,
      isAdult: true,
    };

    const results = await provider.search(adultReq);
    assert.equal(results.length, 2);

    assert.equal(results[0].provider, 'bitsearch-adult');
    assert.equal(results[0].name, 'Sean Cody Owen Collection');
    assert.equal(results[0].infoHash, testHash1);
    assert.equal(results[0].sizeBytes, 1603082217);
    assert.equal(results[0].seeders, 15);
    assert.equal(results[0].detailsUrl, 'https://bitsearch.eu/view/5c8a4e792c360a3a2bd6c6b9');

    assert.equal(results[1].infoHash, testHash2);
    assert.equal(results[1].sizeBytes, 22733797575);
    assert.equal(results[1].seeders, 28);
  });

  it('uses default fallback query for trending/empty query', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(JSON.stringify(sampleBitsearchResponse), { status: 200 });
    };

    const provider = new BitsearchAdultProvider('https://bitsearch.eu', fakeFetcher);
    const emptyReq: MediaRequest = {
      type: 'movie',
      tmdbId: -1,
      title: '',
      originalTitle: '',
      year: 2024,
      isAdult: true,
    };

    await provider.search(emptyReq);
    assert.ok(requestedUrl.includes('q=xxx'));
    assert.ok(requestedUrl.includes('sort=seeders'));
  });

  it('reports health when endpoint returns success: true', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response(JSON.stringify({ success: true, results: [] }), { status: 200 });
    };

    const provider = new BitsearchAdultProvider('https://bitsearch.eu', fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'bitsearch-adult');
  });
});
