import assert from 'node:assert';
import { describe, it } from 'node:test';
import { createApp } from '../src/api/server';
import { CacheManager } from '../src/services/cache-manager';
import { MediaRequest } from '../src/types';

describe('SourceEngine & REST API End-to-End', () => {
  const { sourceEngine } = createApp();

  it('runs searchCandidates for movie and returns sorted candidates', async () => {
    CacheManager.clear();

    const request: MediaRequest = {
      type: 'movie',
      tmdbId: 693134,
      title: 'Dune: Part Two',
      originalTitle: 'Dune: Part Two',
      year: 2024,
    };

    const candidates = await sourceEngine.searchCandidates(request, 'best');
    assert.ok(candidates.length > 0);

    // Verify top candidate
    const top = candidates[0];
    assert.strictEqual(top.quality, '2160p');
    assert.ok(top.cached);
    assert.ok(top.badges.includes('4K'));
    assert.ok(top.badges.includes('⚡ Ready on TorBox'));
  });

  it('resolves direct play stream for movie', async () => {
    const request: MediaRequest = {
      type: 'movie',
      tmdbId: 693134,
      title: 'Dune: Part Two',
      originalTitle: 'Dune: Part Two',
      year: 2024,
    };

    const resolved = await sourceEngine.resolvePlay(request);
    assert.ok(resolved.candidate);
    assert.ok(resolved.stream.streamUrl);
    assert.ok(resolved.stream.streamUrl.startsWith('https://'));
  });

  it('handles candidate failure and switches to next fallback', async () => {
    const request: MediaRequest = {
      type: 'movie',
      tmdbId: 693134,
      title: 'Dune: Part Two',
      originalTitle: 'Dune: Part Two',
      year: 2024,
    };

    const candidatesBefore = await sourceEngine.searchCandidates(request, 'best');
    const firstCandidateId = candidatesBefore[0].candidateId;

    // Simulate failure of the first candidate
    CacheManager.markCandidateFailure(firstCandidateId);

    const candidatesAfter = await sourceEngine.searchCandidates(request, 'best');
    assert.notStrictEqual(candidatesAfter[0].candidateId, firstCandidateId);
  });
});
