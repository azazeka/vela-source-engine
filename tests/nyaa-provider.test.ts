import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NyaaProvider } from '../src/providers/nyaa-provider';
import { movieRequest, episodeRequest } from './torbox-fixtures';

const testHash = 'ef3e7ad1b12bdd9fc341691d8866cd1fa8374a4b';

const sampleRss = `
<rss xmlns:nyaa="https://nyaa.si/xmlns/nyaa" version="2.0">
<channel>
<item>
  <title>[Erai-raws] Sousou no Frieren - 04 [1080p]</title>
  <guid isPermaLink="true">https://nyaa.si/view/2160092</guid>
  <nyaa:seeders>42</nyaa:seeders>
  <nyaa:infoHash>${testHash}</nyaa:infoHash>
  <nyaa:size>1.4 GiB</nyaa:size>
</item>
</channel>
</rss>
`;

describe('NyaaProvider', () => {
  it('parses RSS releases with exact hash, seeders and size', () => {
    const provider = new NyaaProvider();
    const results = provider.parseReleasesFromRss(sampleRss);

    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'nyaa');
    assert.equal(results[0].infoHash, testHash);
    assert.equal(results[0].name, '[Erai-raws] Sousou no Frieren - 04 [1080p]');
    assert.equal(results[0].seeders, 42);
    assert.equal(results[0].sizeBytes, Math.round(1.4 * 1024 * 1024 * 1024));
    assert.equal(results[0].detailsUrl, 'https://nyaa.si/view/2160092');
  });

  it('searches for episodes with formatted query', async () => {
    let capturedUrl = '';
    const mockFetcher = (async (url: any) => {
      capturedUrl = String(url);
      return new Response(sampleRss, { status: 200 });
    }) as typeof fetch;

    process.env.ENABLE_NYAA_IN_TESTS = '1';
    try {
      const provider = new NyaaProvider('https://mock-nyaa.example', mockFetcher);
      const results = await provider.search(episodeRequest);

      assert.ok(capturedUrl.includes('page=rss&q='));
      assert.equal(results.length, 1);
      assert.equal(results[0].infoHash, testHash);
    } finally {
      delete process.env.ENABLE_NYAA_IN_TESTS;
    }
  });

  it('reports health when RSS endpoint responds with 200', async () => {
    const mockFetcher = (async () => {
      return new Response('<rss></rss>', { status: 200 });
    }) as typeof fetch;

    const provider = new NyaaProvider('https://mock-nyaa.example', mockFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'nyaa');
  });
});
