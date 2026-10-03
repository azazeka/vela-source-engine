import { PlayCandidate } from '../types';

interface CachedEntry<T> {
  data: T;
  expiresAt: number;
}

export class CacheManager {
  private static candidatesCache = new Map<string, CachedEntry<PlayCandidate[]>>();
  private static failedCandidates = new Set<string>();

  public static getCandidates(mediaKey: string): PlayCandidate[] | null {
    const entry = this.candidatesCache.get(mediaKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.candidatesCache.delete(mediaKey);
      return null;
    }
    // Filter out candidates that failed recently
    return entry.data.filter((c) => !this.failedCandidates.has(c.candidateId));
  }

  public static setCandidates(mediaKey: string, candidates: PlayCandidate[], ttlMs: number = 30 * 60 * 1000): void {
    this.candidatesCache.set(mediaKey, {
      data: candidates,
      expiresAt: Date.now() + ttlMs,
    });
  }

  public static markCandidateFailure(candidateId: string, ttlMs: number = 10 * 60 * 1000): void {
    this.failedCandidates.add(candidateId);
    const timer = setTimeout(() => {
      this.failedCandidates.delete(candidateId);
    }, ttlMs);
    timer.unref?.();
  }

  public static isFailed(candidateId: string): boolean {
    return this.failedCandidates.has(candidateId);
  }

  public static clear(): void {
    this.candidatesCache.clear();
    this.failedCandidates.clear();
  }
}
