import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GayTorrentRuProvider } from '../src/providers/gaytorrent-ru-provider';
import { MediaRequest } from '../src/types';

const testHash = '1234567890abcdef1234567890abcdef12345678';

const sampleGayTorrentRuHtml = `
<html>
<body>
<table id="browsetable">
  <tbody>
    <tr class="browse_row" id="torrent_554433">
      <td class="cat_icon"><a href="browse.php?cat=29">Anal</a></td>
      <td class="name">
        <a href="details.php?id=554433" data-hash="${testHash}"><b>BelAmi - Summer Days (2024) 1080p WEB-DL</b></a>
      </td>
      <td class="size">2.14 GB</td>
      <td class="seeds"><b>45</b></td>
      <td class="leechs">2</td>
    </tr>
    <tr class="browse_row" id="torrent_554434">
      <td class="cat_icon"><a href="browse.php?cat=43">Bareback</a></td>
      <td class="name">
        <a href="details.php?id=554434"><b>CockyBoys - The Reunion (2024) 2160p UHD</b></a>
        <a href="magnet:?xt=urn:btih:fedcba0987654321fedcba0987654321fedcba09&dn=CockyBoys"><img src="magnet.png"></a>
      </td>
      <td class="size">5.80 GB</td>
      <td class="seeds"><b>88</b></td>
      <td class="leechs">5</td>
    </tr>
  </tbody>
</table>
</body>
</html>
`;

describe('GayTorrentRuProvider', () => {
  it('parses releases from HTML correctly', () => {
    const provider = new GayTorrentRuProvider();
    const releases = provider.parseReleasesFromHtml(sampleGayTorrentRuHtml, 'https://www.gaytor.rent');

    assert.equal(releases.length, 2);

    // First release (data-hash)
    assert.equal(releases[0].provider, 'gaytorrent-ru');
    assert.equal(releases[0].name, 'BelAmi - Summer Days (2024) 1080p WEB-DL');
    assert.equal(releases[0].infoHash, testHash);
    assert.equal(releases[0].sizeBytes, 2297807503); // 2.14 GB in bytes
    assert.equal(releases[0].seeders, 45);
    assert.equal(releases[0].detailsUrl, 'https://www.gaytor.rent/details.php?id=554433');

    // Second release (magnet link)
    assert.equal(releases[1].name, 'CockyBoys - The Reunion (2024) 2160p UHD');
    assert.equal(releases[1].infoHash, 'fedcba0987654321fedcba0987654321fedcba09');
    assert.equal(releases[1].sizeBytes, 6227702579);
    assert.equal(releases[1].seeders, 88);
    assert.equal(releases[1].detailsUrl, 'https://www.gaytor.rent/details.php?id=554434');
  });

  it('searches with query and constructs search path', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(sampleGayTorrentRuHtml, { status: 200 });
    };

    const provider = new GayTorrentRuProvider('https://www.gaytor.rent', 'session=123', fakeFetcher);
    const adultReq: MediaRequest = {
      type: 'movie',
      tmdbId: -1,
      title: 'BelAmi',
      originalTitle: 'BelAmi',
      year: 2024,
      isAdult: true,
    };

    const results = await provider.search(adultReq);
    assert.equal(results.length, 2);
    assert.ok(requestedUrl.includes('search=BelAmi'));
    assert.ok(requestedUrl.includes('orderby=seeds'));
  });

  it('reports health when mirror responds with expected content', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response('<html><body><div>gaytor browsetable</div></body></html>', { status: 200 });
    };

    const provider = new GayTorrentRuProvider('https://www.gaytor.rent', undefined, fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'gaytorrent-ru');
  });
});
