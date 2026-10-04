import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PornolabGayProvider } from '../src/providers/pornolab-gay-provider';
import { MediaRequest } from '../src/types';

const testHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const samplePornolabGayHtml = `
<html>
<body>
<div id="tor-tbl">
  <table class="forumline tablesorter">
    <tr class="tCenter hl-tr" id="tor-991234">
      <td class="topic_id">991234</td>
      <td class="tt">
        <a class="tt-text" href="viewtopic.php?t=991234"><b>Lucas Entertainment - Men of Madrid (2024) 1080p Full HD</b></a>
      </td>
      <td class="tor-size" data-ts_text="3221225472">
        <a class="small tr-dl" href="dl.php?id=991234">3.0 GB</a>
        <a href="magnet:?xt=urn:btih:${testHash}&dn=Men+of+Madrid"><img src="magnet.png"></a>
      </td>
      <td class="seedmed"><b>72</b></td>
    </tr>
  </table>
</div>
</body>
</html>
`;

describe('PornolabGayProvider', () => {
  it('parses gay releases from HTML with proper provider id', () => {
    const provider = new PornolabGayProvider();
    const releases = provider.parseReleasesFromHtml(samplePornolabGayHtml, 'https://pornolab.net');

    assert.equal(releases.length, 1);
    assert.equal(releases[0].provider, 'pornolab-gay');
    assert.equal(releases[0].name, 'Lucas Entertainment - Men of Madrid (2024) 1080p Full HD');
    assert.equal(releases[0].infoHash, testHash);
    assert.equal(releases[0].sizeBytes, 3221225472);
    assert.equal(releases[0].seeders, 72);
    assert.equal(releases[0].detailsUrl, 'https://pornolab.net/forum/viewtopic.php?t=991234');
  });

  it('searches with gay subforum filters included in request path', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(samplePornolabGayHtml, { status: 200 });
    };

    const provider = new PornolabGayProvider('https://pornolab.net', undefined, fakeFetcher);
    const adultReq: MediaRequest = {
      type: 'movie',
      tmdbId: -1,
      title: 'Lucas Entertainment',
      originalTitle: 'Lucas Entertainment',
      year: 2024,
      isAdult: true,
    };

    const results = await provider.search(adultReq);
    assert.equal(results.length, 1);
    assert.ok(requestedUrl.includes('nm=Lucas%20Entertainment'));
    // Ensure all target subforum IDs are included in filter
    for (const forumId of PornolabGayProvider.GAY_FORUMS) {
      assert.ok(requestedUrl.includes(`f%5B%5D=${forumId}`) || requestedUrl.includes(`f[]=${forumId}`));
    }
  });

  it('queries trending specifically for gay forums when query is empty', async () => {
    let requestedUrl = '';
    const fakeFetcher: typeof fetch = async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return new Response(samplePornolabGayHtml, { status: 200 });
    };

    const provider = new PornolabGayProvider('https://pornolab.net', undefined, fakeFetcher);
    const trendingReq: MediaRequest = {
      type: 'movie',
      tmdbId: -1,
      title: '',
      originalTitle: '',
      year: 2024,
      isAdult: true,
    };

    await provider.search(trendingReq);
    assert.ok(!requestedUrl.includes('nm='));
    assert.ok(requestedUrl.includes('o=10&s=2'));
    assert.ok(requestedUrl.includes('f%5B%5D=903') || requestedUrl.includes('f[]=903'));
  });
});
