import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { FileMatcher } from '../src/services/file-matcher';
import { ReleaseIdentity } from '../src/services/release-identity';
import { SourceEngine } from '../src/services/source-engine';
import { CacheManager } from '../src/services/cache-manager';
import { TorBoxAdapter } from '../src/services/torbox-adapter';
import { MediaRequest, RawRelease, TorBoxFile } from '../src/types';

const request: MediaRequest = { type: 'episode', tmdbId: 10, title: 'Show', originalTitle: 'Сериал', year: 2023, season: 1, episode: 2 };
const file = (id: number, name: string, metadata = {}): TorBoxFile => ({ id, name, size: 500e6, ...metadata });

describe('verified series playback', () => {
  beforeEach(() => CacheManager.clear());

  it('rejects unrelated shows, spinoffs, substrings and remakes before ranking', () => {
    for (const name of ['Other.Show.S01E02.2160p', 'Show.Afterlife.S01E02', 'The.Show.S01E02', 'Show.2020.S01E02', 'Showtime.S01E02']) {
      assert.equal(ReleaseIdentity.matches(name, request), false, name);
    }
    for (const name of ['Show.S01E02.1080p', 'Сериал / Show (2023) S01', '[Group] Show_S01_E02_2160p', 'Show.S01']) {
      assert.equal(ReleaseIdentity.matches(name, request), true, name);
    }
    assert.equal(ReleaseIdentity.matches('1923.S01E02.mkv', { ...request, title: '1923', originalTitle: '1923' }), true);
    assert.equal(ReleaseIdentity.matches('Show.Other', request), false);
  });

  it('never accepts a singleton, interview or random number as proof of an episode', () => {
    for (const files of [[file(1, 'Show.E01.mkv')], [file(1, 'Season 1/01.mkv')],
      [file(1, 'Show.S01E01.mkv'), file(2, 'Show.interview.mkv')], [file(1, 'video.mkv')],
      [file(1, 'Show.1080p.02.audio.mkv')]]) {
      assert.equal(FileMatcher.matchFile(request, files, 'Show.S01'), null);
    }
  });

  it('checks title, season folders, metadata conflicts and exact episode numbers', () => {
    for (const files of [[file(1, 'Other.S01E02.mkv')], [file(1, 'Season 2/02.mkv'), file(2, 'Season 2/03.mkv')],
      [file(1, 'Show.S01E02.mkv', { s_num: 2, e_num: 2 })], [file(1, 'Show.S01E20.mkv')]]) {
      assert.equal(FileMatcher.matchFile(request, files, 'Show.S01'), null);
    }
    for (const name of ['Show_S01_E02.mkv', 'Show.S01.E02.mkv', 'Season 1/02.mkv', 'Сезон 1/Серия 02.mkv', 'Season 1/02 серия.mkv']) {
      assert.equal(FileMatcher.matchFile(request, [file(1, name)], 'Show.S01')?.id, 1, name);
    }
    assert.equal(FileMatcher.matchFile(request, [file(1, 'video.mkv', { s_num: 1, e_num: 2 })], 'Show.S01')?.id, 1);
    assert.equal(FileMatcher.matchFile(request, [file(1, 'video.mkv')], 'Show.S01E02')?.id, 1);
  });

  it('refuses combined videos without segment boundaries while accepting separate files in range packs', () => {
    for (const metadata of [{}, { s_num: 1, e_num: 1 }]) {
      assert.equal(FileMatcher.matchFile(request, [file(1, 'Show.S01E01-E02.mkv', metadata)], 'Show.S01'), null);
      assert.equal(FileMatcher.matchFile(request, [file(1, 'Show.S01E01E02.mkv', metadata)], 'Show.S01'), null);
      assert.equal(FileMatcher.matchFile(request, [file(1, 'Season 1/E01-E02.mkv', metadata)], 'Show.S01'), null);
    }
    assert.equal(FileMatcher.matchFile(request, [file(1, 'Show.S01E01.mkv'), file(2, 'Show.S01E02.mkv')], 'Show.S01E01-E10')?.id, 2);
  });

  function engineFixture(accountWrongTitle = false) {
    const calls: URL[] = [];
    const torrents = ['a', 'b'].map((hash, index) => ({ id: index + 1, hash: hash.repeat(40),
      name: accountWrongTitle && index === 0 ? 'Other.S01' : `Show.S01.${index === 0 ? '2160p' : '1080p'}.WEB-DL.HEVC.AAC`,
      download_finished: true, files: [file(20 + index, 'Show.S01E02.mkv')] }));
    const adapter = new TorBoxAdapter((async (input: any) => {
      const url = new URL(String(input)); calls.push(url);
      const data = url.pathname.endsWith('/mylist') ? torrents
        : url.pathname.endsWith('/checkcached') ? torrents
        : 'https://cdn.example.test/episode.mkv';
      return Response.json({ success: true, data });
    }) as typeof fetch, undefined, 'fixture');
    const engine = new SourceEngine(adapter);
    const releases: RawRelease[] = torrents.map((t, index) => ({ provider: 'external', name: `Show.S01.${index === 0 ? '2160p' : '1080p'}.WEB-DL.HEVC.AAC-${index === 0 ? 'ALPHA' : 'BETA'}`, infoHash: t.hash, sizeBytes: 4e9, seeders: 100 }));
    releases.push({ provider: 'external', name: 'Wrong.Show.S01E02.2160p.WEB-DL.HEVC.AAC', infoHash: 'c'.repeat(40), sizeBytes: 4e9, seeders: 10000 });
    engine.registerProvider({ id: 'external', name: 'External', search: async () => releases,
      health: async () => ({ id: 'external', healthy: true, latencyMs: 0 }) });
    return { engine, calls };
  }

  it('filters polluted indexer results and preserves the preferred season pack across cached requests', async () => {
    const { engine } = engineFixture();
    const candidates = await engine.searchCandidates(request);
    assert.equal(candidates.length, 2);
    assert.equal((await engine.resolvePlay({ ...request, preferredTorrentHash: 'b'.repeat(40) })).candidate.torrentHash, 'b'.repeat(40));
    assert.equal((await engine.resolvePlay(request)).candidate.torrentHash, 'a'.repeat(40));
    assert.equal((await engine.resolvePlay({ ...request, preferredReleaseGroup: 'beta' })).candidate.torrentHash, 'b'.repeat(40));
    assert.deepEqual(await engine.searchCandidates({ ...request, title: 'Different', originalTitle: 'Different' }), []);
  });

  it('revalidates the account torrent before issuing a URL and tries only another verified copy', async () => {
    const { engine, calls } = engineFixture(true);
    const result = await engine.resolvePlay(request);
    assert.equal(result.candidate.torrentHash, 'b'.repeat(40));
    const downloads = calls.filter(url => url.pathname.endsWith('/requestdl'));
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].searchParams.get('torrent_id'), '2');
    assert.equal(result.stream.seasonNumber, 1);
    assert.equal(result.stream.episodeNumber, 2);
  });

  it('honors the selected filename when account file IDs differ from cache IDs', async () => {
    const downloads: URL[] = [];
    const adapter = new TorBoxAdapter((async (input: any) => {
      const url = new URL(String(input));
      const data = url.pathname.endsWith('/mylist') ? [{ id: 1, hash: 'a'.repeat(40), name: 'Show.S01', download_finished: true,
        files: [file(90, 'Show.S01E02.1080p.mkv'), { ...file(91, 'Show.S01E02.2160p.mkv'), size: 900e6 }] }]
        : (downloads.push(url), 'https://cdn.example.test/video.mkv');
      return Response.json({ success: true, data });
    }) as typeof fetch, undefined, 'fixture');
    await adapter.requestDownloadLink('a'.repeat(40), 1, undefined, request, undefined, false,
      { name: 'Show.S01E02.1080p.mkv', size: 500e6 });
    assert.equal(downloads[0].searchParams.get('file_id'), '90');
    await assert.rejects(adapter.requestDownloadLink('a'.repeat(40), 1, undefined, request, undefined, false,
      { name: 'Show.S01E01.1080p.mkv', size: 500e6 }), { statusCode: 404 });
    assert.equal(downloads.length, 1, 'missing selected file must not silently switch to another encode');
  });

  it('recognizes release groups without treating WEB-DL as a group', () => {
    assert.equal(ReleaseIdentity.releaseGroup('Show.S01E02.1080p.WEB-DL-NTb.mkv'), 'ntb');
    assert.equal(ReleaseIdentity.releaseGroup('Show.S01E02.WEB-DL'), undefined);
  });

  it('does not blacklist other episodes when cached file metadata is absent', async () => {
    const adapter = new TorBoxAdapter((async () => Response.json({ success: true,
      data: [{ hash: 'a'.repeat(40), name: 'Show.S01', files: [] }] })) as typeof fetch, undefined, 'fixture');
    const engine = new SourceEngine(adapter);
    engine.registerProvider({ id: 'external', name: 'External', search: async () => [{ provider: 'external',
      name: 'Show.S01', infoHash: 'a'.repeat(40), sizeBytes: 4e9, seeders: 100 }],
      health: async () => ({ id: 'external', healthy: true, latencyMs: 0 }) });
    const second = await engine.searchCandidates(request);
    CacheManager.markCandidateFailure(second[0].candidateId, undefined, adapter.cacheScope());
    const third = await engine.searchCandidates({ ...request, episode: 3 });
    assert.equal(third.length, 1);
    assert.notEqual(second[0].candidateId, third[0].candidateId);
  });

  it('falls back to second candidate when first candidate is rejected with Real-Debrid error 35', async () => {
    const { RealDebridAdapter } = await import('../src/services/realdebrid-adapter');
    const mockHash1 = 'a'.repeat(40);
    const mockHash2 = 'b'.repeat(40);

    const adapter = new RealDebridAdapter((async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/torrents/instantAvailability')) {
        return Response.json({
          [mockHash1]: { rd: [{ '1': { filename: 'Show.S01E02.2160p.mkv', filesize: 2000000000 } }] },
          [mockHash2]: { rd: [{ '1': { filename: 'Show.S01E02.1080p.mkv', filesize: 1000000000 } }] },
        });
      }
      if (urlStr.includes('/torrents?limit=100')) {
        return Response.json([]);
      }
      if (urlStr.includes('/torrents/addMagnet')) {
        const body = String(init?.body || '');
        if (body.includes(mockHash1)) {
          // Hash 1 is DMCA-blocked with error 35
          return new Response(JSON.stringify({ error: 'infringing_file', error_code: 35 }), { status: 403 });
        }
        // Hash 2 succeeds
        return Response.json({ id: 'RD_ID_2' });
      }
      if (urlStr.includes('/torrents/info/RD_ID_2')) {
        return Response.json({
          id: 'RD_ID_2',
          hash: mockHash2,
          filename: 'Show.S01E02.1080p.mkv',
          bytes: 1000000000,
          status: 'downloaded',
          progress: 100,
          files: [{ id: 1, path: '/Show.S01E02.1080p.mkv', bytes: 1000000000, selected: 1 }],
          links: ['https://real-debrid.com/d/TESTLINK2'],
        });
      }
      if (urlStr.includes('/unrestrict/link')) {
        return Response.json({
          download: 'https://download.real-debrid.com/Show.S01E02.1080p.mkv',
          filename: 'Show.S01E02.1080p.mkv',
          filesize: 1000000000,
        });
      }
      return Response.json({});
    }) as typeof fetch, undefined, 'test_token');

    const engine = new SourceEngine(undefined as any, adapter);
    engine.registerProvider({
      id: 'mock',
      name: 'Mock',
      search: async () => [
        { provider: 'mock', name: 'Show.S01E02.2160p', infoHash: mockHash1, sizeBytes: 2000000000, seeders: 100 },
        { provider: 'mock', name: 'Show.S01E02.1080p', infoHash: mockHash2, sizeBytes: 1000000000, seeders: 80 },
      ],
      health: async () => ({ id: 'mock', healthy: true, latencyMs: 0 }),
    });

    const result = await engine.resolvePlay(request, undefined, 'best', 'test_token', 'realdebrid');
    assert.equal(result.candidate.torrentHash, mockHash2);
    assert.equal(result.stream.streamUrl, 'https://download.real-debrid.com/Show.S01E02.1080p.mkv');
  });
});
