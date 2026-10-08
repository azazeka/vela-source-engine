import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TasteProfileStore, validateTasteProfile, TasteProfile } from '../src/services/taste-profile-store';
import { createApp } from '../src/api/server';
import { fixtureAdapter, movieRequest } from './torbox-fixtures';
import { CacheManager } from '../src/services/cache-manager';

const profile: TasteProfile = { feedback: {}, watchlist: [{ id: 42, mediaType: 'movie', title: 'Film' }], history: [], moviesOnly: true, hideWatched: true, updatedAt: 100000 };

test('profiles persist across restarts, isolate accounts and reject older writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-profile-'));
  try {
    const store = new TasteProfileStore(directory);
    await Promise.all([store.save('a'.repeat(64), { ...profile, updatedAt: 200000 }), store.save('a'.repeat(64), profile)]);
    assert.equal((await new TasteProfileStore(directory).load('a'.repeat(64)))?.updatedAt, 200000);
    assert.equal(await store.load('b'.repeat(64)), null);
    assert.throws(() => validateTasteProfile({ ...profile, feedback: { bad: { item: { id: 42, mediaType: 'movie', title: 'Film' }, opinion: 'liked', watched: true } } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('profile routes require explicit credentials and preserve removals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-profile-api-'));
  const previous = process.env.VELA_PROFILE_DIRECTORY;
  process.env.VELA_PROFILE_DIRECTORY = directory;
  const { app } = createApp({ torboxAdapter: fixtureAdapter(), providers: [] });
  if (previous === undefined) delete process.env.VELA_PROFILE_DIRECTORY; else process.env.VELA_PROFILE_DIRECTORY = previous;
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/profile/taste`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const headers = { Authorization: 'Bearer account-one', 'Content-Type': 'application/json' };
    assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify(profile) })).status, 200);
    assert.equal((await (await fetch(url, { headers: { Authorization: 'Bearer account-two' } })).json() as any).profile, null);
    await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ ...profile, updatedAt: 300000, watchlist: [] }) });
    assert.deepEqual((await (await fetch(url, { headers })).json() as any).profile.watchlist, []);
    assert.equal((await fetch(url, { method: 'PUT', headers, body: '{}' })).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('fresh availability discovery bypasses stale versions without starting playback', async () => {
  CacheManager.clear();
  const { sourceEngine } = createApp({ torboxAdapter: fixtureAdapter(), providers: [] });
  const scope = fixtureAdapter().cacheScope();
  CacheManager.setCandidates(sourceEngine.getMediaKey(movieRequest), [{ candidateId: 'stale' } as any], undefined, scope);
  const candidates = await sourceEngine.searchCandidates(movieRequest, 'best', undefined, true);
  assert.deepEqual(candidates, []);
  assert.deepEqual(CacheManager.getCandidates(sourceEngine.getMediaKey(movieRequest), scope), []);
});
