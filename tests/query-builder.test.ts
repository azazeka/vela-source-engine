import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueryBuilder } from '../src/services/query-builder';
import { MediaRequest } from '../src/types';

describe('QueryBuilder', () => {
  it('cleans special characters and collapses whitespace', () => {
    assert.equal(QueryBuilder.cleanTitle('Show: Subtitle / Part 1 * ? < >'), 'Show Subtitle Part 1');
    assert.equal(QueryBuilder.cleanTitle(''), '');
    assert.equal(QueryBuilder.cleanTitle(undefined), '');
  });

  it('builds queries for movies with localized and original titles', () => {
    const movieReq: MediaRequest = {
      type: 'movie',
      tmdbId: 693134,
      title: 'Дюна: Часть вторая',
      originalTitle: 'Dune: Part Two',
      year: 2024,
    };

    const queries = QueryBuilder.buildQueries(movieReq);
    assert.ok(queries.includes('Дюна Часть вторая 2024'));
    assert.ok(queries.includes('Dune Part Two 2024'));
    assert.ok(queries.includes('Дюна Часть вторая Dune Part Two'));
    assert.ok(queries.includes('Дюна Часть вторая Dune Part Two 2024'));
  });

  it('builds comprehensive queries for TV series with Cyrillic and Latin titles', () => {
    const seriesReq: MediaRequest = {
      type: 'episode',
      tmdbId: 125988,
      title: 'Укрытие',
      originalTitle: 'Silo',
      year: 2023,
      season: 2,
      episode: 4,
    };

    const queries = QueryBuilder.buildQueries(seriesReq);
    // English/Latin queries for Western trackers
    assert.ok(queries.includes('Silo S02E04'), 'Must include Silo S02E04');
    assert.ok(queries.includes('Silo 2x04'), 'Must include Silo 2x04');
    assert.ok(queries.includes('Silo S02'), 'Must include season pack Silo S02');
    assert.ok(queries.includes('Silo Season 2'), 'Must include Silo Season 2');

    // Russian queries for Russian trackers
    assert.ok(queries.includes('Укрытие S02E04'), 'Must include Укрытие S02E04');
    assert.ok(queries.includes('Укрытие 2 сезон'), 'Must include Укрытие 2 сезон');
    assert.ok(queries.includes('Укрытие S02'), 'Must include Укрытие S02');

    // Bilingual queries
    assert.ok(queries.includes('Укрытие Silo'), 'Must include bilingual Укрытие Silo');
    assert.ok(queries.includes('Укрытие Silo 2 сезон'), 'Must include bilingual Укрытие Silo 2 сезон');
  });

  it('correctly resolves getEnglishOrOriginalTitle for Western indexers', () => {
    const localizedReq: MediaRequest = {
      type: 'episode',
      tmdbId: 125988,
      title: 'Укрытие',
      originalTitle: 'Silo',
      year: 2023,
      season: 2,
      episode: 4,
    };
    assert.equal(QueryBuilder.getEnglishOrOriginalTitle(localizedReq), 'Silo');

    const englishReq: MediaRequest = {
      type: 'episode',
      tmdbId: 125988,
      title: 'Silo',
      originalTitle: 'Silo',
      year: 2023,
      season: 2,
      episode: 4,
    };
    assert.equal(QueryBuilder.getEnglishOrOriginalTitle(englishReq), 'Silo');

    const seriesTitleOverride: MediaRequest = {
      type: 'episode',
      tmdbId: 125988,
      title: 'Укрытие',
      seriesTitle: 'Укрытие (Сериал)',
      originalTitle: 'Silo',
      year: 2023,
      season: 2,
      episode: 4,
    };
    assert.equal(QueryBuilder.getEnglishOrOriginalTitle(seriesTitleOverride), 'Silo');
  });

  it('generates prioritized Russian episode queries for Rutor', () => {
    const localizedReq: MediaRequest = {
      type: 'episode',
      tmdbId: 125988,
      title: 'Укрытие',
      originalTitle: 'Silo',
      year: 2023,
      season: 2,
      episode: 4,
    };

    const rutorQueries = QueryBuilder.getRussianEpisodeQueries(localizedReq);
    assert.ok(rutorQueries.includes('Укрытие 2 сезон'));
    assert.ok(rutorQueries.includes('Укрытие Silo'));
    assert.ok(rutorQueries.includes('Укрытие S02'));
    assert.ok(rutorQueries.includes('Silo S02E04'));
  });
});
