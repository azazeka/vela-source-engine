import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createConfiguredTorznabProviders, TorznabProvider } from '../src/providers/torznab-provider';
import { TorBoxAdapter } from '../src/services/torbox-adapter';
import { movieRequest, episodeRequest } from './torbox-fixtures';

const hash = 'a'.repeat(40);

describe('TorznabProvider', () => {
  it('loads multiple indexers from backend configuration', () => {
    const providers = createConfiguredTorznabProviders(JSON.stringify([
      { id: 'catalog-a', name: 'Catalog A', url: 'https://a.example/api', apiKey: 'key-a' },
      { id: 'catalog-b', name: 'Catalog B', url: 'https://b.example/api', categories: '2000' },
    ]));
    assert.deepEqual(providers.map(provider => [provider.id, provider.name]), [
      ['torznab-catalog-a', 'Catalog A'], ['torznab-catalog-b', 'Catalog B'],
    ]);
    assert.throws(() => createConfiguredTorznabProviders('{bad json}'), /valid JSON array/);
  });

  it('searches by title and parses magnet, size, seeders, and XML entities', async () => {
    let requested: URL | undefined;
    const provider = new TorznabProvider('https://indexer.example/api', 'secret', (async (input: any) => {
      requested = new URL(String(input));
      return new Response(`<rss><channel><item><title>Dune &amp; Part Two 2024 1080p WEB-DL</title><link>magnet:?xt=urn:btih:${hash}&amp;dn=Dune</link><size>1200000000</size><comments>https://indexer.example/release/1</comments><torznab:attr name="seeders" value="45" /></item></channel></rss>`);
    }) as typeof fetch, '2000');

    const results = await provider.search(movieRequest);
    assert.equal(requested?.searchParams.get('t'), 'search');
    assert.equal(requested?.searchParams.get('q'), 'Dune Part Two 2024');
    assert.equal(requested?.searchParams.get('apikey'), 'secret');
    assert.equal(requested?.searchParams.get('cat'), '2000');
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Dune & Part Two 2024 1080p WEB-DL');
    assert.equal(results[0].infoHash, hash);
    assert.equal(results[0].sizeBytes, 1_200_000_000);
    assert.equal(results[0].seeders, 45);
  });

  it('parses non-standard XML formats, namespaces, description-embedded sizes and unquoted attributes', async () => {
    const provider = new TorznabProvider('https://indexer.example/api', '', (async () => {
      return new Response(`
        <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2014/descriptions/extended">
          <channel>
            <item>
              <torznab:title>Oppenheimer.2023.2160p.UHD.Remux</torznab:title>
              <guid>https://indexer.example/details/${hash}</guid>
              <description>Audio: TrueHD Atmos | Размер: 54.2 GB | Seeders: 120</description>
              <torznab:attr name=seeds value=120 />
            </item>
          </channel>
        </rss>
      `);
    }) as typeof fetch);

    const results = await provider.search(movieRequest);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Oppenheimer.2023.2160p.UHD.Remux');
    assert.equal(results[0].infoHash, hash);
    assert.equal(results[0].seeders, 120);
    assert.equal(results[0].sizeBytes, Math.round(54.2 * 1024 * 1024 * 1024));
  });

  it('uses the series title and exact episode in its query', async () => {
    let query = '';
    const provider = new TorznabProvider('https://indexer.example/api', '', (async (input: any) => {
      query = new URL(String(input)).searchParams.get('q') ?? '';
      return new Response('<rss><channel /></rss>');
    }) as typeof fetch);
    await provider.search(episodeRequest);
    assert.equal(query, 'Silo S02E04');
  });

  it('ignores results without a valid torrent hash and reports indexer health', async () => {
    const provider = new TorznabProvider('https://indexer.example/api', '', (async (input: any) => {
      return new Response(new URL(String(input)).searchParams.get('t') === 'caps'
        ? '<caps />'
        : '<rss><channel><item><title>Missing hash</title><size>100000000</size></item></channel></rss>');
    }) as typeof fetch);
    assert.deepEqual(await provider.search(movieRequest), []);
    assert.equal((await provider.health()).healthy, true);
    assert.equal((await new TorznabProvider().health()).healthy, false);
  });

  it('does not expose an indexer API key in network errors', async () => {
    const provider = new TorznabProvider('https://indexer.example/api', 'top-secret', (async () => {
      throw new Error('https://indexer.example/api?apikey=top-secret');
    }) as typeof fetch);
    await assert.rejects(provider.search(movieRequest), error => !String(error).includes('top-secret'));
  });

  it('adds a selected cached result to the TorBox library before requesting playback', async () => {
    let added = false;
    let createRequest: { url: URL; init?: RequestInit } | undefined;
    const adapter = new TorBoxAdapter((async (input: any, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/mylist')) {
        return Response.json({ success: true, data: added ? [{ id: 991, hash, name: 'Dune 2024', size: 1_200_000_000,
          download_finished: true, files: [{ id: 14, name: 'Dune.2024.mkv', size: 1_200_000_000 }] }] : [] });
      }
      if (url.pathname.endsWith('/createtorrent')) {
        createRequest = { url, init };
        added = true;
        return Response.json({ success: true, data: { id: 991 } });
      }
      if (url.pathname.endsWith('/requestdl')) return Response.json({ success: true, data: 'https://cdn.example.test/dune.mkv' });
      return Response.json({ success: true, data: { id: 1 } });
    }) as typeof fetch, undefined, 'fixture-token');

    const stream = await adapter.requestDownloadLink(hash, 14);
    assert.equal(stream.streamUrl, 'https://cdn.example.test/dune.mkv');
    assert.equal(createRequest?.init?.method, 'POST');
    const form = createRequest?.init?.body as FormData;
    assert.equal(form.get('add_only_if_cached'), 'true');
    assert.equal(form.get('magnet'), `magnet:?xt=urn:btih:${hash}`);
  });
});
