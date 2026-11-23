import { findExactLexiconMatch, lookupFallbackWord } from '../data/fallbackLexicon';
import { generateFallbackLessonQuiz } from '../data/lessonQuizzes';
import type {
  GeneratedConversation,
  GeneratedExam,
  LessonContentType,
  LessonQuizQuestion,
  LessonQuizResponse,
  ProficiencyLevel,
  TranscriptSegment,
  WordAnalysis,
} from '../types/arabic';
import {
  applySmartPartialTashkeel,
  extractYouTubeVideoId,
  formatMinimalArabicRoot,
  inferArabicWordType,
  normalizeArabicWord,
  normalizeStandaloneArabicKey,
  normalizeStandaloneVocabWord,
  parsePastedTranscriptSegments,
  stripFinalIrabForSpeech,
  stripTashkeel,
} from './arabic';
import {
  fetchGeminiGenerateContent,
  getClientGeminiApiKey,
  notifyGeminiQuotaNotice,
  parseGeminiQuotaInfo,
} from './geminiAuth';

export { getClientGeminiApiKey };

const GEMINI_API_COOLDOWN_KEY = 'qalam_gemini_text_cooldown_until';
const GEMINI_QUOTA_REASON_KEY = 'qalam_gemini_text_quota_reason';
const GEMINI_RESPONSE_CACHE_KEY = 'qalam_gemini_response_cache_v1';
const GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_MEMORY_RESPONSE_CACHE = 200;
const MAX_PERSISTENT_RESPONSE_CACHE = 90;

let memoryCooldownUntil = 0;
let memoryQuotaNotice: string | null = null;

interface StoredGeminiEntry {
  value: unknown;
  savedAt: number;
}

const memoryResponseCache = new Map<string, unknown>();
const inFlightClientTasks = new Map<string, Promise<unknown>>();

function normalizePhraseCacheKey(text: string): string {
  return stripTashkeel(text)
    .replace(/\u0640/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readPersistentResponseMap(): Record<string, StoredGeminiEntry> {
  if (typeof window === 'undefined') return {};
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = storage?.getItem(GEMINI_RESPONSE_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, StoredGeminiEntry>;
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch {
      // Ignore storage read errors
    }
  }
  return {};
}

function getCachedGeminiResult<T>(cacheKey: string): T | null {
  if (memoryResponseCache.has(cacheKey)) {
    return memoryResponseCache.get(cacheKey) as T;
  }
  try {
    const map = readPersistentResponseMap();
    const entry = map[cacheKey];
    if (entry && entry.value !== undefined) {
      memoryResponseCache.set(cacheKey, entry.value);
      return entry.value as T;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function setCachedGeminiResult<T>(cacheKey: string, value: T): void {
  if (memoryResponseCache.size >= MAX_MEMORY_RESPONSE_CACHE) {
    const oldestKey = memoryResponseCache.keys().next().value;
    if (oldestKey) memoryResponseCache.delete(oldestKey);
  }
  memoryResponseCache.set(cacheKey, value);

  if (typeof window === 'undefined') return;
  try {
    const map = readPersistentResponseMap();
    map[cacheKey] = { value, savedAt: Date.now() };
    const sorted = Object.entries(map)
      .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0))
      .slice(0, MAX_PERSISTENT_RESPONSE_CACHE);

    const writeToStorage = (storage: Storage | undefined, entries: Array<[string, StoredGeminiEntry]>) => {
      if (!storage) return;
      let candidate = [...entries];
      while (candidate.length > 0) {
        try {
          storage.setItem(GEMINI_RESPONSE_CACHE_KEY, JSON.stringify(Object.fromEntries(candidate)));
          return;
        } catch {
          if (candidate.length <= 1) break;
          candidate = candidate.slice(0, Math.ceil(candidate.length / 2));
        }
      }
    };

    writeToStorage(window.localStorage, sorted);
    writeToStorage(window.sessionStorage, sorted.slice(0, 30));
  } catch {
    // Ignore storage write errors
  }
}

function getCooldownUntil(): number {
  if (memoryCooldownUntil > Date.now()) return memoryCooldownUntil;
  try {
    if (typeof window !== 'undefined') {
      const raw = window.sessionStorage?.getItem(GEMINI_API_COOLDOWN_KEY);
      const parsed = raw ? Number(raw) : 0;
      if (Number.isFinite(parsed) && parsed > Date.now()) {
        memoryCooldownUntil = parsed;
        return parsed;
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return 0;
}

function getActiveQuotaNotice(): string | null {
  if (Date.now() >= getCooldownUntil()) return null;
  if (memoryQuotaNotice) return memoryQuotaNotice;
  try {
    if (typeof window !== 'undefined') {
      const stored = window.sessionStorage?.getItem(GEMINI_QUOTA_REASON_KEY);
      if (stored) {
        memoryQuotaNotice = stored;
        return stored;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function setCooldown(durationMs: number, quotaReason?: string): void {
  const until = Date.now() + durationMs;
  memoryCooldownUntil = until;
  if (quotaReason) {
    memoryQuotaNotice = quotaReason;
  }
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(GEMINI_API_COOLDOWN_KEY, String(until));
      if (quotaReason) {
        window.sessionStorage?.setItem(GEMINI_QUOTA_REASON_KEY, quotaReason);
      }
    }
  } catch {
    // Ignore storage access errors
  }
}

export interface GeminiTextDiagnosticsSnapshot {
  cooldownActive: boolean;
  cooldownRemainingSec: number;
  quotaReason: string | null;
  memoryCacheEntries: number;
  persistentCacheEntries: number;
  placeholderEntriesInResponseCache: number;
}

export function getGeminiTextDiagnosticsSnapshot(): GeminiTextDiagnosticsSnapshot {
  const until = getCooldownUntil();
  const remainingMs = Math.max(0, until - Date.now());
  const persistentMap = readPersistentResponseMap();
  const persistentKeys = Object.keys(persistentMap);
  let placeholderEntriesInResponseCache = 0;

  for (const key of persistentKeys) {
    const val = persistentMap[key]?.value as Partial<WordAnalysis> | undefined;
    if (
      val &&
      typeof val.englishMeaning === 'string' &&
      val.englishMeaning.startsWith('Contextual Arabic word')
    ) {
      placeholderEntriesInResponseCache += 1;
    }
  }

  return {
    cooldownActive: remainingMs > 0,
    cooldownRemainingSec: Math.ceil(remainingMs / 1000),
    quotaReason: getActiveQuotaNotice(),
    memoryCacheEntries: memoryResponseCache.size,
    persistentCacheEntries: persistentKeys.length,
    placeholderEntriesInResponseCache,
  };
}

export function clearGeminiResponseCaches(): {
  clearedMemory: number;
  clearedPersistent: number;
} {
  const clearedMemory = memoryResponseCache.size;
  memoryResponseCache.clear();
  inFlightClientTasks.clear();
  memoryCooldownUntil = 0;
  memoryQuotaNotice = null;

  let clearedPersistent = 0;
  if (typeof window !== 'undefined') {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        const raw = storage?.getItem(GEMINI_RESPONSE_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') {
            clearedPersistent = Math.max(clearedPersistent, Object.keys(parsed).length);
          }
          storage.removeItem(GEMINI_RESPONSE_CACHE_KEY);
        }
      } catch {
        // Ignore storage errors
      }
    }
    try {
      window.sessionStorage?.removeItem(GEMINI_API_COOLDOWN_KEY);
      window.sessionStorage?.removeItem(GEMINI_QUOTA_REASON_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  return { clearedMemory, clearedPersistent };
}

function getLevelExampleInstruction(level: ProficiencyLevel): string {
  if (level === 'beginner') {
    return `LEARNER LEVEL: Beginner (المبتدئ)
- EVERY example sentence MUST be short and simple (4–8 Arabic words max).
- Use ONLY high-frequency everyday words (home, family, food, school, morning routine) and straightforward grammar (simple nominal or SVO/VSO clauses).
- Avoid complex subordinate clauses, passive voice, or rare idioms.`;
  }
  if (level === 'advanced') {
    return `LEARNER LEVEL: Advanced (المتقدم)
- EVERY example sentence MUST be rich, idiomatic, or nuanced (11–18 Arabic words).
- Use sophisticated vocabulary, natural literary/media phrasing, cohesive connectors, or authentic Arabic idioms suitable for educated native discourse.`;
  }
  return `LEARNER LEVEL: Intermediate (المتوسط)
- EVERY example sentence MUST be natural and moderately detailed (8–14 Arabic words).
- Use practical real-world vocabulary (work, study, travel, culture, conversations) and clear connected clause structure.`;
}

function cleanJsonString(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const unfenced = (fencedMatch ? fencedMatch[1] : trimmed)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!unfenced.startsWith('{') && !unfenced.startsWith('[')) {
    const firstBrace = unfenced.indexOf('{');
    const lastBrace = unfenced.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return unfenced.slice(firstBrace, lastBrace + 1).trim();
    }
    const firstBracket = unfenced.indexOf('[');
    const lastBracket = unfenced.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      return unfenced.slice(firstBracket, lastBracket + 1).trim();
    }
  }
  return unfenced;
}

export function isFakePlaceholderTranslation(
  analysis: Pick<WordAnalysis, 'englishMeaning'> | null | undefined
): boolean {
  const meaning = analysis?.englishMeaning?.trim() || '';
  return (
    !meaning ||
    meaning.startsWith('Contextual Arabic word') ||
    meaning.startsWith('Translation pending')
  );
}

export class GeminiTranslationError extends Error {
  status?: number;
  code?: 'MISSING_KEY' | 'QUOTA_EXCEEDED' | 'AUTH_ERROR' | 'NETWORK_ERROR' | 'EMPTY_RESPONSE' | 'API_ERROR';

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: GeminiTranslationError['code'];
    }
  ) {
    super(message);
    this.name = 'GeminiTranslationError';
    this.status = options?.status;
    this.code = options?.code;
  }
}

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/```(?:json|text|markdown)?/gi, '')
    .replace(/```/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .trim();
}

function parseGeminiTranslationOutput(
  rawText: string,
  trimmedWord: string,
  targetLevel: ProficiencyLevel
): WordAnalysis | null {
  const cleanedRaw = rawText.trim();
  if (!cleanedRaw) return null;

  // 1. Try JSON parsing (including markdown-fenced or prose-wrapped JSON)
  try {
    const jsonCandidate = cleanJsonString(cleanedRaw);
    if (jsonCandidate.startsWith('{')) {
      const parsed = JSON.parse(jsonCandidate) as Partial<Omit<WordAnalysis, 'word' | 'source'>> & {
        meaning?: string;
        translation?: string;
        english?: string;
        pos?: string;
      };

      const rawMeaning = (
        parsed.englishMeaning ||
        parsed.translation ||
        parsed.meaning ||
        parsed.english ||
        ''
      ).trim();

      if (rawMeaning && !rawMeaning.startsWith('Contextual Arabic word')) {
        const resolvedPartOfSpeech =
          (parsed.partOfSpeech || parsed.pos || '').trim() || 'Word';
        const resolvedWordType = inferArabicWordType(parsed.wordType || resolvedPartOfSpeech);
        const standaloneWordAr = normalizeStandaloneVocabWord(
          parsed.wordWithTashkeel || trimmedWord,
          {
            wordType: resolvedWordType,
            partOfSpeech: resolvedPartOfSpeech,
          }
        );
        const finalDisplayWord = applySmartPartialTashkeel(
          standaloneWordAr || parsed.wordWithTashkeel || trimmedWord
        );

        const rawExamples = Array.isArray(parsed.examples) ? parsed.examples : [];
        const cleanExamples = rawExamples
          .filter(
            (ex): ex is { arabic: string; english: string; contextLabel?: string } =>
              Boolean(ex && typeof ex.arabic === 'string' && ex.arabic.trim() && typeof ex.english === 'string' && ex.english.trim())
          )
          .slice(0, 3)
          .map((ex) => ({
            arabic: applySmartPartialTashkeel(ex.arabic.trim()),
            english: ex.english.trim(),
            contextLabel: ex.contextLabel?.trim(),
          }));

        return {
          word: stripTashkeel(finalDisplayWord),
          wordWithTashkeel: finalDisplayWord,
          vocalizedWord: stripFinalIrabForSpeech(
            parsed.vocalizedWord || finalDisplayWord,
            {
              wordType: resolvedWordType,
              partOfSpeech: resolvedPartOfSpeech,
            }
          ),
          partOfSpeech: resolvedPartOfSpeech,
          wordType: resolvedWordType,
          root: formatMinimalArabicRoot(parsed.root),
          transliteration: (parsed.transliteration || '').trim(),
          englishMeaning: rawMeaning,
          examples: cleanExamples,
          level: targetLevel,
          source: 'gemini',
        };
      }
    }
  } catch {
    // Fall through cleanly to plain-text parsing below
  }

  // 2. Clean plain-text / markdown fallback parsing
  const plain = stripMarkdownFormatting(cleanedRaw);
  if (!plain || plain.startsWith('{') || plain.startsWith('[')) {
    return null;
  }

  const lines = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let englishMeaning = '';
  let transliteration = '';
  let partOfSpeech = 'Translation';
  const extraContextLines: string[] = [];

  for (const line of lines) {
    const meaningMatch = line.match(/^(?:english\s*)?(?:translation|meaning|definition)\s*:\s*(.+)$/i);
    if (meaningMatch?.[1]) {
      englishMeaning = meaningMatch[1].trim();
      continue;
    }
    const translitMatch = line.match(/^transliteration\s*:\s*(.+)$/i);
    if (translitMatch?.[1]) {
      transliteration = translitMatch[1].trim();
      continue;
    }
    const posMatch = line.match(/^part\s*of\s*speech\s*:\s*(.+)$/i);
    if (posMatch?.[1]) {
      partOfSpeech = posMatch[1].trim();
      continue;
    }
    const contextMatch = line.match(/^(?:context|note|usage)\s*:\s*(.+)$/i);
    if (contextMatch?.[1]) {
      extraContextLines.push(contextMatch[1].trim());
      continue;
    }
    extraContextLines.push(line);
  }

  if (!englishMeaning) {
    englishMeaning = extraContextLines.join(' — ').trim() || plain;
  } else if (extraContextLines.length > 0 && extraContextLines.join(' ').length < 180) {
    englishMeaning = `${englishMeaning} (${extraContextLines.join('; ')})`;
  }

  if (!englishMeaning) return null;

  const resolvedWordType = inferArabicWordType(partOfSpeech);
  const standaloneWordAr = normalizeStandaloneVocabWord(trimmedWord, {
    wordType: resolvedWordType,
    partOfSpeech,
  });
  const finalDisplayWord = applySmartPartialTashkeel(standaloneWordAr || trimmedWord);

  return {
    word: stripTashkeel(finalDisplayWord),
    wordWithTashkeel: finalDisplayWord,
    vocalizedWord: stripFinalIrabForSpeech(finalDisplayWord, {
      wordType: resolvedWordType,
      partOfSpeech,
    }),
    partOfSpeech,
    wordType: resolvedWordType,
    root: '',
    transliteration,
    englishMeaning,
    examples: [],
    level: targetLevel,
    source: 'gemini',
  };
}

async function generateGeminiJson<T>(params: {
  prompt: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<T | null> {
  const apiKey = getClientGeminiApiKey();
  if (!apiKey) return null;
  if (Date.now() < getCooldownUntil()) return null;

  const controller = new AbortController();
  const timer =
    typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), params.timeoutMs ?? 6500)
      : setTimeout(() => controller.abort(), params.timeoutMs ?? 6500);

  try {
    const { response, errorBody, url } = await fetchGeminiGenerateContent({
      model: GEMINI_MODEL,
      apiKey,
      signal: controller.signal,
      logPrefix: 'Gemini Client',
      payload: {
        systemInstruction: {
          parts: [{ text: params.systemInstruction }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: params.prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      },
    });

    if (!response.ok) {
      let extractedMessage = '';
      try {
        const parsed = JSON.parse(errorBody) as { error?: { message?: string } };
        if (parsed?.error?.message) {
          extractedMessage = parsed.error.message;
        }
      } catch {
        // not json
      }
      const targetUrl = url || `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
      const detail = extractedMessage || errorBody || response.statusText;
      console.error(
        `[Gemini Client] Request to ${targetUrl} failed (HTTP ${response.status} ${response.statusText}): ${detail}`
      );
      if (response.status === 429 || /RESOURCE_EXHAUSTED|quota|rate[- ]?limit/i.test(errorBody)) {
        const quota = parseGeminiQuotaInfo(errorBody, 'text');
        setCooldown(quota.cooldownMs, quota.userMessage);
        notifyGeminiQuotaNotice(quota.userMessage);
      } else if (
        response.status === 401 ||
        response.status === 403 ||
        /API_KEY_INVALID|PERMISSION_DENIED/i.test(errorBody)
      ) {
        setCooldown(60 * 60 * 1000);
      }
      return null;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      console.error('[Gemini Client] Response succeeded but contained no candidate text:', payload);
      return null;
    }

    return JSON.parse(cleanJsonString(rawText)) as T;
  } catch (err) {
    console.error(
      `[Gemini Client] Request to ${GEMINI_MODEL} threw error:`,
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeArabicWordClient(params: {
  word: string;
  contextSentence?: string;
  level?: ProficiencyLevel;
}): Promise<WordAnalysis> {
  const trimmedWord = params.word.trim();
  const trimmedContext = params.contextSentence?.trim() || trimmedWord;
  const targetLevel: ProficiencyLevel = params.level ?? 'intermediate';
  const cacheKey = `word::${targetLevel}::${normalizeStandaloneArabicKey(trimmedWord)}::${normalizePhraseCacheKey(trimmedContext).slice(0, 120)}`;

  const cached = getCachedGeminiResult<WordAnalysis>(cacheKey);
  if (cached && !isFakePlaceholderTranslation(cached)) {
    return { ...cached, source: 'cache' };
  }

  const pending = inFlightClientTasks.get(cacheKey);
  if (pending) {
    return pending as Promise<WordAnalysis>;
  }

  const task = (async (): Promise<WordAnalysis> => {
    const curatedMatch = lookupFallbackWord(trimmedWord, trimmedContext, undefined, targetLevel);
    const apiKey = getClientGeminiApiKey();

    if (!apiKey) {
      const missingKeyMsg =
        'Translation unavailable: Gemini API key (VITE_GEMINI_API_KEY) is not configured.';
      console.error('[Qalam Translation]', missingKeyMsg);
      if (curatedMatch) {
        return {
          ...curatedMatch,
          notice: 'Showing curated Arabic dictionary entry (VITE_GEMINI_API_KEY not configured).',
        };
      }
      throw new GeminiTranslationError(missingKeyMsg, { code: 'MISSING_KEY' });
    }

    if (Date.now() < getCooldownUntil()) {
      const cooldownMsg =
        getActiveQuotaNotice() ||
        'Gemini free quota was reached (HTTP 429). Please wait a moment and try again.';
      console.error('[Qalam Translation] Skipping request during quota cooldown:', cooldownMsg);
      if (curatedMatch) {
        return {
          ...curatedMatch,
          notice: cooldownMsg,
        };
      }
      throw new GeminiTranslationError(cooldownMsg, { status: 429, code: 'QUOTA_EXCEEDED' });
    }

    const prompt = `Translate and analyze this Arabic word or phrase accurately for a ${targetLevel} learner.
Arabic word/phrase: "${trimmedWord}"
${trimmedContext !== trimmedWord ? `Context sentence: "${trimmedContext}"` : ''}

Give an accurate, natural English translation (including brief contextual meaning if helpful in this sentence).

${getLevelExampleInstruction(targetLevel)}

Return JSON with:
- wordWithTashkeel: normalize/extract the standalone vocabulary/dictionary form (NOT locked to sentence-specific grammatical case endings / الإعراب such as genitive -i or accusative -a/-an; e.g. turn "المَكْتَبَةِ" into "المَكْتَبَة", "كِتَابًا" into "كِتَاب", while keeping inherent past verbs or adverbs natural). Include essential Shaddah and Smart Partial Tashkeel.
- vocalizedWord: the exact same standalone Arabic word with full internal harakat in pausal form WITHOUT trailing case vowels or tanween on the final letter.
- partOfSpeech: concise English POS (e.g. "Noun", "Verb (Present)", "Adjective", "Phrase").
- wordType: ONE Arabic category from: "اسم", "فعل", "حرف", "ظرف", "صفة", or "ضمير".
- root: ONLY the 3 or 4 root Arabic letters separated by " - " (e.g. "ك - ت - ب"), or "" if none.
- transliteration: clean Latin phonetic transliteration of the standalone word/phrase.
- englishMeaning: accurate English translation and brief contextual meaning if needed.
- examples: 2 natural Arabic sentences strictly calibrated to the ${targetLevel} level with Smart Partial Tashkeel, English translation, and contextLabel.`;

    const controller = new AbortController();
    const timer =
      typeof window !== 'undefined'
        ? window.setTimeout(() => controller.abort(), 8500)
        : setTimeout(() => controller.abort(), 8500);

    try {
      const { response, errorBody } = await fetchGeminiGenerateContent({
        model: GEMINI_MODEL,
        apiKey,
        signal: controller.signal,
        logPrefix: 'Qalam Translation',
        payload: {
          systemInstruction: {
            parts: [
              {
                text: 'You are an expert Arabic-English translator and linguist. Provide an accurate, natural English translation and brief contextual meaning. Prefer clean JSON matching the requested schema, with standalone vocabulary normalization and pausal vocalizedWord.',
              },
            ],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                wordWithTashkeel: { type: 'STRING' },
                vocalizedWord: { type: 'STRING' },
                partOfSpeech: { type: 'STRING' },
                wordType: { type: 'STRING' },
                root: { type: 'STRING' },
                transliteration: { type: 'STRING' },
                englishMeaning: { type: 'STRING' },
                examples: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      arabic: { type: 'STRING' },
                      english: { type: 'STRING' },
                      contextLabel: { type: 'STRING' },
                    },
                    required: ['arabic', 'english'],
                  },
                },
              },
              required: [
                'wordWithTashkeel',
                'vocalizedWord',
                'partOfSpeech',
                'wordType',
                'root',
                'transliteration',
                'englishMeaning',
                'examples',
              ],
            },
          },
        },
      });

      if (!response.ok) {
        console.error(
          `[Qalam Translation] ${GEMINI_MODEL} error HTTP ${response.status} ${response.statusText}:`,
          errorBody
        );

        let userMessage = `Gemini translation failed (HTTP ${response.status}). Please try again.`;
        let code: GeminiTranslationError['code'] = 'API_ERROR';

        if (response.status === 429 || /RESOURCE_EXHAUSTED|quota|rate[- ]?limit/i.test(errorBody)) {
          const quota = parseGeminiQuotaInfo(errorBody, 'text');
          userMessage =
            quota.scope === 'daily'
              ? 'Gemini free daily translation quota was reached (HTTP 429). Please try again later.'
              : 'Gemini free translation quota is cooling down (HTTP 429). Please wait a few seconds and try again.';
          setCooldown(quota.cooldownMs, userMessage);
          notifyGeminiQuotaNotice(userMessage);
          code = 'QUOTA_EXCEEDED';
        } else if (
          response.status === 401 ||
          response.status === 403 ||
          /API_KEY_INVALID|PERMISSION_DENIED/i.test(errorBody)
        ) {
          setCooldown(60 * 60 * 1000, 'Gemini API key was rejected (HTTP 401/403).');
          userMessage = `Translation failed: Gemini API key was rejected (HTTP ${response.status}).`;
          code = 'AUTH_ERROR';
        }

        if (curatedMatch) {
          return { ...curatedMatch, notice: userMessage };
        }
        throw new GeminiTranslationError(userMessage, { status: response.status, code });
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };
      const rawText =
        payload.candidates?.[0]?.content?.parts
          ?.map((p) => p.text || '')
          .join('\n')
          .trim() || '';

      if (!rawText) {
        console.error('[Qalam Translation] Gemini returned empty response payload:', payload);
        if (curatedMatch) {
          return {
            ...curatedMatch,
            notice: 'Gemini returned an empty response — showing curated dictionary entry.',
          };
        }
        throw new GeminiTranslationError(
          'Gemini returned an empty translation response. Please try again.',
          { code: 'EMPTY_RESPONSE' }
        );
      }

      const parsedResult = parseGeminiTranslationOutput(rawText, trimmedWord, targetLevel);
      if (!parsedResult) {
        console.error('[Qalam Translation] Could not parse Gemini translation response:', rawText);
        if (curatedMatch) {
          return {
            ...curatedMatch,
            notice: 'Could not parse Gemini response — showing curated dictionary entry.',
          };
        }
        throw new GeminiTranslationError(
          'Could not read the translation returned by Gemini. Please try again.',
          { code: 'EMPTY_RESPONSE' }
        );
      }

      setCachedGeminiResult(cacheKey, parsedResult);
      return parsedResult;
    } catch (err) {
      if (err instanceof GeminiTranslationError) {
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof DOMException && err.name === 'AbortError' || /abort|timeout/i.test(errMsg);
      console.error(
        `[Qalam Translation] Request to ${GEMINI_MODEL} failed:`,
        err
      );

      const userMessage = isTimeout
        ? 'Translation request timed out while contacting Gemini. Please try again.'
        : 'Network error while contacting Gemini translation service. Please check your connection and try again.';

      if (curatedMatch) {
        return { ...curatedMatch, notice: userMessage };
      }
      throw new GeminiTranslationError(userMessage, { code: 'NETWORK_ERROR' });
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlightClientTasks.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlightClientTasks.delete(cacheKey);
  }
}

export function hasInstantLexiconMatch(word: string): boolean {
  return Boolean(findExactLexiconMatch(word));
}

export async function generateLessonQuizClient(params: {
  lessonId?: string;
  titleEn?: string;
  textAr: string;
  level?: ProficiencyLevel;
}): Promise<LessonQuizResponse> {
  const cleanTitle = params.titleEn?.trim() || 'Arabic Reading Passage';
  const cacheKey = `quiz::${params.level || 'intermediate'}::${params.lessonId || ''}::${normalizePhraseCacheKey(params.textAr).slice(0, 220)}`;
  const cached = getCachedGeminiResult<LessonQuizResponse>(cacheKey);
  if (cached) {
    return cached;
  }

  const fallbackPayload: LessonQuizResponse = {
    questions: generateFallbackLessonQuiz(params.lessonId, params.textAr, cleanTitle),
    source: 'fallback',
    notice: getActiveQuotaNotice() || 'Built-in comprehension questions for this passage.',
  };

  const apiKey = getClientGeminiApiKey();
  if (!apiKey || Date.now() < getCooldownUntil() || !params.textAr.trim()) {
    return fallbackPayload;
  }

  const prompt = `Create exactly 3 multiple-choice reading comprehension questions based strictly on this Arabic passage for a ${params.level || 'intermediate'} learner.

Passage Title: "${cleanTitle}"
Arabic Text:
"""
${params.textAr.slice(0, 3000)}
"""

Rules:
- Each question must test real comprehension of facts, actions, or ideas stated directly in the passage above.
- Provide questionEn (clear English question), questionAr (Arabic question formatted with Smart Partial Tashkeel), 4 distinct options (concise English answers with key Arabic phrase in parentheses where helpful), correctIndex (0-3), and explanation (1 short sentence quoting or citing the relevant passage detail).`;

  const parsed = await generateGeminiJson<{
    questions?: Array<{
      questionEn?: string;
      questionAr?: string;
      options?: string[];
      correctIndex?: number;
      explanation?: string;
    }>;
  }>({
    prompt,
    systemInstruction:
      'You are an Arabic reading comprehension assessment designer. Return exactly 3 grounded multiple-choice questions in compact JSON.',
    timeoutMs: 6000,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              questionEn: { type: 'STRING' },
              questionAr: { type: 'STRING' },
              options: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              correctIndex: { type: 'INTEGER' },
              explanation: { type: 'STRING' },
            },
            required: ['questionEn', 'questionAr', 'options', 'correctIndex', 'explanation'],
          },
        },
      },
      required: ['questions'],
    },
  });

  if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    return fallbackPayload;
  }

  const sanitized: LessonQuizQuestion[] = parsed.questions.slice(0, 3).map((q, idx) => {
    const options =
      Array.isArray(q.options) && q.options.length >= 2
        ? q.options.slice(0, 4)
        : ['Option A', 'Option B', 'Option C', 'Option D'];
    const safeIdx =
      typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex < options.length
        ? q.correctIndex
        : 0;
    return {
      id: `ai-q-${idx + 1}`,
      questionEn: q.questionEn || 'What does the passage describe?',
      questionAr: applySmartPartialTashkeel(q.questionAr || ''),
      options,
      correctIndex: safeIdx,
      explanation: q.explanation || 'Stated directly in the reading passage.',
    };
  });

  const quizResult: LessonQuizResponse = {
    questions: sanitized,
    source: 'gemini',
  };
  setCachedGeminiResult(cacheKey, quizResult);
  return quizResult;
}

export async function fetchYouTubeOEmbedClient(youtubeUrl: string): Promise<{
  ok: boolean;
  suggestedTitle?: string;
  message: string;
}> {
  const videoId = extractYouTubeVideoId(youtubeUrl);
  if (!videoId) {
    return {
      ok: false,
      message: 'Please enter a valid YouTube Video URL.',
    };
  }

  let suggestedTitle = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);

  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const res = await fetch(oembedUrl, { signal: controller.signal });
    if (res.ok) {
      const data = (await res.json()) as { title?: string };
      if (data.title?.trim()) {
        suggestedTitle = data.title.trim();
      }
    }
  } catch {
    // Ignore CORS or network failures gracefully
  } finally {
    clearTimeout(timer);
  }

  return {
    ok: false,
    suggestedTitle: suggestedTitle || undefined,
    message: suggestedTitle
      ? `تم التعرّف على عنوان الفيديو («${suggestedTitle}»). لا يمكن سحب ترجمة يوتيوب مباشرة من المتصفح؛ ألصق نص الفيديو (العربي أو الإنجليزي مع التوقيت إن وُجد) أدناه أو انشر الفيديو مباشرة.`
      : 'لا يمكن سحب ترجمة يوتيوب مباشرة من المتصفح. ألصق نص الفيديو الحقيقي أدناه (مع التوقيت إن وُجد) أو انشر الدرس كفيديو مباشرة.',
  };
}

export async function processLessonClient(params: {
  contentType: LessonContentType;
  title: string;
  level: ProficiencyLevel;
  textAr: string;
  youtubeUrl?: string;
  estimatedDuration?: number;
}): Promise<{
  needsManualTranscript?: boolean;
  message?: string;
  formattedTextAr: string;
  transcriptSegments?: TranscriptSegment[];
  videoDurationSeconds?: number;
  description: string;
  suggestedTitle?: string;
}> {
  const cleanTitle = params.title.trim();
  const cleanText = params.textAr.trim();

  if (params.contentType === 'video') {
    if (!cleanText) {
      const meta = params.youtubeUrl ? await fetchYouTubeOEmbedClient(params.youtubeUrl) : null;
      return {
        needsManualTranscript: true,
        suggestedTitle: meta?.suggestedTitle,
        formattedTextAr: '',
        description: 'YouTube video lesson for listening practice.',
        message:
          meta?.message ||
          'ألصق نص الفيديو الحقيقي أدناه أو اختر نشر الفيديو مباشرة للتدرّب على الاستماع.',
      };
    }

    const parsedSegments = parsePastedTranscriptSegments(
      cleanText,
      params.estimatedDuration || 240
    );
    let finalSegments = parsedSegments;
    let description =
      'YouTube video lesson with synced Arabic transcript and Smart Partial Tashkeel.';
    const hasArabic = /[\u0600-\u06FF]/.test(cleanText);

    const apiKey = getClientGeminiApiKey();
    if (apiKey && Date.now() >= getCooldownUntil() && parsedSegments.length > 0) {
      const batch = parsedSegments.slice(0, 18);
      const numberedInput = batch
        .map((s, idx) => `[${idx}] (${Math.round(s.startSec)}s-${Math.round(s.endSec)}s): ${s.textAr}`)
        .join('\n');

      const aiResult = await generateGeminiJson<{
        items?: Array<{ textAr?: string }>;
        descriptionEn?: string;
      }>({
        prompt: `Format and polish ONLY this exact pasted transcript for a ${params.level} Arabic learner. Strictly preserve every segment's real content without inventing extra dialogue.
Video Title: "${cleanTitle}"
Segments:
${numberedInput}

Rules:
- Return EXACTLY ${batch.length} items in "items" matching the exact order above.
- ${hasArabic ? 'Keep the original Arabic words intact; lightly normalize punctuation and apply Smart Partial Tashkeel (التشكيل الجزئي الذكي: vowelize final letters, essential Shaddah, and critical Sukun).' : `Translate each segment faithfully into natural Modern Standard Arabic (${params.level} level) and apply Smart Partial Tashkeel.`}
- Also provide descriptionEn: a concise 1-sentence English summary.`,
        systemInstruction:
          'You are an Arabic editor. Format pasted transcripts faithfully with Smart Partial Tashkeel without inventing dialogue.',
        timeoutMs: 8000,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            items: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  textAr: { type: 'STRING' },
                },
                required: ['textAr'],
              },
            },
            descriptionEn: { type: 'STRING' },
          },
          required: ['items'],
        },
      });

      if (aiResult?.descriptionEn?.trim()) {
        description = aiResult.descriptionEn.trim();
      }
      if (Array.isArray(aiResult?.items)) {
        finalSegments = parsedSegments.map((seg, idx) => {
          const aiText = aiResult.items?.[idx]?.textAr?.trim();
          return aiText ? { ...seg, textAr: applySmartPartialTashkeel(aiText) } : seg;
        });
      }
    }

    const maxEndSec =
      finalSegments.length > 0
        ? Math.ceil(finalSegments[finalSegments.length - 1].endSec)
        : params.estimatedDuration || 240;

    return {
      formattedTextAr: finalSegments.map((s) => s.textAr).join('\n\n'),
      transcriptSegments: finalSegments,
      videoDurationSeconds: Math.max(params.estimatedDuration || 0, maxEndSec),
      description,
    };
  }

  // Standard Arabic reading text
  const deterministicFormatted = applySmartPartialTashkeel(cleanText);
  let description =
    'Reading passage formatted with Smart Partial Tashkeel for interactive word lookup.';

  const apiKey = getClientGeminiApiKey();
  if (apiKey && Date.now() >= getCooldownUntil() && cleanText.length > 0) {
    const aiSummary = await generateGeminiJson<{ descriptionEn?: string }>({
      prompt: `Write a single crisp 1-sentence English description summarizing this Arabic reading passage for a ${params.level} learner.
Title: "${cleanTitle}"
Text:
"""
${cleanText.slice(0, 1800)}
"""`,
      systemInstruction:
        'You are an Arabic curriculum editor. Return a 1-sentence English description in JSON.',
      timeoutMs: 3500,
      responseSchema: {
        type: 'OBJECT',
        properties: {
          descriptionEn: { type: 'STRING' },
        },
        required: ['descriptionEn'],
      },
    });
    if (aiSummary?.descriptionEn?.trim()) {
      description = aiSummary.descriptionEn.trim();
    }
  }

  return {
    formattedTextAr: deterministicFormatted,
    description,
  };
}

export async function generateExamClient(params: {
  level: ProficiencyLevel;
  focus: 'saved' | 'hard' | 'level';
  count: number;
  words: Array<{
    id?: string;
    wordWithTashkeel: string;
    englishMeaning: string;
    partOfSpeech?: string;
    exampleAr?: string;
    exampleEn?: string;
  }>;
  fallbackBuilder: () => GeneratedExam;
}): Promise<GeneratedExam> {
  const wordsSig = params.words
    .slice(0, 14)
    .map((w) => normalizeArabicWord(w.wordWithTashkeel))
    .join(',');
  const cacheKey = `exam::${params.level}::${params.focus}::${params.count}::${wordsSig}`;
  const cached = getCachedGeminiResult<GeneratedExam>(cacheKey);
  if (cached) {
    return cached;
  }

  const apiKey = getClientGeminiApiKey();
  if (!apiKey || Date.now() < getCooldownUntil()) {
    const fb = params.fallbackBuilder();
    const qNotice = getActiveQuotaNotice();
    return qNotice ? { ...fb, notice: qNotice } : fb;
  }

  const levelLabels: Record<ProficiencyLevel, { en: string; ar: string }> = {
    beginner: { en: 'Beginner', ar: 'المبتدئ' },
    intermediate: { en: 'Intermediate', ar: 'المتوسط' },
    advanced: { en: 'Advanced', ar: 'المتقدم' },
  };

  const cleanWords = params.words.slice(0, 14);
  const questionCount = Math.max(3, Math.min(10, params.count));
  const wordsSummary =
    cleanWords.length > 0
      ? cleanWords
          .map(
            (w, i) =>
              `${i + 1}. "${w.wordWithTashkeel}" (${w.partOfSpeech || 'word'}) = "${w.englishMeaning}"${w.exampleAr ? ` | example: ${w.exampleAr}` : ''}`
          )
          .join('\n')
      : 'No custom saved cards yet; generate essential level-appropriate Modern Standard Arabic words.';

  const prompt = `Create a ${questionCount}-question Arabic vocabulary & contextual comprehension exam for a ${params.level} (${levelLabels[params.level].ar}) learner.
Focus mode: ${params.focus}

Learner's Saved Vocabulary Words (treat as flexible standalone dictionary entries, NOT frozen to any single sentence's case ending / i'rab):
${wordsSummary}

Requirements:
- Prioritize testing the learner's saved Arabic words listed above.
- Treat each saved word as a flexible vocabulary item: naturally inflect or adapt its case endings, prefixes (like ال or بـ), or verb forms inside fill-in-the-blank and contextual sentences so every Arabic sentence is 100% grammatical, while keeping targetWordAr clear as the standalone dictionary form.
- Mix question types: "meaning" (identify the exact English meaning from context), "fill_blank" (complete an Arabic sentence with ______ using the right Arabic word from 4 choices), and "usage" (choose the best Arabic sentence or contextual nuance).
- Use Smart Partial Tashkeel (التشكيل الجزئي الذكي) on all Arabic prompts, sentences, and Arabic options.
- Always provide exactly 4 distinct options per question and accurate correctIndex (0..3).
- Provide concise bilingual feedback (explanationEn and explanationAr).`;

  const parsed = await generateGeminiJson<{
    titleEn?: string;
    titleAr?: string;
    questions?: Array<{
      type?: string;
      targetWordAr?: string;
      promptAr?: string;
      promptEn?: string;
      contextSentenceAr?: string;
      options?: string[];
      correctIndex?: number;
      explanationEn?: string;
      explanationAr?: string;
    }>;
  }>({
    prompt,
    systemInstruction:
      'You are an Arabic assessment designer creating crisp, pedagogical, textbook-quality Modern Standard Arabic exams.',
    timeoutMs: 9000,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        titleEn: { type: 'STRING' },
        titleAr: { type: 'STRING' },
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              type: { type: 'STRING' },
              targetWordAr: { type: 'STRING' },
              promptAr: { type: 'STRING' },
              promptEn: { type: 'STRING' },
              contextSentenceAr: { type: 'STRING' },
              options: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              correctIndex: { type: 'INTEGER' },
              explanationEn: { type: 'STRING' },
              explanationAr: { type: 'STRING' },
            },
            required: [
              'type',
              'targetWordAr',
              'promptAr',
              'promptEn',
              'options',
              'correctIndex',
              'explanationEn',
              'explanationAr',
            ],
          },
        },
      },
      required: ['titleEn', 'titleAr', 'questions'],
    },
  });

  if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    return params.fallbackBuilder();
  }

  const sanitizedQuestions = parsed.questions.slice(0, questionCount).map((q, idx) => {
    const normalizedTarget = normalizeArabicWord(q.targetWordAr || '');
    const matchedCard = cleanWords.find(
      (w) => normalizeArabicWord(w.wordWithTashkeel || '') === normalizedTarget
    );
    const qType: 'meaning' | 'fill_blank' | 'usage' =
      q.type === 'fill_blank' || q.type === 'usage' ? q.type : 'meaning';
    const opts =
      Array.isArray(q.options) && q.options.length >= 2
        ? q.options.slice(0, 4)
        : ['Option A', 'Option B', 'Option C', 'Option D'];
    const safeIdx =
      typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex < opts.length
        ? q.correctIndex
        : 0;

    return {
      id: `ai-exam-q-${idx + 1}`,
      type: qType,
      targetCardId: matchedCard?.id,
      targetWordAr: applySmartPartialTashkeel(q.targetWordAr || ''),
      promptAr: applySmartPartialTashkeel(q.promptAr || ''),
      promptEn: q.promptEn || 'Select the best answer:',
      contextSentenceAr: q.contextSentenceAr
        ? applySmartPartialTashkeel(q.contextSentenceAr)
        : undefined,
      options: opts.map((o) => (/[\u0600-\u06FF]/.test(o) ? applySmartPartialTashkeel(o) : o)),
      correctIndex: safeIdx,
      explanationEn: q.explanationEn || 'Review this word in context.',
      explanationAr: applySmartPartialTashkeel(q.explanationAr || ''),
    };
  });

  const examResult: GeneratedExam = {
    titleEn: parsed.titleEn || `${levelLabels[params.level].en} Vocabulary Exam`,
    titleAr: applySmartPartialTashkeel(
      parsed.titleAr || `امتحانُ المفرداتِ — المستوى ${levelLabels[params.level].ar}`
    ),
    level: params.level,
    questions: sanitizedQuestions,
    source: 'gemini',
  };
  setCachedGeminiResult(cacheKey, examResult);
  return examResult;
}

export async function generateConversationClient(params: {
  level: ProficiencyLevel;
  scenarioId: string;
  customTopic?: string;
  words: Array<{
    wordWithTashkeel: string;
    englishMeaning: string;
  }>;
  fallbackBuilder: () => GeneratedConversation;
}): Promise<GeneratedConversation> {
  const chosenScenario = params.customTopic?.trim() || params.scenarioId.trim() || 'cafe';
  const wordsSig = params.words
    .slice(0, 8)
    .map((w) => normalizeArabicWord(w.wordWithTashkeel))
    .join(',');
  const cacheKey = `conv::${params.level}::${normalizePhraseCacheKey(chosenScenario)}::${wordsSig}`;
  const cached = getCachedGeminiResult<GeneratedConversation>(cacheKey);
  if (cached) {
    return cached;
  }

  const apiKey = getClientGeminiApiKey();
  if (!apiKey || Date.now() < getCooldownUntil()) {
    const fb = params.fallbackBuilder();
    const qNotice = getActiveQuotaNotice();
    return qNotice ? { ...fb, notice: qNotice } : fb;
  }
  const cleanWords = params.words.slice(0, 8);
  const wordsInstruction =
    cleanWords.length > 0
      ? cleanWords.map((w) => `- ${w.wordWithTashkeel} (${w.englishMeaning})`).join('\n')
      : '- Use practical, natural vocabulary suited to the learner level.';

  const prompt = `Generate a realistic Modern Standard Arabic dialogue scenario and practice sentences for a ${params.level} learner.
Scenario / Topic: "${chosenScenario}"
${getLevelExampleInstruction(params.level)}

Naturally weave as many of these saved learner vocabulary items as fit naturally into the dialogue & practice sentences (treat them as flexible standalone dictionary entries — adapt case endings/prefixes/verb conjugation naturally to fit each sentence's grammar rather than using frozen citation endings):
${wordsInstruction}

Requirements:
- Produce 6 natural dialogue turns alternating between a conversational partner ("partner") and the learner ("learner").
- Include Arabic text with Smart Partial Tashkeel (التشكيل الجزئي الذكي), clean transliteration, natural English translation, and list which target words appeared in each turn (usedWords).
- Also produce 4 standalone real-life practice sentences featuring the learner's vocabulary (grammatically adapted in fresh natural contexts) with a brief tipEn for speaking practice.`;

  const parsed = await generateGeminiJson<{
    titleAr?: string;
    titleEn?: string;
    settingAr?: string;
    settingEn?: string;
    targetWords?: string[];
    turns?: Array<{
      speakerAr?: string;
      speakerEn?: string;
      role?: string;
      arabic?: string;
      transliteration?: string;
      english?: string;
      usedWords?: string[];
    }>;
    practiceSentences?: Array<{
      arabic?: string;
      english?: string;
      focusWordAr?: string;
      tipEn?: string;
    }>;
  }>({
    prompt,
    systemInstruction:
      'You are a native Modern Standard Arabic conversation coach creating authentic, expressive dialogues with Smart Partial Tashkeel.',
    timeoutMs: 9000,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        titleAr: { type: 'STRING' },
        titleEn: { type: 'STRING' },
        settingAr: { type: 'STRING' },
        settingEn: { type: 'STRING' },
        targetWords: { type: 'ARRAY', items: { type: 'STRING' } },
        turns: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              speakerAr: { type: 'STRING' },
              speakerEn: { type: 'STRING' },
              role: { type: 'STRING' },
              arabic: { type: 'STRING' },
              transliteration: { type: 'STRING' },
              english: { type: 'STRING' },
              usedWords: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: [
              'speakerAr',
              'speakerEn',
              'role',
              'arabic',
              'transliteration',
              'english',
              'usedWords',
            ],
          },
        },
        practiceSentences: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              arabic: { type: 'STRING' },
              english: { type: 'STRING' },
              focusWordAr: { type: 'STRING' },
              tipEn: { type: 'STRING' },
            },
            required: ['arabic', 'english', 'focusWordAr', 'tipEn'],
          },
        },
      },
      required: ['titleAr', 'titleEn', 'settingAr', 'settingEn', 'turns', 'practiceSentences'],
    },
  });

  if (!parsed || !Array.isArray(parsed.turns) || parsed.turns.length === 0) {
    return params.fallbackBuilder();
  }

  const convResult: GeneratedConversation = {
    scenarioId: chosenScenario,
    titleAr: applySmartPartialTashkeel(parsed.titleAr || 'مُحَادَثَةٌ عَرَبِيَّةٌ'),
    titleEn: parsed.titleEn || 'Arabic Conversation Practice',
    settingAr: applySmartPartialTashkeel(parsed.settingAr || ''),
    settingEn: parsed.settingEn || 'Everyday Modern Standard Arabic scenario.',
    level: params.level,
    targetWords: Array.isArray(parsed.targetWords)
      ? parsed.targetWords.map((w) => applySmartPartialTashkeel(w))
      : [],
    turns: parsed.turns.slice(0, 8).map((t, idx) => ({
      id: `ai-turn-${idx + 1}`,
      speakerAr: t.speakerAr || (t.role === 'learner' ? 'أَنْتَ' : 'شَرِيكُ الحِوَارِ'),
      speakerEn: t.speakerEn || (t.role === 'learner' ? 'You' : 'Partner'),
      role: t.role === 'learner' ? 'learner' : 'partner',
      arabic: applySmartPartialTashkeel(t.arabic || ''),
      transliteration: t.transliteration || '',
      english: t.english || '',
      usedWords: Array.isArray(t.usedWords)
        ? t.usedWords.map((w) => applySmartPartialTashkeel(w))
        : [],
    })),
    practiceSentences: (parsed.practiceSentences || []).slice(0, 5).map((s, idx) => ({
      id: `ai-prac-${idx + 1}`,
      arabic: applySmartPartialTashkeel(s.arabic || ''),
      english: s.english || '',
      focusWordAr: applySmartPartialTashkeel(s.focusWordAr || ''),
      tipEn: s.tipEn || 'Listen carefully and repeat aloud.',
    })),
    source: 'gemini',
  };
  setCachedGeminiResult(cacheKey, convResult);
  return convResult;
}
