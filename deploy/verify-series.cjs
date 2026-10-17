// Read-only verification inside the deployed image. Never uses a real TorBox account or starts a download.
const assert = require('node:assert/strict');
const { SourceEngine } = require('../dist/src/services/source-engine');
const { TorBoxAdapter } = require('../dist/src/services/torbox-adapter');
const { TorBoxLibraryProvider } = require('../dist/src/providers/torbox-library-provider');
const { ReleaseIdentity } = require('../dist/src/services/release-identity');

async function fixtures() {
  const f = (id, name) => ({ id, name, size: 500e6 });
  const torrents = [
    { id: 7, hash: 'a'.repeat(40), name: 'Show.S01-S02.Complete.1080p', download_finished: true,
      files: [f(1, 'Season 1/01.mkv'), f(2, 'Season 1/02.mkv'), f(3, 'Season 2/01.mkv')] },
    ...[1, 2, 3].map(episode => ({ id: episode + 10, hash: String(episode).repeat(40),
      name: `Separate.S01E0${episode}.1080p`, download_finished: true, files: [f(0, `Separate.S01E0${episode}.mkv`)] })),
    { id: 99, hash: 'f'.repeat(40), name: 'Other.Show.S01E02.2160p', download_finished: true, files: [f(0, 'Other.Show.S01E02.mkv')] }
  ];
  let links = 0;
  const adapter = new TorBoxAdapter(async input => {
    const url = new URL(String(input));
    let data;
    if (url.pathname.endsWith('/mylist')) data = torrents;
    else if (url.pathname.endsWith('/requestdl')) { links++; data = `https://fixture.example/${url.searchParams.get('torrent_id')}/${url.searchParams.get('file_id')}`; }
    else throw new Error('Unexpected operation in read-only verification');
    return Response.json({ success: true, data });
  }, undefined, 'verification-fixture');
  const engine = new SourceEngine(adapter);
  engine.registerProvider(new TorBoxLibraryProvider(adapter));
  const request = { type: 'episode', tmdbId: 700010, title: 'Show', originalTitle: 'Show', year: 0 };
  for (const [season, episode, id] of [[1, 1, 1], [1, 2, 2], [2, 1, 3]]) {
    const result = await engine.resolvePlay({ ...request, season, episode });
    assert.equal(result.stream.streamUrl, `https://fixture.example/7/${id}`);
  }
  await assert.rejects(engine.resolvePlay({ ...request, season: 1, episode: 3 }), { statusCode: 404 });
  for (const episode of [1, 2, 3]) {
    const result = await engine.resolvePlay({ ...request, title: 'Separate', originalTitle: 'Separate', tmdbId: 700011, season: 1, episode });
    assert.equal(result.stream.streamUrl, `https://fixture.example/${episode + 10}/0`);
  }
  assert.equal(links, 6);
  console.log(JSON.stringify({ mode: 'fixtures', status: 'passed', completeSeries: true, seasonBoundary: true,
    separateEpisodeTorrents: true, missingEpisodeRejected: true, foreignShowRejected: true }));
}

async function live() {
  const request = { type: 'episode', tmdbId: 1396, title: 'Во все тяжкие', originalTitle: 'Breaking Bad', year: 2008, season: 1, episode: 2 };
  const providers = [['rutor', 'RutorProvider'], ['tpb', 'TpbProvider'], ['eztv', 'EztvProvider'], ['tgx', 'TgxProvider'], ['bitsearch', 'BitsearchProvider']];
  const results = await Promise.all(providers.map(async ([name, exported]) => {
    const provider = new (require(`../dist/src/providers/${name}-provider`)[exported])();
    const started = Date.now();
    try {
      const releases = await Promise.race([provider.search(request), new Promise(resolve => setTimeout(() => resolve([]), 10000))]);
      const verified = releases.filter(release => ReleaseIdentity.matches(release.name, request));
      return { provider: name, verified: verified.length, milliseconds: Date.now() - started,
        examples: verified.slice(0, 2).map(release => release.name) };
    } catch { return { provider: name, verified: 0, milliseconds: Date.now() - started, unavailable: true }; }
  }));
  console.log(JSON.stringify({ mode: 'live-search', status: results.some(r => r.verified > 0) ? 'passed' : 'no-results', results }));
}

(async () => { if (process.argv.includes('--live')) await live(); else await fixtures(); })()
  .catch(() => { console.error('Series verification failed'); process.exitCode = 1; });
