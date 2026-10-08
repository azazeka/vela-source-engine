import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TorBoxAdapter, TorBoxError, retryAfterSeconds } from '../src/services/torbox-adapter';
import { fixtureAdapter, fixtureFetch, torrents, episodeRequest } from './torbox-fixtures';

describe('TorBox real API contract', () => {
  it('does not open another episode or invent a missing file ID', async () => {
    for (const files of [torrents[2].files, [torrents[2].files[0]]]) {
      const adapter = new TorBoxAdapter((async (input: any) => {
        assert.ok(String(input).includes('/mylist'), 'No download link may be requested for a different episode');
        return Response.json({ success: true, data: [{ ...torrents[2], files }] });
      }) as typeof fetch, undefined, 'fixture-token');
      await assert.rejects(adapter.requestDownloadLink(torrents[2].hash, 999, undefined,
        { ...episodeRequest, episode: 5 }), { statusCode: 404 });
      await assert.rejects(adapter.requestDownloadLink(torrents[2].hash, 999), { statusCode: 404 });
    }
  });

  it('waits for account file IDs instead of using cached IDs', async () => {
    const adapter = new TorBoxAdapter((async (input: any) => {
      assert.ok(String(input).includes('/mylist'));
      return Response.json({ success: true, data: [{ ...torrents[0], files: [] }] });
    }) as typeof fetch, undefined, 'fixture-token');
    await assert.rejects(adapter.requestDownloadLink(torrents[0].hash, 999, undefined, undefined,
      [{ id: 999, name: 'Film.mkv', size: 1e9 }]), { code: 'TORBOX_PREPARING' });
  });

  it('propagates authorization failures from direct torrent lookup', async () => {
    const adapter = new TorBoxAdapter((async () => new Response('{}', { status: 401 })) as typeof fetch,
      undefined, 'fixture-token');
    await assert.rejects(adapter.getTorrentById(781), { statusCode: 401 });
  });

  it('preserves Retry-After even when a rate limit response is not JSON', async () => {
    const adapter = new TorBoxAdapter((async () => new Response('Too many requests', {
      status: 429, headers: { 'Retry-After': '90' },
    })) as typeof fetch, undefined, 'fixture-token');
    await assert.rejects(adapter.checkCached(['a'.repeat(40)]), error => {
      assert.ok(error instanceof TorBoxError);
      assert.equal(error.statusCode, 429);
      assert.deepEqual(error.diagnostic, { stage: 'torboxAPI', operation: 'torrents/checkcached',
        reason: 'http', status: 429, retryAfterSeconds: 90 });
      assert.doesNotMatch(JSON.stringify(error.diagnostic), /fixture-token|https:|hash=/);
      return true;
    });
  });

  it('distinguishes transport failures from invalid API responses without exposing fetch errors', async () => {
    for (const [reason, fetcher] of [
      ['transport', async () => { throw new Error('https://api.test/?token=fixture-token'); }],
      ['invalidResponse', async () => new Response('invalid JSON')],
    ] as const) {
      const adapter = new TorBoxAdapter(fetcher as typeof fetch, undefined, 'fixture-token');
      await assert.rejects(adapter.checkCached(['a'.repeat(40)]), error => {
        assert.ok(error instanceof TorBoxError);
        assert.equal(error.diagnostic?.reason, reason);
        assert.doesNotMatch(String(error), /fixture-token|https:/);
        return true;
      });
    }
  });

  it('parses Retry-After seconds and HTTP dates and rejects invalid delays', () => {
    assert.equal(retryAfterSeconds('60', 0), 60);
    assert.equal(retryAfterSeconds('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60);
    for (const value of ['-1', 'garbage', '86401', '99999999999999999999999999']) {
      assert.equal(retryAfterSeconds(value, 0), undefined);
    }
  });

  it('rejects missing credentials without starting a network request', async () => {
    let calls = 0;
    const adapter = new TorBoxAdapter((async () => { calls++; throw new Error(); }) as typeof fetch, undefined, '');
    await assert.rejects(adapter.checkCached(['a'.repeat(40)]), /API key/);
    assert.equal(await adapter.health(), 'unauthorized');
    assert.equal(calls, 0);
  });

  it('rejects 401, 500, unsuccessful JSON and network failures instead of mock cache data', async () => {
    for (const fetcher of [
      async () => new Response('{}', { status: 401 }),
      async () => new Response('{}', { status: 500 }),
      async () => Response.json({ success: false, data: [] }),
      async () => { throw new Error('network failure containing a secret'); },
    ]) {
      const adapter = new TorBoxAdapter(fetcher as typeof fetch, undefined, 'fixture-token');
      await assert.rejects(adapter.checkCached(['a'.repeat(40)]));
    }
  });

  it('preserves rejection reasons and never retries an account limit as a cache miss', async () => {
    for (const status of [200, 400, 429]) {
      let creates = 0;
      const adapter = new TorBoxAdapter((async (input: any) => {
        if (String(input).includes('/mylist')) return Response.json({ success: true, data: [] });
        creates++;
        return Response.json({ success: false, detail: 'Active downloading limit reached.' }, { status });
      }) as typeof fetch, undefined, 'fixture-token');
      await assert.rejects(adapter.requestDownloadLink('d'.repeat(40), 1),
        { code: 'TORBOX_REJECTED', message: 'Active downloading limit reached.' });
      assert.equal(creates, 1);
    }
  });

  it('identifies cache misses without starting an uncached download for playback', async () => {
    let creates = 0;
    const adapter = new TorBoxAdapter((async (input: any, init?: RequestInit) => {
      if (String(input).includes('/mylist')) return Response.json({ success: true, data: [] });
      creates++;
      assert.equal((init?.body as FormData).get('add_only_if_cached'), 'true');
      return Response.json({ success: false, error: 'NOT_CACHED' }, { status: 400 });
    }) as typeof fetch, undefined, 'fixture-token');
    await assert.rejects(adapter.requestDownloadLink('d'.repeat(40), 1, undefined, undefined, undefined, false),
      { statusCode: 409, code: 'TORBOX_NOT_CACHED' });
    assert.equal(creates, 1);
  });

  it('removes tokens and URLs from API rejection details', async () => {
    const adapter = new TorBoxAdapter((async () => Response.json({ success: false,
      detail: 'Limit reached for fixture-token at https://example.test/?token=secret' }, { status: 400 })) as typeof fetch,
      undefined, 'fixture-token');
    await assert.rejects(adapter.checkCached(['a'.repeat(40)]), error => {
      assert.match(String(error), /Limit reached/);
      assert.doesNotMatch(String(error), /fixture-token|secret|https:/);
      return true;
    });
  });

  it('matches account file IDs even when cached file IDs differ', async () => {
    const calls: URL[] = [];
    const stream = await fixtureAdapter(calls).requestDownloadLink(torrents[2].hash, 999, undefined, episodeRequest);
    assert.equal(stream.fileName, 'Silo.S02E04.2160p.mkv');
    assert.equal(calls.at(-1)?.searchParams.get('file_id'), '42');
    assert.equal(calls.at(-1)?.searchParams.get('torrent_id'), '783');
  });

  it('paginates the account library', async () => {
    const offsets: number[] = [];
    const adapter = new TorBoxAdapter((async (input: any) => {
      const offset = Number(new URL(String(input)).searchParams.get('offset')); offsets.push(offset);
      return Response.json({ success: true, data: offset === 0 ? Array.from({ length: 100 }, (_, id) => ({ ...torrents[0], id })) : [torrents[1]] });
    }) as typeof fetch, undefined, 'fixture-token');
    assert.equal((await adapter.listTorrents()).length, 101);
    assert.deepEqual(offsets, [0, 100]);
  });

  it('never uses a hash as the account ID for a missing torrent', async () => {
    const calls: URL[] = [];
    await assert.rejects(fixtureAdapter(calls).requestDownloadLink('d'.repeat(40), 1), /HTTP 404/);
    assert.ok(calls.every(url => !url.pathname.endsWith('/requestdl')));
  });

  it('does not resolve incomplete or removed downloads', async () => {
    for (const state of [{ download_finished: false, download_present: true }, { download_finished: true, download_present: false }]) {
      const adapter = new TorBoxAdapter((async () => Response.json({ success: true, data: [{ ...torrents[0], ...state }] })) as typeof fetch, undefined, 'fixture-token');
      await assert.rejects(adapter.requestDownloadLink(torrents[0].hash, 17), /still downloading/);
    }
  });

  it('rejects non-HTTPS playback URLs and does not leak token-bearing fetch errors', async () => {
    const real = fixtureFetch();
    const adapter = new TorBoxAdapter((async (input: any, init: any) => {
      if (String(input).includes('/requestdl')) return Response.json({ success: true, data: 'http://example.test/video.mkv' });
      return real(input, init);
    }) as typeof fetch, undefined, 'fixture-token');
    await assert.rejects(adapter.requestDownloadLink(torrents[0].hash, 17), /HTTPS/);
    const failing = new TorBoxAdapter((async () => { throw new Error('fixture-token'); }) as typeof fetch, undefined, 'fixture-token');
    await assert.rejects(failing.checkCached([torrents[0].hash]), error => !String(error).includes('fixture-token'));
  });
});
