import { PlayCandidate, TorBoxCachedTorrent } from '../types';
import { ReleaseIdentity } from './release-identity';
import { ReleaseParser } from './release-parser';

interface CachedEntry<T> {
  data: T;
  expiresAt: number;
}

interface DebridHashEntry {
  torrent: TorBoxCachedTorrent | null;
  expiresAt: number;
}

export class CacheManager {
  private static candidatesCache = new Map<string, CachedEntry<PlayCandidate[]>>();
  private static failedCandidates = new Set<string>();
  private static debridHashCache = new Map<string, DebridHashEntry>();

  public static getCandidates(mediaKey: string, scope = ''): PlayCandidate[] | null {
    const entry = this.candidatesCache.get(`${scope}:${mediaKey}`);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.candidatesCache.delete(`${scope}:${mediaKey}`);
      return null;
    }
    // Filter out candidates that failed recently
    return entry.data.filter((c) => !this.failedCandidates.has(`${scope}:${c.candidateId}`));
  }

  public static setCandidates(mediaKey: string, candidates: PlayCandidate[], ttlMs: number = 30 * 60 * 1000, scope = ''): void {
    this.candidatesCache.set(`${scope}:${mediaKey}`, {
      data: candidates,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public static getDebridCached(debridId: string, hash: string, scope = ''): { hit: boolean; torrent: TorBoxCachedTorrent | null } {
    const key = `${debridId}:${scope}:${hash.toLowerCase()}`;
    const entry = this.debridHashCache.get(key);
    if (!entry) return { hit: false, torrent: null };
    if (Date.now() > entry.expiresAt) {
      this.debridHashCache.delete(key);
      return { hit: false, torrent: null };
    }
    return { hit: true, torrent: entry.torrent };
  }

  public static setDebridCached(
    debridId: string,
    hash: string,
    torrent: TorBoxCachedTorrent | null,
    ttlMs: number = 15 * 60 * 1000,
    scope = ''
  ): void {
    const key = `${debridId}:${scope}:${hash.toLowerCase()}`;
    this.debridHashCache.set(key, {
      torrent,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public static markCandidateFailure(candidateId: string, ttlMs: number = 10 * 60 * 1000, scope = ''): void {
    this.failedCandidates.add(`${scope}:${candidateId}`);
    const timer = setTimeout(() => {
      this.failedCandidates.delete(`${scope}:${candidateId}`);
    }, ttlMs);
    timer.unref?.();
  }

  public static isFailed(candidateId: string, scope = ''): boolean {
    return this.failedCandidates.has(`${scope}:${candidateId}`);
  }

  public static clear(): void {
    this.candidatesCache.clear();
    this.failedCandidates.clear();
    this.debridHashCache.clear();
    ReleaseParser.clearCache();
    ReleaseIdentity.clearCache();
  }
}
