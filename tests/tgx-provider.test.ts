import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TgxProvider } from '../src/providers/tgx-provider';
import { MediaRequest } from '../src/types';

const testHash = '513ec652eea0844f470583c18428b23e3cf43e5e';

const sampleTgxHtml = `
<html>
<body>
<div class="tgxtable">
  <div class="tgxtablerow">
    <div class="tgxtablecell">
      <a href="/torrent/16012345/Dune-Part-Two-2024-1080p" class="txlight" title="Dune Part Two 2024 1080p"><b>Dune Part Two 2024 1080p</b></a>
      <a href="magnet:?xt=urn:btih:${testHash}&dn=Dune+Part+Two&tr=udp://tracker.opentrackr.org:1337"><i class="fa fa-magnet"></i></a>
      <span class="badge badge-secondary">2.45 GB</span>
      <font color="green"><b>88</b></font>
    </div>
  </div>
  <div class="tgxtablerow">
    <div class="tgxtablecell">
      <a href="/torrent/16012346/Dune-Part-Two-2160p-4K" class="txlight"><b>Dune Part Two 2160p 4K UHD</b></a>
      <a href="magnet:?xt=urn:btih:f0d3fe44d8989265969f099c6a474ee9b15a5171&dn=Dune+Part+Two"><i class="fa fa-magnet"></i></a>
      <span class="badge badge-secondary">8.20 GB</span>
      <span style="color:green"><b>42</b></span>
    </div>
  </div>
</div>
</body>
</html>
`;

describe('TgxProvider', () => {
  it('searches movies and parses mainstream releases correctly', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(sampleTgxHtml, { status: 200 });
    };

    const provider = new TgxProvider('https://torrentgalaxy.to', fakeFetcher);
    const movieReq: MediaRequest = {
      type: 'movie',
      tmdbId: 693134,
      title: 'Dune Part Two',
      originalTitle: 'Dune: Part Two',
      year: 2024,
    };

    process.env.ENABLE_TGX_IN_TESTS = '1';
    try {
      const results = await provider.search(movieReq);
      assert.equal(results.length, 2);
      assert.equal(results[0].provider, 'tgx');
      assert.ok(requestedUrl.includes('search=Dune%20Part%20Two%202024'));
      assert.ok(requestedUrl.includes('c3=1'));
    } finally {
      delete process.env.ENABLE_TGX_IN_TESTS;
    }
  });

  it('reports health when endpoint responds with HTML', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response('<html><body><div class="tgxtable"></div></body></html>', { status: 200 });
    };

    const provider = new TgxProvider('https://torrentgalaxy.to', fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'tgx');
  });
});

