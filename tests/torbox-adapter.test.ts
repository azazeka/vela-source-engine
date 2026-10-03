import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TorBoxAdapter } from '../src/services/torbox-adapter';
import { fixtureAdapter, fixtureFetch, torrents, episodeRequest } from './torbox-fixtures';

describe('TorBox real API contract', () => {
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
    await assert.rejects(fixtureAdapter(calls).requestDownloadLink('d'.repeat(40), 1), /not cached or could not be added/);
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
