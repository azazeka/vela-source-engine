import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/api/server';
import { CacheManager } from '../src/services/cache-manager';
import { fixtureAdapter, movieRequest, episodeRequest } from './torbox-fixtures';

// Exercise the real default provider and the HTTP routes with fixture TorBox responses.
describe('SourceEngine and REST API', () => {
  beforeEach(() => CacheManager.clear());

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
});
