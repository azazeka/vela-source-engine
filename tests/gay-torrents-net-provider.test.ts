import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GayTorrentsNetProvider } from '../src/providers/gay-torrents-net-provider';
import { MediaRequest } from '../src/types';

const testHash = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';

const sampleGayTorrentsNetHtml = `
<html>
<body>
<div class="block">
  <ul class="TorrentList">
    <li class="TorrentList1"><a href="torrentslist.php?type=porn/HD-Movies">HD-Movies</a></li>
    <li class="TorrentList2">
      <a href="torrentdetails.php?torrentid=778899" data-hash="${testHash}">Sean Cody - Bryce & Hunter (2024) 1080p</a>
    </li>
    <li class="TorrentList3">1.85 GB</li>
    <li class="TorrentList6"><b>64</b></li>
  </ul>
  <ul class="Torrent-List">
    <li class="Torrent-List-Cat"><a href="torrentslist.php?type=porn/Bears">Bears</a></li>
    <li class="Torrent-List-Title">
      <a href="torrentdetails.php?torrentid=778900">[FFL] Corbin Fisher - Down on the Farm (2023) 2160p</a>
      <a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Corbin+Fisher"><img src="magnet.gif"></a>
    </li>
    <li class="Torrent-List-Size">4.20 GB</li>
    <li class="Torrent-List-Seeds"><b>38</b></li>
  </ul>
</div>
</body>
</html>
`;

describe('GayTorrentsNetProvider', () => {
  it('parses releases from HTML correctly stripping [FFL]', () => {
    const provider = new GayTorrentsNetProvider();
    const releases = provider.parseReleasesFromHtml(sampleGayTorrentsNetHtml, 'https://www.gay-torrents.net');

    assert.equal(releases.length, 2);

    // First release
    assert.equal(releases[0].provider, 'gay-torrents-net');
    assert.equal(releases[0].name, 'Sean Cody - Bryce & Hunter (2024) 1080p');
    assert.equal(releases[0].infoHash, testHash);
    assert.equal(releases[0].sizeBytes, 1986422374); // 1.85 GB
    assert.equal(releases[0].seeders, 64);
    assert.equal(releases[0].detailsUrl, 'https://www.gay-torrents.net/torrentdetails.php?torrentid=778899');

    // Second release ([FFL] stripped)
    assert.equal(releases[1].name, 'Corbin Fisher - Down on the Farm (2023) 2160p');
    assert.equal(releases[1].infoHash, '0123456789abcdef0123456789abcdef01234567');
    assert.equal(releases[1].sizeBytes, 4509715661); // 4.20 GB
    assert.equal(releases[1].seeders, 38);
    assert.equal(releases[1].detailsUrl, 'https://www.gay-torrents.net/torrentdetails.php?torrentid=778900');
  });

  it('searches with query and constructs search path', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(sampleGayTorrentsNetHtml, { status: 200 });
    };

    const provider = new GayTorrentsNetProvider('https://www.gay-torrents.net', 'vb_login=123', fakeFetcher);
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
    assert.ok(requestedUrl.includes('textsearch=Sean%20Cody'));
  });

  it('reports health when mirror responds with expected content', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response('<html><body><div>Gay-Torrents TorrentList</div></body></html>', { status: 200 });
    };

    const provider = new GayTorrentsNetProvider('https://www.gay-torrents.net', undefined, fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'gay-torrents-net');
  });
});
