import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EztvProvider } from '../src/providers/eztv-provider';
import { MediaRequest } from '../src/types';

const sampleEztvResponse = {
  torrents_count: 2,
  limit: 100,
  page: 1,
  torrents: [
    {
      id: 12345,
      hash: 'B3E69C7B65E232F99FDE162A4E0B9138B291A23C',
      filename: 'Severance.S02E01.1080p.WEB.H264-FLUX.mkv',
      title: 'Severance S02E01 1080p WEB H264-FLUX',
      season: '2',
      episode: '1',
      seeds: 350,
      peers: 20,
      size_bytes: 1850000000,
      magnet_url: 'magnet:?xt=urn:btih:b3e69c7b65e232f99fde162a4e0b9138b291a23c',
    },
    {
      id: 12346,
      hash: 'C3E69C7B65E232F99FDE162A4E0B9138B291A23D',
      filename: 'Severance.S02E02.1080p.WEB.H264-FLUX.mkv',
      title: 'Severance S02E02 1080p WEB H264-FLUX',
      season: '2',
      episode: '2',
      seeds: 420,
      peers: 30,
      size_bytes: 1950000000,
    },
  ],
};

describe('EztvProvider', () => {
  it('ignores movie requests', async () => {
    const provider = new EztvProvider('https://eztv.re/api');
    const movieReq: MediaRequest = {
      type: 'movie',
      tmdbId: 100,
      title: 'Inception',
      originalTitle: 'Inception',
      year: 2010,
    };
    const results = await provider.search(movieReq);
    assert.equal(results.length, 0);
  });

  it('searches TV episodes and filters by requested season & episode', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(JSON.stringify(sampleEztvResponse), { status: 200 });
    };

    const provider = new EztvProvider('https://eztv.re/api', fakeFetcher);
    const episodeReq: MediaRequest = {
      type: 'episode',
      tmdbId: 999,
      title: 'Severance',
      originalTitle: 'Severance',
      seriesTitle: 'Severance',
      year: 2022,
      season: 2,
      episode: 1,
    };

    process.env.ENABLE_EZTV_IN_TESTS = '1';
    try {
      const results = await provider.search(episodeReq);
      assert.equal(results.length, 1);
      assert.equal(results[0].provider, 'eztv');
      assert.equal(results[0].name, 'Severance.S02E01.1080p.WEB.H264-FLUX.mkv');
      assert.equal(results[0].infoHash, 'b3e69c7b65e232f99fde162a4e0b9138b291a23c');
      assert.equal(results[0].seeders, 350);
      assert.equal(results[0].sizeBytes, 1850000000);
      assert.ok(requestedUrl.includes('search=Severance'));
    } finally {
      delete process.env.ENABLE_EZTV_IN_TESTS;
    }
  });

  it('reports health when endpoint returns ok status', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response(JSON.stringify({ torrents: [] }), { status: 200 });
    };

    const provider = new EztvProvider('https://eztv.re/api', fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'eztv');
  });
});
