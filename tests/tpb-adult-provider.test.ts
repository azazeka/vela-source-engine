import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TpbAdultProvider } from '../src/providers/tpb-adult-provider';
import { MediaRequest } from '../src/types';

const sampleTpbResponse = [
  {
    id: '84526190',
    name: 'MILFs In Action Vol.8 (Brazzers) 2026 WEB-DL 720p',
    info_hash: 'C81E12A3590496234F43B46C28DA60895D4ACB9D',
    leechers: '32',
    seeders: '143',
    size: '4043569509',
    category: '505',
  },
  {
    id: '84526191',
    name: 'Gay - [BelAmiOnline.com] - Roger and Alec',
    info_hash: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2',
    leechers: '5',
    seeders: '25',
    size: '1500000000',
    category: '505',
  },
];

describe('TpbAdultProvider', () => {
  it('searches with adult request query and parses releases correctly', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(JSON.stringify(sampleTpbResponse), { status: 200 });
    };

    const provider = new TpbAdultProvider('https://apibay.org', fakeFetcher);
    const adultReq: MediaRequest = {
      type: 'movie',
      tmdbId: -1,
      title: 'Brazzers',
      originalTitle: 'Brazzers',
      year: 2024,
      isAdult: true,
    };

    process.env.ENABLE_TPB_IN_TESTS = '1';
    try {
      const results = await provider.search(adultReq);
      assert.equal(results.length, 2);

      // Verify first release
      assert.equal(results[0].provider, 'tpb-adult');
      assert.equal(results[0].name, 'MILFs In Action Vol.8 (Brazzers) 2026 WEB-DL 720p');
      assert.equal(results[0].infoHash, 'c81e12a3590496234f43b46c28da60895d4acb9d');
      assert.equal(results[0].seeders, 143);
      assert.equal(results[0].sizeBytes, 4043569509);
      assert.ok(results[0].magnet?.startsWith('magnet:?xt=urn:btih:c81e12a3590496234f43b46c28da60895d4acb9d'));

      // Verify second release (gay studio)
      assert.equal(results[1].provider, 'tpb-adult');
      assert.equal(results[1].name, 'Gay - [BelAmiOnline.com] - Roger and Alec');
      assert.equal(results[1].infoHash, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
      assert.equal(results[1].seeders, 25);

      assert.ok(requestedUrl.includes('/q.php?q=Brazzers&cat=500'));
    } finally {
      delete process.env.ENABLE_TPB_IN_TESTS;
    }
  });

  it('reports health when endpoint returns json array', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response(JSON.stringify([{ id: '1' }]), { status: 200 });
    };

    const provider = new TpbAdultProvider('https://apibay.org', fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'tpb-adult');
  });
});
