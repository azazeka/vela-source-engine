import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { SourceEngine } from '../src/services/source-engine';
import { TorBoxAdapter } from '../src/services/torbox-adapter';
import { TorBoxLibraryProvider } from '../src/providers/torbox-library-provider';
import { FileMatcher } from '../src/services/file-matcher';
import { ReleaseIdentity } from '../src/services/release-identity';
import { ProviderSearch } from '../src/services/provider-search';
import { QueryBuilder } from '../src/services/query-builder';
import { CacheManager } from '../src/services/cache-manager';
import { MediaRequest, RawRelease } from '../src/types';

const request: MediaRequest = { type: 'episode', tmdbId: 10, title: 'Show', originalTitle: 'Сериал', year: 2023, season: 2, episode: 2 };
const file = (id: number, name: string, size = 500e6) => ({ id, name, size });

describe('season packs, complete series and separate episode torrents', () => {
  beforeEach(() => CacheManager.clear());

  it('searches exact episodes, seasons and whole-series releases without stopping on unrelated results', async () => {
    const queries = QueryBuilder.getEpisodeSearchQueries(request);
    assert.ok(queries.includes('Show S02E02'));
    assert.ok(queries.includes('Show S02'));
    assert.ok(queries.includes('Show complete'));
    assert.ok(queries.includes('Show'));
    const releases = await ProviderSearch.collect(request, queries, async query => [{ provider: 'fixture',
      name: query === 'Show complete' ? 'Show.Complete.1080p' : 'Unrelated.S02E02.2160p',
      infoHash: (query === 'Show complete' ? 'a' : 'b').repeat(40), sizeBytes: 40e9, seeders: 20 }]);
    assert.equal(releases.length, 1);
    assert.equal(releases[0].name, 'Show.Complete.1080p');
  });

  it('waits for season-pack results even when a single-episode query returns a valid result first', async () => {
    const results = await ProviderSearch.collect(request, ['Show S02E02', 'Show S02'], async query => {
      if (query === 'Show S02') await new Promise(resolve => setTimeout(resolve, 20));
      return [{ provider: 'fixture', name: query === 'Show S02' ? 'Show.S02.2160p' : 'Show.S02E02.1080p',
        infoHash: (query === 'Show S02' ? 'a' : 'b').repeat(40), sizeBytes: 4e9, seeders: 20 }];
    });
    assert.equal(results.length, 2);
  });

  it('identifies complete-series names and season ranges without accepting a spinoff', () => {
    for (const name of ['Show.Complete.1080p', 'Show.S01-S03.Complete.1080p', 'Show.Seasons.1-3.1080p', 'Сериал [1-3 сезоны] 1080p']) {
      assert.ok(ReleaseIdentity.matches(name, request), name);
    }
    assert.equal(ReleaseIdentity.matches('Show.Afterlife.Complete.1080p', request), false);
    assert.equal(ReleaseIdentity.seasonRangeContains('Show.S01-S03', 2), true);
    assert.equal(ReleaseIdentity.seasonRangeContains('Show.S01-S03', 4), false);
  });

  it('finds the exact season and episode inside a complete-series torrent', () => {
    const files = [file(1, 'Season 1/01.mkv'), file(2, 'Season 1/02.mkv'), file(3, 'Season 2/01.mkv'), file(4, 'Season 2/02.mkv')];
    assert.equal(FileMatcher.matchFile(request, files, 'Show.S01-S03.Complete')?.id, 4);
    assert.equal(FileMatcher.matchFile({ ...request, episode: 3 }, files, 'Show.Complete'), null);
    assert.equal(FileMatcher.matchFile(request, [file(1, 'Season 1/02.mkv')], 'Show.Complete'), null);
    assert.equal(FileMatcher.matchFile(request, [file(4, 'Season 2/02.mkv', 12e6)], 'Show.Complete')?.id, 4);
  });

  function fixture(torrents: any[], cachedFiles = true) {
    const calls: URL[] = [];
    const adapter = new TorBoxAdapter((async (input: any) => {
      const url = new URL(String(input)); calls.push(url);
      let data: any;
      if (url.pathname.endsWith('/mylist')) data = torrents;
      else if (url.pathname.endsWith('/checkcached')) data = torrents.map(t => ({ ...t, files: cachedFiles ? t.files : [] }));
      else if (url.pathname.endsWith('/requestdl')) data = `https://cdn.example.test/${url.searchParams.get('torrent_id')}/${url.searchParams.get('file_id')}.mkv`;
      else return new Response('{}', { status: 400 });
      return Response.json({ success: true, data });
    }) as typeof fetch, undefined, 'fixture');
    return { adapter, calls };
  }

  it('resolves later seasons of a full-series torrent even when global cache metadata omits its file list', async () => {
    const pack = { id: 7, hash: 'a'.repeat(40), name: 'Show.S01-S03.Complete.1080p', download_finished: true,
      files: [file(1, 'Season 1/02.mkv'), file(2, 'Season 2/01.mkv'), file(3, 'Season 2/02.mkv')] };
    const { adapter } = fixture([pack], false);
    const engine = new SourceEngine(adapter);
    engine.registerProvider({ id: 'external', name: 'External', search: async () => [{ provider: 'external',
      name: pack.name, infoHash: pack.hash, sizeBytes: 40e9, seeders: 100 }],
      health: async () => ({ id: 'external', healthy: true, latencyMs: 0 }) });
    const resolved = await engine.resolvePlay(request);
    assert.equal(resolved.stream.streamUrl, 'https://cdn.example.test/7/3.mkv');
    assert.equal(resolved.stream.seasonNumber, 2);
    assert.equal(resolved.stream.episodeNumber, 2);
  });

  it('resolves separate episode torrents without reusing the previous episode or file ID', async () => {
    const torrents = [1, 2, 3].map(episode => ({ id: episode + 10, hash: String(episode).repeat(40),
      name: `Show.S02E0${episode}.1080p.WEB-DL-TEAM`, download_finished: true,
      files: [file(0, `Show.S02E0${episode}.mkv`)] }));
    const { adapter, calls } = fixture(torrents);
    const engine = new SourceEngine(adapter);
    engine.registerProvider(new TorBoxLibraryProvider(adapter));
    for (const episode of [1, 2, 3]) {
      const result = await engine.resolvePlay({ ...request, episode, preferredTorrentHash: '1'.repeat(40), preferredReleaseGroup: 'team' });
      assert.equal(result.candidate.torrentHash, String(episode).repeat(40));
      assert.equal(result.stream.streamUrl, `https://cdn.example.test/${episode + 10}/0.mkv`);
    }
    assert.equal(calls.filter(c => c.pathname.endsWith('/requestdl')).length, 3);
  });
});
