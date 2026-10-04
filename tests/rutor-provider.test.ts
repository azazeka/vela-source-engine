import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RutorProvider } from '../src/providers/rutor-provider';
import { movieRequest, episodeRequest } from './torbox-fixtures';

const testHash = '513ec652eea0844f470583c18428b23e3cf43e5e';

const sampleHtml = `
<html>
<body>
<div id="index">
<table width="100%">
<tr class="backgr"><td width="10px">Добавлен</td><td colspan="2">Название</td><td width="1px">Размер</td><td width="1px">Пиры</td></tr>
<tr class="gai">
  <td>14&nbsp;Мар&nbsp;24</td>
  <td colspan="2">
    <a class="downgif" href="//d.rutor.info/download/974374"><img src="//cdnbunny.org/i/d.gif" alt="D" /></a>
    <a href="magnet:?xt=urn:btih:${testHash}&dn=rutor.info&tr=udp://opentor.net:6969"><img src="//cdnbunny.org/i/m.png" alt="M" /></a>
    <a href="/torrent/974374/nachalo_inception-2010-bdrip-1080p">Начало / Inception (2010) BDRip 1080p &amp; 4K</a>
  </td> 
  <td align="right">13.51&nbsp;GB</td>
  <td align="center"><span class="green"><img src="//cdnbunny.org/t/arrowup.gif" alt="S" />&nbsp;22</span>&nbsp;<img src="//cdnbunny.org/t/arrowdown.gif" alt="L" /><span class="red">&nbsp;2</span></td>
</tr>
<tr class="tum">
  <td>11&nbsp;Ноя&nbsp;23</td>
  <td colspan="2">
    <a class="downgif" href="//d.rutor.info/download/953284"><img src="//cdnbunny.org/i/d.gif" alt="D" /></a>
    <a href="magnet:?xt=urn:btih:f0d3fe44d8989265969f099c6a474ee9b15a5171&dn=rutor.info"><img src="//cdnbunny.org/i/m.png" alt="M" /></a>
    <a href="/torrent/953284/hugos-voyage-inception-2023-flac">Hugo&#039;s Voyage - Inception (2023) FLAC</a>
  </td> 
  <td align="right">381.85&nbsp;MB</td>
  <td align="center"><span class="green">&nbsp;5</span>&nbsp;<span class="red">&nbsp;0</span></td>
</tr>
</table>
</div>
</body>
</html>
`;

describe('RutorProvider', () => {
  it('parses releases from HTML correctly including magnets, sizes, seeders, and HTML entities', () => {
    const provider = new RutorProvider();
    const releases = provider.parseReleasesFromHtml(sampleHtml, 'http://rutor.info');

    assert.equal(releases.length, 2);

    // First release
    assert.equal(releases[0].provider, 'rutor');
    assert.equal(releases[0].name, 'Начало / Inception (2010) BDRip 1080p & 4K');
    assert.equal(releases[0].infoHash, testHash);
    assert.equal(releases[0].magnet, `magnet:?xt=urn:btih:${testHash}&dn=rutor.info&tr=udp://opentor.net:6969`);
    assert.equal(releases[0].sizeBytes, Math.round(13.51 * 1024 * 1024 * 1024));
    assert.equal(releases[0].seeders, 22);
    assert.equal(releases[0].detailsUrl, 'http://rutor.info/torrent/974374/nachalo_inception-2010-bdrip-1080p');

    // Second release
    assert.equal(releases[1].name, "Hugo's Voyage - Inception (2023) FLAC");
    assert.equal(releases[1].infoHash, 'f0d3fe44d8989265969f099c6a474ee9b15a5171');
    assert.equal(releases[1].sizeBytes, Math.round(381.85 * 1024 * 1024));
    assert.equal(releases[1].seeders, 5);
  });

  it('searches with custom fetcher and formats query for movie and series', async () => {
    let capturedUrl = '';
    const mockFetcher = (async (url: any) => {
      capturedUrl = String(url);
      return new Response(sampleHtml, { status: 200 });
    }) as typeof fetch;

    process.env.ENABLE_RUTOR_IN_TESTS = '1';
    try {
      const provider = new RutorProvider('http://rutor.info', mockFetcher);

      const movieResults = await provider.search(movieRequest);
      assert.ok(capturedUrl.includes('/search/0/0/0/0/'));
      assert.equal(movieResults.length, 2);

      await provider.search(episodeRequest);
      assert.ok(capturedUrl.includes('S02E04') || capturedUrl.includes('S02'));
    } finally {
      delete process.env.ENABLE_RUTOR_IN_TESTS;
    }
  });

  it('reports health when mirror is responsive', async () => {
    const mockFetcher = (async () => {
      return new Response('<html><head><title>rutor.info :: Поиск</title></head><body>Результатов поиска 0</body></html>', { status: 200 });
    }) as typeof fetch;

    const provider = new RutorProvider('http://rutor.info', mockFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'rutor');
  });

  it('falls back to secondary mirror when primary mirror fails', async () => {
    let callCount = 0;
    const mockFetcher = (async (url: any) => {
      callCount++;
      if (String(url).startsWith('http://rutor.info')) {
        throw new Error('Connection refused');
      }
      return new Response(sampleHtml, { status: 200 });
    }) as typeof fetch;

    process.env.ENABLE_RUTOR_IN_TESTS = '1';
    try {
      // Create provider with default mirrors (starts with rutor.info, falls back to rutor.is)
      const provider = new RutorProvider(undefined, mockFetcher);
      const results = await provider.search(movieRequest);
      assert.equal(results.length, 2);
      assert.ok(callCount >= 2);
    } finally {
      delete process.env.ENABLE_RUTOR_IN_TESTS;
    }
  });
});
