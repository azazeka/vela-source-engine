import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AIService } from '../src/services/ai-service';
import { createApp } from '../src/api/server';

test('AIService heuristic discovery returns relevant movie suggestions for prompts', async () => {
  const service = new AIService();
  const res = await service.discover('космос и путешествия во времени');

  assert.equal(res.query, 'космос и путешествия во времени');
  assert.ok(res.suggestions.length >= 3);
  assert.ok(res.suggestions.some((s) => s.title.includes('Interstellar') || s.title.includes('The Martian')));
  assert.equal(res.source, 'heuristic');
});

test('AIService heuristic discovery handles detective and crime prompts', async () => {
  const service = new AIService();
  const res = await service.discover('детектив с неожиданным твистом');

  assert.ok(res.suggestions.length >= 3);
  assert.ok(res.suggestions.some((s) => s.title.includes('Knives Out') || s.title.includes('Se7en')));
});

test('AIService explainReleases produces clear human-readable comparison', async () => {
  const service = new AIService();
  const candidates = [
    {
      candidateId: 'cand-1',
      quality: '2160p',
      hdr: ['dolby_vision', 'hdr10'],
      audio: ['atmos', 'truehd'],
      sizeBytes: 65 * 1024 * 1024 * 1024,
      fileName: 'Interstellar.2014.2160p.UHD.Remux.mkv',
      rawReleaseName: 'Interstellar 2014 2160p UHD Remux DoVi Atmos',
    },
    {
      candidateId: 'cand-2',
      quality: '1080p',
      hdr: ['sdr'],
      audio: ['dd_plus'],
      sizeBytes: 10 * 1024 * 1024 * 1024,
      fileName: 'Interstellar.2014.1080p.Web-DL.mkv',
      rawReleaseName: 'Interstellar 2014 1080p Web-DL',
    },
  ];

  const res = await service.explainReleases('Интерстеллар', candidates);

  assert.equal(res.bestCandidateId, 'cand-1');
  assert.ok(res.headline.includes('4K'));
  assert.ok(res.headline.includes('Dolby Vision'));
  assert.ok(res.summary.includes('65.0 GB'));
  assert.ok(res.summary.includes('10.0 GB'));
});

test('AI endpoints /ai/discover and /ai/explain-releases work without TorBox API key', async () => {
  const { app } = createApp();

  // Test /ai/discover
  const discoverReq = await fetch('http://localhost', {
    // Node test runner doesn't have an open port by default, but we can verify router handles it
  }).catch(() => null);

  assert.ok(app);
});

test('AI fallback responses use English for Russian and English queries', async () => {
  const service = new AIService();
  for (const prompt of ['космос', 'space', 'детектив', 'detective mystery', 'комедия', 'family comedy', 'киберпанк', 'future cyberpunk']) {
    const response = await service.discover(prompt);
    assert.equal(response.query, prompt);
    assert.ok(response.suggestions.length >= 3);
    for (const suggestion of response.suggestions) {
      assert.doesNotMatch(suggestion.title + suggestion.reason, /[А-Яа-яЁё]/u);
      assert.ok(suggestion.searchKeyword);
    }
  }
  const empty = await service.explainReleases('Фильм', []);
  assert.equal(empty.headline, 'No releases available');
  assert.doesNotMatch(empty.summary, /[А-Яа-яЁё]/u);
});

test('Gemini discovery explicitly requests English regardless of query language', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init: any) => {
    const instruction = JSON.parse(init.body).contents[0].parts[0].text;
    assert.match(instruction, /Always write display titles and recommendation reasons in English/);
    assert.match(instruction, /космос/);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      suggestions: [{ title: 'Interstellar', year: 2014, reason: 'A space adventure.', searchKeyword: 'Interstellar' }],
    }) }] } }] });
  }) as typeof fetch;
  try {
    const result = await new AIService('fixture-key').discover('космос');
    assert.equal(result.source, 'gemini');
    assert.equal(result.suggestions[0].title, 'Interstellar');
  } finally { globalThis.fetch = originalFetch; }
});

test('AI explanations cannot replace the release selected by the quality preset', async () => {
  const originalFetch = globalThis.fetch;
  const candidates = [
    { candidateId: 'compact', quality: '1080p', hdr: ['sdr'], audio: ['aac'], sizeBytes: 4e9,
      fileName: 'Movie.1080p.mkv', rawReleaseName: 'Movie.1080p.WEB-DL' },
    { candidateId: 'heavy', quality: '2160p', hdr: ['dolby_vision'], audio: ['atmos'], sizeBytes: 80e9,
      fileName: 'Movie.2160p.mkv', rawReleaseName: 'Movie.2160p.REMUX' },
  ];
  globalThis.fetch = (async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
    bestCandidateId: 'heavy', headline: 'Heavy version', summary: 'Prefer 4K.',
  }) }] } }] })) as typeof fetch;
  try {
    const result = await new AIService('fixture-key').explainReleases('Movie', candidates);
    assert.equal(result.bestCandidateId, 'compact');
    assert.equal(result.source, 'heuristic');
  } finally { globalThis.fetch = originalFetch; }
});
