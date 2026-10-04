import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PornolabProvider } from '../src/providers/pornolab-provider';
import { MediaRequest } from '../src/types';

const testHash = '513ec652eea0844f470583c18428b23e3cf43e5e';

const samplePornolabHtml = `
<html>
<body>
<div id="tor-tbl">
  <table class="forumline tablesorter">
    <tr class="tCenter hl-tr" id="tor-123456">
      <td class="topic_id">123456</td>
      <td class="tt">
        <a class="tt-text" href="viewtopic.php?t=123456"><b>Eva Elfie - Private Collection (2024) 1080p HDTV</b></a>
      </td>
      <td class="tor-size" data-ts_text="2684354560">
        <a class="small tr-dl" href="dl.php?id=123456">2.5 GB</a>
        <a href="magnet:?xt=urn:btih:${testHash}&dn=Eva+Elfie"><img src="magnet.png"></a>
      </td>
      <td class="seedmed"><b>56</b></td>
    </tr>
    <tr class="tCenter hl-tr" id="tor-123457">
      <td class="topic_id">123457</td>
      <td class="tt">
        <a class="tt-text" href="viewtopic.php?t=123457"><b>Brazzers Exclusives (2023) 2160p 4K UHD</b></a>
      </td>
      <td class="tor-size" data-ts_text="6442450944">
        <a class="small tr-dl" href="dl.php?id=123457">6.0 GB</a>
        <a href="magnet:?xt=urn:btih:f0d3fe44d8989265969f099c6a474ee9b15a5171&dn=Brazzers"><img src="magnet.png"></a>
      </td>
      <td class="seedmed"><b>110</b></td>
    </tr>
  </table>
</div>
</body>
</html>
`;

describe('PornolabProvider', () => {
  it('parses releases from HTML correctly', () => {
    const provider = new PornolabProvider();
    const releases = provider.parseReleasesFromHtml(samplePornolabHtml, 'https://pornolab.net');

    assert.equal(releases.length, 2);

    // First release
    assert.equal(releases[0].provider, 'pornolab');
    assert.equal(releases[0].name, 'Eva Elfie - Private Collection (2024) 1080p HDTV');
    assert.equal(releases[0].infoHash, testHash);
    assert.equal(releases[0].magnet, `magnet:?xt=urn:btih:${testHash}&dn=Eva+Elfie`);
    assert.equal(releases[0].sizeBytes, 2684354560);
    assert.equal(releases[0].seeders, 56);
    assert.equal(releases[0].detailsUrl, 'https://pornolab.net/forum/viewtopic.php?t=123456');

    // Second release
    assert.equal(releases[1].name, 'Brazzers Exclusives (2023) 2160p 4K UHD');
    assert.equal(releases[1].infoHash, 'f0d3fe44d8989265969f099c6a474ee9b15a5171');
    assert.equal(releases[1].sizeBytes, 6442450944);
    assert.equal(releases[1].seeders, 110);
    assert.equal(releases[1].detailsUrl, 'https://pornolab.net/forum/viewtopic.php?t=123457');
  });

  it('searches with query and constructs tracker path', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(samplePornolabHtml, { status: 200 });
    };

    const provider = new PornolabProvider('https://pornolab.net', undefined, fakeFetcher);
    const adultReq: MediaRequest = {
      type: 'movie',
      tmdbId: -1,
      title: 'Sweetie Fox',
      originalTitle: 'Sweetie Fox',
      year: 2024,
      isAdult: true,
    };

    const results = await provider.search(adultReq);
    assert.equal(results.length, 2);
    assert.ok(requestedUrl.includes('nm=Sweetie%20Fox'));
  });

  it('reports health when forum returns html', async () => {
    const fakeFetcher: typeof fetch = async () => {
      return new Response('<html><body><div>pornolab forum</div></body></html>', { status: 200 });
    };

    const provider = new PornolabProvider('https://pornolab.net', undefined, fakeFetcher);
    const health = await provider.health();
    assert.equal(health.healthy, true);
    assert.equal(health.id, 'pornolab');
  });
});
