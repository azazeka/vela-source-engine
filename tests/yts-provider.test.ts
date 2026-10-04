import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { YtsProvider } from '../src/providers/yts-provider';
import { movieRequest, episodeRequest } from './torbox-fixtures';

const testHash = 'ce9156eb497762f8b7577b71c0647a4b0c3423e1';

const sampleYtsResponse = {
  status: 'ok',
  data: {
    movie_count: 1,
    movies: [
      {
        id: 1606,
        title: 'Dune Part Two',
        title_long: 'Dune Part Two (2024)',
        year: 2024,
        url: 'https://yts.mx/movies/dune-part-two-2024',
        torrents: [
          {
            hash: testHash.toUpperCase(),
            quality: '1080p',
            type: 'bluray',
            seeds: 85,
            size_bytes: 1986422374,
          },
        ],
      },
    ],
  },
};

describe('YtsProvider', () => {
  it('ignores episode requests', async () => {
    process.env.ENABLE_YTS_IN_TESTS = '1';
    try {
      const provider = new YtsProvider();
      const results = await provider.search(episodeRequest);
      assert.deepEqual(results, []);
    } finally {
      delete process.env.ENABLE_YTS_IN_TESTS;
    }
  });

  it('searches movies and parses torrents with magnet and seeds', async () => {
    let requestedUrl = '';
    const mockFetcher = (async (url: any) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify(sampleYtsResponse), { status: 200 });
    }) as typeof fetch;

    process.env.ENABLE_YTS_IN_TESTS = '1';
    try {
      const provider = new YtsProvider('https://mock-yts.example/api/v2', mockFetcher);
      const results = await provider.search(movieRequest);

      assert.ok(requestedUrl.includes('/list_movies.json?query_term='));
      assert.equal(results.length, 1);
      assert.equal(results[0].provider, 'yts');
      assert.equal(results[0].infoHash, testHash);
      assert.equal(results[0].seeders, 85);
      assert.equal(results[0].sizeBytes, 1986422374);
      assert.ok(results[0].name.includes('1080p'));
      assert.ok(results[0].magnet?.startsWith('magnet:?xt=urn:btih:'));
    } finally {
      delete process.env.ENABLE_YTS_IN_TESTS;
    }
  });

  it('reports health when endpoint returns ok status', async () => {
    const mockFetcher = (async () => {
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }) as typeof fetch;

    const provider = new YtsProvider('https://mock-yts.example/api/v2', mockFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'yts');
  });
});
