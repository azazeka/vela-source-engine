import { TorBoxAdapter } from '../src/services/torbox-adapter';

export const movieRequest = { type: 'movie' as const, tmdbId: 693134,
  title: 'Дюна: Часть вторая', originalTitle: 'Dune Part Two', year: 2024 };
export const episodeRequest = { type: 'episode' as const, tmdbId: 125988,
  title: 'Silo', originalTitle: 'Silo', year: 2023, season: 2, episode: 4 };
export const torrents = [
  { id: 781, hash: 'a'.repeat(40), name: 'Dune.Part.Two.2024.2160p.BluRay.HEVC', size: 35e9, download_finished: true,
    files: [{ id: 17, name: 'Dune.Part.Two.2024.2160p.BluRay.HEVC.mkv', size: 35e9 }] },
  { id: 782, hash: 'b'.repeat(40), name: 'Dune.Part.Two.2024.1080p.BluRay.x264', size: 12e9, download_finished: true,
    files: [{ id: 24, name: 'Dune.Part.Two.2024.1080p.BluRay.x264.mkv', size: 12e9 }] },
  { id: 783, hash: 'c'.repeat(40), name: 'Silo.S02.2160p.WEB-DL', size: 45e9, download_finished: true,
    files: [{ id: 41, name: 'Silo.S02E03.2160p.mkv', size: 4e9 }, { id: 42, name: 'Silo.S02E04.2160p.mkv', size: 4e9 }] },
];

export function fixtureFetch(calls: URL[] = []): typeof fetch {
  return (async (input: any) => {
    const url = new URL(String(input)); calls.push(url);
    let data: any;
    if (url.pathname.endsWith('/mylist')) data = Number(url.searchParams.get('offset')) === 0 ? torrents : [];
    else if (url.pathname.endsWith('/checkcached')) data = torrents.filter(t => url.searchParams.get('hash')?.includes(t.hash));
    else if (url.pathname.endsWith('/requestdl')) {
      const torrent = torrents.find(t => String(t.id) === url.searchParams.get('torrent_id'));
      const file = torrent?.files.find(f => String(f.id) === url.searchParams.get('file_id'));
      if (!file) return new Response('{}', { status: 400 });
      data = `https://cdn.example.test/${torrent!.id}/${file.id}.mkv`;
    } else if (url.pathname.endsWith('/user/me')) data = { id: 1 };
    else return new Response('{}', { status: 404 });
    return Response.json({ success: true, data });
  }) as typeof fetch;
}

export function fixtureAdapter(calls: URL[] = []): TorBoxAdapter {
  return new TorBoxAdapter(fixtureFetch(calls), undefined, 'fixture-token');
}
