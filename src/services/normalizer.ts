import { NormalizedRelease, RawRelease } from '../types';
import { ReleaseParser } from './release-parser';

export class Normalizer {
  public static normalize(rawReleases: RawRelease[]): NormalizedRelease[] {
    const dedupeMap = new Map<string, NormalizedRelease>();

    for (const raw of rawReleases) {
      const cleanHash = this.normalizeHash(raw.infoHash);
      if (!cleanHash) continue;

      const parsed = ReleaseParser.parse(raw.name);

      // Filter garbage
      if (parsed.isTrash) {
        continue;
      }

      // Filter invalid size
      if (!raw.sizeBytes || raw.sizeBytes < 50 * 1024 * 1024) { // Under 50MB is almost certainly a sample or corrupt
        continue;
      }

      const magnet = raw.magnet && raw.magnet.startsWith('magnet:')
        ? raw.magnet
        : `magnet:?xt=urn:btih:${cleanHash}&dn=${encodeURIComponent(raw.name)}`;

      const normalized: NormalizedRelease = {
        provider: raw.provider,
        name: raw.name.trim(),
        infoHash: cleanHash,
        magnet,
        sizeBytes: raw.sizeBytes,
        seeders: Math.max(0, raw.seeders || 0),
        detailsUrl: raw.detailsUrl || null,
        parsed,
      };

      // The same torrent can have a sparse title on one indexer and a full
      // release name on another. Retain the most useful metadata and the best
      // seeder count independently of provider response order.
      const existing = dedupeMap.get(cleanHash);
      if (!existing) {
        dedupeMap.set(cleanHash, normalized);
      } else {
        const completeness = this.metadataCompleteness(normalized) - this.metadataCompleteness(existing);
        const tie = `${normalized.name}:${normalized.provider}`.localeCompare(`${existing.name}:${existing.provider}`);
        const preferred = completeness > 0 || (completeness === 0 && tie < 0) ? normalized : existing;
        dedupeMap.set(cleanHash, { ...preferred, seeders: Math.max(normalized.seeders, existing.seeders) });
      }
    }

    return Array.from(dedupeMap.values());
  }

  private static metadataCompleteness(release: NormalizedRelease): number {
    const p = release.parsed;
    return Number(p.resolution !== 'unknown') + Number(p.source !== 'unknown')
      + Number(p.releaseType !== 'unknown') + Number(p.videoCodec !== 'unknown')
      + Number(p.hdr.some(h => h !== 'sdr')) + Number(p.audio.some(a => a !== 'unknown'))
      + Number(p.channels !== null);
  }

  public static normalizeHash(hash: string | undefined): string | null {
    if (!hash) return null;
    const clean = hash.trim().toLowerCase();
    // 40 hex chars (SHA-1) or 32 base32 chars
    if (/^[a-f0-9]{40}$/i.test(clean)) {
      return clean;
    }
    // Extract from magnet if passed as infoHash
    const match = clean.match(/xt=urn:btih:([a-f0-9]{40})/i);
    if (match) {
      return match[1].toLowerCase();
    }
    return null;
  }
}
