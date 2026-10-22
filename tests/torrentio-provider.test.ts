import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TorrentioProvider } from '../src/providers/torrentio-provider';
import { movieRequest, episodeRequest } from './torbox-fixtures';

const testHash = '4950a74e1461e71a356c1919026e8c0bbdc4d2ed';

const sampleTorrentioResponse = {
  streams: [
    {
      name: 'Torrentio\n4k DV | HDR',
      title: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX[TGx]\n👤 489 💾 29.26 GB ⚙️ TorrentGalaxy',
      infoHash: testHash.toUpperCase(),
      fileIdx: 0,
      behaviorHints: {
        bingeGroup: 'torrentio|4k|WEB-DL|h265|DV|HDR',
        filename: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv',
      },
    },
    {
      name: 'Torrentio\n1080p',
      title: 'Dune.Part.Two.2024.1080p.WEBRip.x264\n👤 120 💾 4.5 GB ⚙️ TGx',
      infoHash: '1111111111111111111111111111111111111111',
    },
  ],
};

describe('TorrentioProvider', () => {
  it('returns empty array when imdbId is missing', async () => {
    process.env.ENABLE_TORRENTIO_IN_TESTS = '1';
    try {
      const provider = new TorrentioProvider();
      const results = await provider.search({ ...movieRequest, imdbId: undefined });
      assert.deepEqual(results, []);
    } finally {
      delete process.env.ENABLE_TORRENTIO_IN_TESTS;
    }
  });

  it('searches movies with formatted imdbId and parses streams correctly', async () => {
    let requestedUrl = '';
    const mockFetcher = (async (url: any) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify(sampleTorrentioResponse), { status: 200 });
    }) as typeof fetch;

    process.env.ENABLE_TORRENTIO_IN_TESTS = '1';
    try {
      const provider = new TorrentioProvider('https://mock-torrentio.example', mockFetcher);
      const results = await provider.search({ ...movieRequest, imdbId: '15239678' });

      assert.ok(requestedUrl.includes('/stream/movie/tt15239678.json'));
      assert.equal(results.length, 2);
      assert.equal(results[0].provider, 'torrentio');
      assert.equal(results[0].infoHash, testHash);
      assert.equal(results[0].name, 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX[TGx]');
      assert.equal(results[0].seeders, 489);
      assert.equal(results[0].sizeBytes, 31417685770); // ~29.26 GB
      assert.ok(results[0].magnet?.includes(testHash));
    } finally {
      delete process.env.ENABLE_TORRENTIO_IN_TESTS;
    }
  });

  it('searches TV series with season and episode numbers', async () => {
    let requestedUrl = '';
    const mockFetcher = (async (url: any) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify(sampleTorrentioResponse), { status: 200 });
    }) as typeof fetch;

    process.env.ENABLE_TORRENTIO_IN_TESTS = '1';
    try {
      const provider = new TorrentioProvider('https://mock-torrentio.example', mockFetcher);
      const results = await provider.search({
        ...episodeRequest,
        imdbId: 'tt0944947',
        season: 2,
        episode: 4,
      });

      assert.ok(requestedUrl.includes('/stream/series/tt0944947:2:4.json'));
      assert.equal(results.length, 2);
    } finally {
      delete process.env.ENABLE_TORRENTIO_IN_TESTS;
    }
  });

  it('reports health when endpoint returns streams', async () => {
    const mockFetcher = (async () => {
      return new Response(JSON.stringify({ streams: [{ infoHash: testHash }] }), { status: 200 });
    }) as typeof fetch;

    const provider = new TorrentioProvider('https://mock-torrentio.example', mockFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'torrentio');
  });
});
