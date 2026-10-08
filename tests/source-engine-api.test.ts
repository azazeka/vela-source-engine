import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/api/server';
import { CacheManager } from '../src/services/cache-manager';
import { fixtureAdapter, fixtureFetch, movieRequest, episodeRequest } from './torbox-fixtures';
import { TorBoxAdapter } from '../src/services/torbox-adapter';

// Exercise the real default provider and the HTTP routes with fixture TorBox responses.
describe('SourceEngine and REST API', () => {
  beforeEach(() => CacheManager.clear());

  it('searches every provider and chooses quality across sources without losing ready library files', async () => {
    const searched: string[] = [];
    const calls: URL[] = [];
    const { sourceEngine } = createApp({ torboxAdapter: fixtureAdapter(calls), providers: [] });
    const releases = [
      { provider: 'torznab-torlock', name: 'Dune.Part.Two.2024', infoHash: 'a'.repeat(40), sizeBytes: 35e9, seeders: 200 },
      { provider: 'rutor', name: 'Dune.Part.Two.2024.2160p.WEB-DL.HEVC.DDP5.1.DV', infoHash: 'a'.repeat(40), sizeBytes: 35e9, seeders: 20 },
      { provider: 'torbox-library', name: 'Dune.Part.Two.2024.1080p.BluRay.x264', infoHash: 'b'.repeat(40), sizeBytes: 12e9, seeders: 0,
        libraryFiles: [{ id: 24, name: 'Dune.Part.Two.2024.1080p.BluRay.x264.mkv', size: 12e9 }] },
    ];
    for (const release of releases) sourceEngine.registerProvider({ id: release.provider, name: release.provider,
      search: async () => { searched.push(release.provider); return [release]; },
      health: async () => ({ id: release.provider, healthy: true, latencyMs: 0 }) });
    sourceEngine.registerProvider({ id: 'broken', name: 'Broken', search: async () => { throw new Error('Unavailable'); },
      health: async () => ({ id: 'broken', healthy: false, latencyMs: 0 }) });
    const candidates = await sourceEngine.searchCandidates(movieRequest);
    assert.deepEqual(searched.sort(), ['rutor', 'torbox-library', 'torznab-torlock']);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].provider, 'rutor');
    assert.equal(candidates[0].quality, '2160p');
    assert.equal(candidates[0].seeders, 200);
    assert.equal(candidates[1].fileId, 24);
    const resolved = await sourceEngine.resolvePlay(movieRequest);
    assert.equal(resolved.candidate.candidateId, candidates[0].candidateId);
    assert.equal(resolved.stream.streamUrl, 'https://cdn.example.test/781/17.mkv');
    assert.equal(searched.length, 3, 'reuses the complete search cache');
  });

  it('maps legacy data saver requests to maximum quality for versions and autoplay', async () => {
    const { app } = createApp({ torboxAdapter: fixtureAdapter() });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { 'Content-Type': 'application/json' };
    try {
      const search = await fetch(`${base}/sources/search`, { method: 'POST', headers,
        body: JSON.stringify({ request: movieRequest, preset: 'best' }) });
      assert.equal(search.status, 200);
      assert.equal((await search.json() as any).candidates[0].quality, '2160p');
      const versions = await fetch(`${base}/versions/movie:693134?preset=data_saver`);
      assert.equal(versions.status, 200);
      assert.equal((await versions.json() as any).versions[0].quality, '2160p');
      const play = await fetch(`${base}/play/resolve`, { method: 'POST', headers,
        body: JSON.stringify({ request: movieRequest, preset: 'data_saver' }) });
      assert.equal(play.status, 200);
      assert.equal((await play.json() as any).candidate.quality, '2160p');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('returns an actionable uncached error without adding a torrent implicitly', async () => {
    let creates = 0;
    const adapter = new TorBoxAdapter((async (input: any) => {
      if (String(input).includes('/createtorrent')) creates++;
      return Response.json({ success: true, data: [] });
    }) as typeof fetch, undefined, 'fixture-token');
    const { sourceEngine } = createApp({ torboxAdapter: adapter });
    sourceEngine.registerProvider({ id: 'external', name: 'External',
      search: async () => [{ provider: 'external', name: 'Silo.S02E04.2160p.WEB-DL',
        infoHash: 'd'.repeat(40), sizeBytes: 4e9, seeders: 100 }],
      health: async () => ({ id: 'external', healthy: true, latencyMs: 0 }) });
    await assert.rejects(sourceEngine.resolvePlay(episodeRequest), { statusCode: 409, code: 'TORBOX_NOT_CACHED' });
    const versions = await sourceEngine.searchCandidates(episodeRequest);
    assert.ok(versions.length > 0);
    assert.ok(versions.every(candidate => candidate.mediaKey === 'episode:125988:2:4'));
    assert.equal(creates, 0);
  });

  it('plays ready library copies when global cache checking is unavailable', async () => {
    const calls: URL[] = [];
    const fixtures = fixtureFetch(calls);
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).includes('/checkcached')) return new Response('{}', { status: 503 });
      return fixtures(input, init);
    };
    const { sourceEngine } = createApp({ torboxAdapter: new TorBoxAdapter(fetcher, undefined, 'fixture-token') });
    const resolved = await sourceEngine.resolvePlay(movieRequest);
    assert.equal(resolved.stream.streamUrl, 'https://cdn.example.test/781/17.mkv');
    assert.equal(resolved.candidate.fileId, 17);
    assert.equal(calls.some(url => url.pathname.endsWith('/checkcached')), false);
  });

  it('keeps ready library sources when cache checking external results fails', async () => {
    const fixtures = fixtureFetch();
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).includes('/checkcached')) return new Response('{}', { status: 503 });
      return fixtures(input, init);
    };
    const { sourceEngine } = createApp({ torboxAdapter: new TorBoxAdapter(fetcher, undefined, 'fixture-token') });
    sourceEngine.registerProvider({ id: 'external', name: 'External',
      search: async () => [{ provider: 'external', name: 'Dune.Part.Two.2024.2160p.WEB-DL',
        infoHash: 'd'.repeat(40), sizeBytes: 40e9, seeders: 100 }],
      health: async () => ({ id: 'external', healthy: true, latencyMs: 0 }) });
    const resolved = await sourceEngine.resolvePlay(movieRequest);
    assert.equal(resolved.stream.streamUrl, 'https://cdn.example.test/781/17.mkv');
  });

  it('finds real library releases and resolves a numeric torrent ID', async () => {
    const calls: URL[] = [];
    const { sourceEngine } = createApp({ torboxAdapter: fixtureAdapter(calls) });
    const candidates = await sourceEngine.searchCandidates(movieRequest);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].provider, 'torbox-library');
    assert.equal(candidates[0].quality, '2160p');
    const resolved = await sourceEngine.resolvePlay(movieRequest);
    assert.equal(resolved.stream.streamUrl, 'https://cdn.example.test/781/17.mkv');
    assert.equal(calls.at(-1)?.searchParams.get('torrent_id'), '781');
    assert.equal(resolved.stream.sizeBytes, 35e9);
  });

  it('does not fabricate sources for absent titles', async () => {
    const { sourceEngine } = createApp({ torboxAdapter: fixtureAdapter() });
    assert.deepEqual(await sourceEngine.searchCandidates({ ...movieRequest, tmdbId: 999, title: 'Absent', originalTitle: 'Absent' }), []);
    await assert.rejects(sourceEngine.resolvePlay({ ...movieRequest, tmdbId: 999, title: 'Absent', originalTitle: 'Absent' }),
      { statusCode: 404, message: 'No playable candidates found for this media.' });
  });

  it('scopes failures to the account', async () => {
    const adapter = fixtureAdapter();
    const { sourceEngine } = createApp({ torboxAdapter: adapter });
    const before = await sourceEngine.searchCandidates(movieRequest, 'best', 'account-a');
    CacheManager.markCandidateFailure(before[0].candidateId, undefined, adapter.cacheScope('account-a'));
    const after = await sourceEngine.searchCandidates(movieRequest, 'best', 'account-a');
    assert.notEqual(after[0].candidateId, before[0].candidateId);
    const other = await sourceEngine.searchCandidates(movieRequest, 'best', 'account-b');
    assert.equal(other[0].candidateId, before[0].candidateId);
  });

  it('does not resurrect failed candidates when the last cached version fails', async () => {
    const adapter = fixtureAdapter();
    const { sourceEngine } = createApp({ torboxAdapter: adapter });
    const candidates = await sourceEngine.searchCandidates(movieRequest);
    for (const candidate of candidates) CacheManager.markCandidateFailure(candidate.candidateId, undefined, adapter.cacheScope());
    assert.deepEqual(await sourceEngine.searchCandidates(movieRequest), []);
    await assert.rejects(sourceEngine.resolvePlay(movieRequest), /No playable/);
  });

  it('rejects an unavailable manual selection', async () => {
    const { sourceEngine } = createApp({ torboxAdapter: fixtureAdapter() });
    await assert.rejects(sourceEngine.resolvePlay(movieRequest, 'nonexistent'), /selected version/);
  });

  it('lists exact episode versions and uses the same key for failure reporting', async () => {
    const { app } = createApp({ torboxAdapter: fixtureAdapter() });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer account-a' };
    try {
      const result = await fetch(`${base}/play/resolve`, { method: 'POST', headers, body: JSON.stringify({ request: episodeRequest }) });
      assert.equal(result.status, 200);
      const { candidate, stream } = await result.json() as any;
      assert.equal(candidate.mediaKey, 'episode:125988:2:4');
      assert.equal(stream.streamUrl, 'https://cdn.example.test/783/42.mkv');
      const versions = await fetch(`${base}/versions/${candidate.mediaKey}`, { headers });
      assert.equal(versions.status, 200);
      assert.equal((await versions.json() as any).versions.length, 1);
      const other = await fetch(`${base}/versions/${candidate.mediaKey}`, { headers: { Authorization: 'Bearer account-b' } });
      assert.equal(other.status, 404);
      const failure = await fetch(`${base}/playback/failure`, { method: 'POST', headers,
        body: JSON.stringify({ candidateId: candidate.candidateId, mediaKey: candidate.mediaKey, request: episodeRequest }) });
      assert.equal(failure.status, 200);
      assert.equal((await failure.json() as any).status, 'marked_failed');
      const wrongKey = await fetch(`${base}/playback/failure`, { method: 'POST', headers,
        body: JSON.stringify({ candidateId: candidate.candidateId, mediaKey: 'episode:125988', request: episodeRequest }) });
      assert.equal(wrongKey.status, 400);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('returns safe upstream diagnostics through the playback HTTP route', async () => {
    const fixtures = fixtureFetch();
    const adapter = new TorBoxAdapter((async (input: any, init: any) => {
      if (String(input).includes('/requestdl')) return new Response('rate limit', {
        status: 429, headers: { 'Retry-After': '90' },
      });
      return fixtures(input, init);
    }) as typeof fetch, undefined, 'fixture-token');
    const { app } = createApp({ torboxAdapter: adapter });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/play/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: movieRequest }),
      });
      assert.equal(response.status, 429);
      const result = await response.json() as any;
      assert.equal(result.diagnostic.stage, 'torboxAPI');
      assert.equal(result.diagnostic.operation, 'torrents/requestdl');
      assert.equal(result.diagnostic.retryAfterSeconds, 90);
      assert.doesNotMatch(JSON.stringify(result), /fixture-token|https:|token=/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('returns a different movie version after a playback failure over HTTP', async () => {
    const { app } = createApp({ torboxAdapter: fixtureAdapter() });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer account-a' };
    try {
      const initial = await fetch(`${base}/play/resolve`, { method: 'POST', headers, body: JSON.stringify({ request: movieRequest }) });
      const { candidate } = await initial.json() as any;
      const response = await fetch(`${base}/playback/failure`, { method: 'POST', headers,
        body: JSON.stringify({ candidateId: candidate.candidateId, mediaKey: candidate.mediaKey, request: movieRequest }) });
      const result = await response.json() as any;
      assert.equal(result.status, 'fallback_ready');
      assert.notEqual(result.fallback.candidate.candidateId, candidate.candidateId);
      assert.equal(result.fallback.stream.streamUrl, 'https://cdn.example.test/782/24.mkv');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('searches adult sources and returns trending on empty query', async () => {
    const { app } = createApp({ torboxAdapter: fixtureAdapter() });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer account-a' };
    try {
      const emptyRes = await fetch(`${base}/sources/adult/search`, { method: 'POST', headers, body: JSON.stringify({ query: '   ' }) });
      assert.equal(emptyRes.status, 200);
      const emptyData = await emptyRes.json() as any;
      assert.equal(emptyData.query, 'Trending');
      assert.ok(emptyData.mediaKey.startsWith('adult:'));

      const validRes = await fetch(`${base}/sources/adult/search`, { method: 'POST', headers, body: JSON.stringify({ query: 'Brazzers Eva' }) });
      assert.equal(validRes.status, 200);
      const data = await validRes.json() as any;
      assert.equal(data.query, 'Brazzers Eva');
      assert.ok(data.mediaKey.startsWith('adult:'));
      assert.ok(Array.isArray(data.candidates));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
