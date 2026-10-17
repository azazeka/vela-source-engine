import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TrailerResolver } from '../src/services/trailer-resolver';

describe('TrailerResolver', () => {
  it('resolves real trailer stream with high quality', async () => {
    const resolver = new TrailerResolver();
    // Oppenheimer trailer ID
    const result = await resolver.resolve('uYPbbksJxIg');
    assert.ok(result.streamUrl);
    assert.ok(result.streamUrl.startsWith('https://'));
    assert.ok(['hls', 'mp4'].includes(result.format));
    assert.ok(result.quality.includes('1080') || result.quality.includes('720') || result.format === 'hls');

    // Test caching
    const cached = await resolver.resolve('uYPbbksJxIg');
    assert.equal(cached.streamUrl, result.streamUrl);
  });

  it('rejects empty or missing key', async () => {
    const resolver = new TrailerResolver();
    await assert.rejects(async () => {
      await resolver.resolve('');
    }, /Video ID is required/);
  });
});
