import { AIDiscoveryItem, AIDiscoveryResponse, AIReleaseExplanation, CandidateSummary } from '../types';

export class AIService {
  private discoveryCache = new Map<string, AIDiscoveryResponse>();
  private explanationCache = new Map<string, AIReleaseExplanation>();
  private defaultGeminiKey: string | undefined;

  constructor(defaultGeminiKey?: string) {
    this.defaultGeminiKey = defaultGeminiKey || process.env.GEMINI_API_KEY;
  }

  /**
   * AI-powered mood and natural language movie/series discovery.
   */
  async discover(prompt: string, customApiKey?: string): Promise<AIDiscoveryResponse> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return { query: '', suggestions: [], source: 'heuristic' };
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = this.discoveryCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const effectiveKey = customApiKey?.trim() || this.defaultGeminiKey;

    if (effectiveKey) {
      try {
        const geminiResult = await this.callGeminiDiscovery(trimmed, effectiveKey);
        if (geminiResult && geminiResult.suggestions.length > 0) {
          this.discoveryCache.set(cacheKey, geminiResult);
          return geminiResult;
        }
      } catch (err: any) {
        console.warn(`[AIService] Gemini discovery call failed: ${err.message}. Falling back to semantic heuristics.`);
      }
    }

    // Semantic heuristic fallback
    const fallback = this.heuristicDiscovery(trimmed);
    this.discoveryCache.set(cacheKey, fallback);
    return fallback;
  }

  /**
   * AI explanation and recommendation for candidate releases.
   */
  async explainReleases(
    mediaTitle: string,
    candidates: CandidateSummary[],
    customApiKey?: string
  ): Promise<AIReleaseExplanation> {
    if (!candidates || candidates.length === 0) {
      return {
        headline: 'Нет доступных релизов',
        summary: 'Не найдено подходящих вариантов для анализа.',
        bestCandidateId: '',
        source: 'heuristic',
      };
    }

    const cacheKey = `${mediaTitle.toLowerCase()}_${candidates.map((c) => c.candidateId).join('_')}`;
    const cached = this.explanationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const effectiveKey = customApiKey?.trim() || this.defaultGeminiKey;

    if (effectiveKey && candidates.length > 1) {
      try {
        const geminiResult = await this.callGeminiExplainer(mediaTitle, candidates, effectiveKey);
        if (geminiResult) {
          this.explanationCache.set(cacheKey, geminiResult);
          return geminiResult;
        }
      } catch (err: any) {
        console.warn(`[AIService] Gemini explainer call failed: ${err.message}. Falling back to rule-based analysis.`);
      }
    }

    const fallback = this.heuristicExplainer(mediaTitle, candidates);
    this.explanationCache.set(cacheKey, fallback);
    return fallback;
  }

  // --- Gemini API Callers ---

  private async callGeminiDiscovery(prompt: string, apiKey: string): Promise<AIDiscoveryResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const systemInstruction = `Ты — персональный киноассистент в премиальном Apple TV плеере Vela.
Пользователь ищет фильмы или сериалы по настроению, описанию или стилистике.
Верни ТОЛЬКО валидный JSON без обертки markdown:
{
  "suggestions": [
    {
      "title": "Точное название фильма/сериала (на русском или оригинале)",
      "year": 2020,
      "reason": "Одно емкое предложение на русском, почему это идеально подходит под запрос пользователя.",
      "searchKeyword": "Название для TMDB поиска"
    }
  ]
}
Верни от 3 до 6 лучших вариантов. Никаких вступлений, только JSON.`;

    try {
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemInstruction}\n\nЗапрос пользователя: "${prompt}"` }],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 800,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return null;

      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0) {
        return {
          query: prompt,
          suggestions: parsed.suggestions.map((s: any) => ({
            title: String(s.title || ''),
            year: typeof s.year === 'number' ? s.year : undefined,
            reason: String(s.reason || ''),
            searchKeyword: String(s.searchKeyword || s.title || ''),
          })),
          source: 'gemini',
        };
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callGeminiExplainer(
    mediaTitle: string,
    candidates: CandidateSummary[],
    apiKey: string
  ): Promise<AIReleaseExplanation | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const summaries = candidates.slice(0, 8).map((c, i) => ({
      index: i + 1,
      id: c.candidateId,
      name: c.rawReleaseName || c.fileName,
      quality: c.quality,
      hdr: c.hdr,
      audio: c.audio,
      sizeGB: (c.sizeBytes / (1024 * 1024 * 1024)).toFixed(1),
    }));

    const systemInstruction = `Ты — эксперт по качеству видео и звука в медиаплеере Vela для Apple TV.
Сравни список доступных релизов торрентов для фильма/сериала "${mediaTitle}".
Верни ТОЛЬКО валидный JSON:
{
  "bestCandidateId": "candidateId лучшего релиза",
  "headline": "Краткий вывод (до 8 слов, напр. 'Лучший выбор: 4K Remux с Dolby Vision')",
  "summary": "1-2 понятных предложения для пользователя Apple TV: почему выбран этот релиз (битрейт, дорожка, HDR) и какая есть компактная альтернатива."
}`;

    try {
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: `${systemInstruction}\n\nРелизы:\n${JSON.stringify(summaries, null, 2)}` }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 400,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return null;

      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.headline && parsed.summary) {
        return {
          headline: String(parsed.headline),
          summary: String(parsed.summary),
          bestCandidateId: String(parsed.bestCandidateId || candidates[0].candidateId),
          source: 'gemini',
        };
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  // --- Rule-based Fallbacks ---

  private heuristicDiscovery(prompt: string): AIDiscoveryResponse {
    const lower = prompt.toLowerCase();
    let suggestions: AIDiscoveryItem[] = [];

    if (lower.includes('космос') || lower.includes('space') || lower.includes('интерстеллар') || lower.includes('планет')) {
      suggestions = [
        { title: 'Интерстеллар', year: 2014, reason: 'Монументальная научная фантастика Кристофера Нолана о путешествиях сквозь кротовые норы.', searchKeyword: 'Interstellar' },
        { title: 'Марсианин', year: 2015, reason: 'Захватывающее выживание на Марсе с оптимизмом и научным подходом.', searchKeyword: 'The Martian' },
        { title: 'Прибытие', year: 2016, reason: 'Глубокий контакт с внеземным разумом и концепция нелинейного времени Дени Вильнёва.', searchKeyword: 'Arrival' },
        { title: 'Гравитация', year: 2013, reason: 'Атмосферный гиперреалистичный триллер о выживании на околоземной орбите.', searchKeyword: 'Gravity' },
      ];
    } else if (lower.includes('детектив') || lower.includes('расследован') || lower.includes('убийств') || lower.includes('твист')) {
      suggestions = [
        { title: 'Достать ножи', year: 2019, reason: 'Искрометный классический детектив с ансамблем звезд и неожиданной развязкой.', searchKeyword: 'Knives Out' },
        { title: 'Семь', year: 1995, reason: 'Эталонный мрачный нуар-триллер Дэвида Финчера с шокирующим финалом.', searchKeyword: 'Se7en' },
        { title: 'Остров проклятых', year: 2010, reason: 'Психологический лабиринт Мартина Скорсезе с непревзойденной атмосферой паранойи.', searchKeyword: 'Shutter Island' },
        { title: 'Пленницы', year: 2013, reason: 'Напряженнейшее расследование исчезновения детей с Хью Джекманом и Джейком Джилленхолом.', searchKeyword: 'Prisoners' },
      ];
    } else if (lower.includes('киберпанк') || lower.includes('будущ') || lower.includes('лезви') || lower.includes('blade')) {
      suggestions = [
        { title: 'Бегущий по лезвию 2049', year: 2017, reason: 'Визуальный шедевр Дени Вильнёва о границах человечности в неоновом будущем.', searchKeyword: 'Blade Runner 2049' },
        { title: 'Матрица', year: 1999, reason: 'Культовая классика, изменившая жанр фантастики и экшена навсегда.', searchKeyword: 'The Matrix' },
        { title: 'Апгрейд', year: 2018, reason: 'Драйвовый и изобретательный киберпанк-боевик об искусственном интеллекте в теле человека.', searchKeyword: 'Upgrade' },
        { title: 'Призрак в доспехах', year: 1995, reason: 'Философская анимационная вершина жанра киберпанк.', searchKeyword: 'Ghost in the Shell' },
      ];
    } else if (lower.includes('комед') || lower.includes('смешн') || lower.includes('вечер') || lower.includes('семь')) {
      suggestions = [
        { title: '1+1 (Неприкасаемые)', year: 2011, reason: 'Добрая, остроумная и жизнеутверждающая комедия на основе реальных событий.', searchKeyword: 'The Intouchables' },
        { title: 'День сурка', year: 1993, reason: 'Вечная теплая классика с Биллом Мюрреем о переосмыслении жизни.', searchKeyword: 'Groundhog Day' },
        { title: 'Джентльмены', year: 2019, reason: 'Блестящий британский криминальный юмор и фирменный стиль Гая Ричи.', searchKeyword: 'The Gentlemen' },
        { title: 'Зеленая книга', year: 2018, reason: 'Уютное и трогательное дорожное приключение двух противоположных личностей.', searchKeyword: 'Green Book' },
      ];
    } else {
      suggestions = [
        { title: prompt, reason: `Популярные произведения, соответствующие тематике "${prompt}".`, searchKeyword: prompt },
        { title: 'Начало', year: 2010, reason: 'Интеллектуальный экшен-триллер о погружении в чужие сны.', searchKeyword: 'Inception' },
        { title: 'Дюна', year: 2021, reason: 'Эпическое фантастическое полотно по роману Фрэнка Герберта.', searchKeyword: 'Dune' },
      ];
    }

    return { query: prompt, suggestions, source: 'heuristic' };
  }

  private heuristicExplainer(mediaTitle: string, candidates: CandidateSummary[]): AIReleaseExplanation {
    const best = candidates[0];
    const is4K = best.quality === '2160p';
    const hasDV = best.hdr.includes('dolby_vision');
    const hasAtmos = best.audio.includes('atmos') || best.audio.includes('truehd');
    const sizeGB = (best.sizeBytes / (1024 * 1024 * 1024)).toFixed(1);

    let headline = is4K ? 'Рекомендуем: 4K Ultra HD' : 'Рекомендуем: Качественный 1080p';
    if (hasDV) headline += ' с Dolby Vision';

    let summary = `Первый релиз (${best.quality.toUpperCase()}, ${sizeGB} ГБ) предлагает наивысший битрейт`;
    if (hasAtmos) summary += ' и премиальный пространственный звук Dolby Atmos/TrueHD.';
    else summary += ' и стабильный многоканальный звук.';

    if (candidates.length > 1) {
      const lighter = candidates.find((c) => c.sizeBytes < best.sizeBytes * 0.6);
      if (lighter) {
        const lightGB = (lighter.sizeBytes / (1024 * 1024 * 1024)).toFixed(1);
        summary += ` Для экономии трафика или быстрого буфера подойдет версия ${lighter.quality.toUpperCase()} (${lightGB} ГБ).`;
      }
    }

    return {
      headline,
      summary,
      bestCandidateId: best.candidateId,
      source: 'heuristic',
    };
  }
}
