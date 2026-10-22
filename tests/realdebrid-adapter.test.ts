import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RealDebridAdapter, RealDebridError } from '../src/services/realdebrid-adapter';
import { MediaRequest } from '../src/types';

describe('RealDebridAdapter unit tests', () => {
  it('health returns ok for premium user', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ id: 12345, username: 'testuser', type: 'premium', premium: 1775836800 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const adapter = new RealDebridAdapter(mockFetch as any);
    const status = await adapter.health('mock_token');
    assert.equal(status, 'ok');
  });

  it('health returns unauthorized on 401', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({ error: 'bad_token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });

    const adapter = new RealDebridAdapter(mockFetch as any);
    const status = await adapter.health('bad_token');
    assert.equal(status, 'unauthorized');
  });

  it('checkCached correctly parses RD instantAvailability response', async () => {
    const mockHash1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const mockHash2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const mockResponse: any = {
      [mockHash1]: {
        rd: [
          {
            '1': { filename: 'Movie.2024.2160p.mkv', filesize: 15000000000 },
            '2': { filename: 'Sample.mkv', filesize: 50000000 },
          },
        ],
      },
      [mockHash2]: {
        rd: [],
      },
    };

    const mockFetch = async (url: string | URL) => {
      const urlStr = url.toString();
      assert.ok(urlStr.includes(mockHash1));
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const adapter = new RealDebridAdapter(mockFetch as any);
    const result = await adapter.checkCached([mockHash1, mockHash2], 'mock_token');

    assert.equal(result.has(mockHash1), true);
    assert.equal(result.has(mockHash2), false);

    const cached = result.get(mockHash1)!;
    assert.equal(cached.hash, mockHash1);
    assert.equal(cached.name, 'Movie.2024.2160p.mkv');
    assert.equal(cached.size, 15050000000);
    assert.equal(cached.files.length, 2);
    assert.equal(cached.files[0].id, 1);
    assert.equal(cached.files[0].name, 'Movie.2024.2160p.mkv');
  });

  it('health reports degraded for free or expired accounts', async () => {
    for (const user of [{ type: 'free', premium: 0 }, { type: 'premium', premium: 0 }]) {
      const adapter = new RealDebridAdapter((async () => new Response(JSON.stringify(user))) as typeof fetch);
      assert.equal(await adapter.health('token'), 'degraded');
    }
  });

  it('preserves infringing_file as a file rejection, including HTTP 403', async () => {
    for (const status of [400, 403, 451, 503]) {
      const paths: string[] = [];
      const adapter = new RealDebridAdapter((async (url: string | URL, init?: RequestInit) => {
        const path = new URL(url).pathname;
        paths.push(path);
        assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer token');
        if (path.endsWith('/torrents')) return new Response('[]');
        assert.ok(path.endsWith('/torrents/addMagnet'));
        assert.equal(init?.method, 'POST');
        assert.equal(new URLSearchParams(String(init?.body)).get('magnet'), `magnet:?xt=urn:btih:${'a'.repeat(40)}`);
        return new Response(JSON.stringify({ error: 'infringing_file', error_code: 35 }), { status });
      }) as typeof fetch);
      await assert.rejects(adapter.requestDownloadLink('a'.repeat(40), 0, 'token'), (error: any) => {
        assert.equal(error.statusCode, 422);
        assert.equal(error.code, 'REALDEBRID_REJECTED');
        assert.match(error.message, /restriction on this file/);
        return true;
      });
      assert.equal(paths.length, 2);
    }
  });

  it('requestDownloadLink unrestricts link when torrent is cached', async () => {
    const mockHash = 'cccccccccccccccccccccccccccccccccccccccc';

    const mockFetch = async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();

      if (urlStr.includes('/torrents?limit=100')) {
        return new Response(
          JSON.stringify([
            {
              id: 'RD_TID_1',
              hash: mockHash,
              filename: 'Gladiator.II.2024.2160p.mkv',
              bytes: 14000000000,
              status: 'downloaded',
              progress: 100,
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('/torrents/info/RD_TID_1')) {
        return new Response(
          JSON.stringify({
            id: 'RD_TID_1',
            hash: mockHash,
            filename: 'Gladiator.II.2024.2160p.mkv',
            bytes: 14000000000,
            status: 'downloaded',
            progress: 100,
            files: [
              { id: 1, path: '/Gladiator.II.2024.2160p.mkv', bytes: 14000000000, selected: 1 },
            ],
            links: ['https://real-debrid.com/d/LINK1'],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (urlStr.includes('/unrestrict/link')) {
        return new Response(
          JSON.stringify({
            id: 'UNRESTRICT_1',
            filename: 'Gladiator.II.2024.2160p.mkv',
            download: 'https://12.download.real-debrid.com/d/LINK1/Gladiator.II.2024.2160p.mkv',
            filesize: 14000000000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Not found', { status: 404 });
    };

    const adapter = new RealDebridAdapter(mockFetch as any);
    const stream = await adapter.requestDownloadLink(mockHash, 1, 'mock_token');

    assert.equal(stream.streamUrl, 'https://12.download.real-debrid.com/d/LINK1/Gladiator.II.2024.2160p.mkv');
    assert.equal(stream.fileName, 'Gladiator.II.2024.2160p.mkv');
    assert.equal(stream.sizeBytes, 14000000000);
    assert.equal(stream.mimeType, 'video/x-matroska');
  });

  it('preserves the full source magnet when adding a torrent', async () => {
    const hash = 'a'.repeat(40);
    const magnet = `magnet:?xt=urn:btih:${hash}&dn=Control%20Film&tr=https%3A%2F%2Ftracker.example%2Fannounce`;
    let added = false;
    const adapter = new RealDebridAdapter((async (url: string | URL, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/torrents')) return new Response('[]');
      if (path.endsWith('/addMagnet')) {
        assert.equal(new URLSearchParams(String(init?.body)).get('magnet'), magnet);
        added = true;
        return new Response(JSON.stringify({ id: 'CONTROL' }), { status: 201 });
      }
      if (path.endsWith('/info/CONTROL')) return new Response(JSON.stringify({
        hash, filename: 'Control Film.mkv', status: 'downloaded',
        files: [{ id: 1, path: '/Control Film.mkv', selected: 1, bytes: 1000 }], links: ['https://rd.test/control'],
      }));
      if (path.endsWith('/unrestrict/link')) return new Response(JSON.stringify({ download: 'https://cdn.test/control.mkv' }));
      throw new Error('Unexpected endpoint');
    }) as typeof fetch);
    const stream = await adapter.requestDownloadLink(magnet, 1, 'token');
    assert.equal(added, true);
    assert.equal(stream.streamUrl, 'https://cdn.test/control.mkv');
  });

  it('requestDownloadLink throws 409 when torrent is not cached and allowUncached=false', async () => {
    const mockHash = 'dddddddddddddddddddddddddddddddddddddddd';

    const mockFetch = async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/torrents?limit=100')) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/torrents/addMagnet')) {
        return new Response(JSON.stringify({ id: 'RD_NEW_TID' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/torrents/info/RD_NEW_TID')) {
        return new Response(
          JSON.stringify({
            id: 'RD_NEW_TID',
            hash: mockHash,
            filename: 'Rare.Film.mkv',
            status: 'downloading',
            progress: 0,
            files: [{ id: 1, path: '/Rare.Film.mkv', bytes: 1000000000, selected: 1 }],
            links: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const adapter = new RealDebridAdapter(mockFetch as any);
    await assert.rejects(
      async () => {
        await adapter.requestDownloadLink(mockHash, 1, 'mock_token', undefined, undefined, false);
      },
      (err: any) => {
        assert.ok(err instanceof RealDebridError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, 'REALDEBRID_NOT_CACHED');
        return true;
      }
    );
  });

  it('RealDebridLibraryProvider returns ready releases for matching media', async () => {
    const mockHash = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const mockFetch = async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/torrents?limit=100')) {
        return new Response(JSON.stringify([{
          id: 'RD_LIB_1',
          hash: mockHash,
          filename: 'Inception.2010.2160p.UHD.mkv',
          bytes: 25000000000,
          status: 'downloaded',
          progress: 100,
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/torrents/info/RD_LIB_1')) {
        return new Response(JSON.stringify({
          id: 'RD_LIB_1',
          hash: mockHash,
          filename: 'Inception.2010.2160p.UHD.mkv',
          status: 'downloaded',
          bytes: 25000000000,
          files: [{ id: 1, path: '/Inception.2010.2160p.UHD.mkv', bytes: 25000000000, selected: 1 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    };

    const { RealDebridLibraryProvider } = await import('../src/providers/realdebrid-library-provider');
    const adapter = new RealDebridAdapter(mockFetch as any);
    const provider = new RealDebridLibraryProvider(adapter);
    const results = await provider.search({ type: 'movie', tmdbId: 27205, title: 'Inception', originalTitle: 'Inception', year: 2010 }, 'token');
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'realdebrid-library');
    assert.equal(results[0].infoHash, mockHash);
    assert.equal(results[0].sizeBytes, 25000000000);
  });
});
