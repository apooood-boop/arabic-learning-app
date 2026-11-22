import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { findExactLexiconMatch, lookupFallbackWord } from './src/data/fallbackLexicon.ts';
import { generateFallbackLessonQuiz } from './src/data/lessonQuizzes.ts';
import type {
  GeneratedConversation,
  GeneratedExam,
  LessonQuizQuestion,
  LessonQuizResponse,
  ProficiencyLevel,
  TranscriptSegment,
  WordAnalysis,
} from './src/types/arabic.ts';
import {
  applySmartPartialTashkeel,
  formatMinimalArabicRoot,
  formatTimestamp,
  inferArabicWordType,
  normalizeArabicWord,
  parsePastedTranscriptSegments,
  sanitizeArabicForSpeech,
  stripFinalIrabForSpeech,
  stripTashkeel,
} from './src/utils/arabic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '1mb' }));

// In-memory LRU-style server cache for instant repeat lookups
const serverWordCache = new Map<string, WordAnalysis>();
const MAX_CACHE_ENTRIES = 500;

function getConfiguredApiKey(): string | null {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.VITE_GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return key;
}

function setServerCache(cacheKey: string, value: WordAnalysis) {
  if (serverWordCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = serverWordCache.keys().next().value;
    if (oldestKey) serverWordCache.delete(oldestKey);
  }
  serverWordCache.set(cacheKey, value);
}

function normalizeProficiencyLevel(raw?: string): ProficiencyLevel {
  if (raw === 'beginner' || raw === 'intermediate' || raw === 'advanced') {
    return raw;
  }
  return 'intermediate';
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

app.post('/api/word/analyze', async (req, res) => {
  const { word, contextSentence, level } = req.body as {
    word?: string;
    contextSentence?: string;
    level?: string;
  };

  if (!word || typeof word !== 'string' || !word.trim()) {
    return res.status(400).json({ error: 'An Arabic word is required.' });
  }

  const trimmedWord = word.trim();
  const trimmedContext = contextSentence?.trim() || trimmedWord;
  const targetLevel = normalizeProficiencyLevel(level);
  const cacheKey = `v3::${targetLevel}::${normalizeArabicWord(trimmedWord)}::${trimmedContext.slice(0, 80)}`;

  // 1. Instant server cache hit
  const cached = serverWordCache.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, source: 'cache' });
  }

  // 2. If GEMINI_API_KEY is missing, return rich built-in lexicon cleanly
  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    const fallback = lookupFallbackWord(
      trimmedWord,
      trimmedContext,
      'Using built-in Arabic lexicon mode for instant translation.',
      targetLevel
    );
    setServerCache(cacheKey, fallback);
    return res.json(fallback);
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const prompt = `Analyze this Arabic word for a ${targetLevel} learner.
Word: "${trimmedWord}"
Context sentence: "${trimmedContext}"

${getLevelExampleInstruction(targetLevel)}

Return strict JSON with:
- wordWithTashkeel: the Arabic word formatted with Smart Partial Tashkeel (التشكيل الجزئي الذكي: vowelize final letter / حركة الإعراب, essential الشدة, and critical Sukun).
- vocalizedWord: the exact same Arabic word with COMPLETE internal harakat (فتحة، ضمة، كسرة، شدة، سكون) for crystal-clear audio pronunciation, in PAUSAL form WITHOUT trailing grammatical case vowels or tanween on the final letter (سكون الوقف بدون حركة الإعراب).
- partOfSpeech: concise English POS (e.g. "Noun", "Verb (Present)", "Adjective", "Adverb", "Preposition").
- wordType: ONE concise Arabic grammatical category chosen strictly from: "اسم", "فعل", "حرف", "ظرف", "صفة", or "ضمير".
- root: ONLY the original 3 or 4 root Arabic letters separated by " - " (for example "ك - ت - ب" or "ق - و - م"). NEVER include derived words, meanings, or extra text. Return "" if it is an uninflected particle/pronoun with no triliteral root.
- transliteration: clean Latin phonetic transliteration.
- englishMeaning: accurate English meaning in the given context (if polysemous, mention primary + secondary sense briefly).
- examples: 2 (or 3 if strongly polysemous) HYPER-REALISTIC, natural Arabic sentences STRICTLY calibrated to the ${targetLevel} level above.
  * POLYSEMY RULE: If the word has multiple common meanings across contexts, each example showcases a distinct real-world meaning while staying strictly at the ${targetLevel} level!
  * Strictly use Smart Partial Tashkeel (التشكيل الجزئي الذكي: vowelize final endings/tanwin, Shaddah, and critical Sukun; leave middle letters clean).
  * Include contextLabel (e.g. "${targetLevel === 'beginner' ? 'Beginner · Daily Use' : targetLevel === 'advanced' ? 'Advanced · Literary Context' : 'Intermediate · Practical Use'}") and accurate English translation for each.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        wordWithTashkeel: { type: Type.STRING },
        vocalizedWord: { type: Type.STRING },
        partOfSpeech: { type: Type.STRING },
        wordType: { type: Type.STRING },
        root: { type: Type.STRING },
        transliteration: { type: Type.STRING },
        englishMeaning: { type: Type.STRING },
        examples: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              arabic: { type: Type.STRING },
              english: { type: Type.STRING },
              contextLabel: { type: Type.STRING },
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
    };

    const runModel = (model: string) =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          thinkingConfig: {
            thinkingLevel:
              model === 'gemini-3.1-flash-lite'
                ? ThinkingLevel.MINIMAL
                : ThinkingLevel.LOW,
          },
          systemInstruction:
            'You are a native-speaking Arabic linguist and curriculum designer. Strictly match example sentence complexity, length, and vocabulary to the requested learner level (beginner, intermediate, or advanced), provide complete internal vocalization without final case endings in vocalizedWord, and return Smart Partial Tashkeel in display fields.',
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

    // Race Gemini with a snappy 3.2s timeout so the UI stays fast and responsive
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT_UPSTREAM')), 3200)
    );

    const response = await Promise.race([
      runModel('gemini-3.1-flash-lite'),
      timeoutPromise,
    ]);

    const rawText = (response?.text ?? '').trim();
    if (!rawText) {
      throw new Error('Empty response returned from Gemini API.');
    }

    const parsed = JSON.parse(rawText) as Omit<WordAnalysis, 'word' | 'source'>;
    if (!Array.isArray(parsed.examples) || parsed.examples.length < 2) {
      throw new Error('Incomplete example sentences returned from Gemini API.');
    }

    const resolvedWordType = inferArabicWordType(parsed.wordType || parsed.partOfSpeech);
    const resolvedPartOfSpeech = parsed.partOfSpeech || 'Word';

    const result: WordAnalysis = {
      word: trimmedWord,
      wordWithTashkeel: applySmartPartialTashkeel(parsed.wordWithTashkeel || trimmedWord),
      vocalizedWord: stripFinalIrabForSpeech(
        parsed.vocalizedWord || parsed.wordWithTashkeel || trimmedWord,
        {
          wordType: resolvedWordType,
          partOfSpeech: resolvedPartOfSpeech,
        }
      ),
      partOfSpeech: resolvedPartOfSpeech,
      wordType: resolvedWordType,
      root: formatMinimalArabicRoot(parsed.root),
      transliteration: parsed.transliteration || '',
      englishMeaning: parsed.englishMeaning,
      examples: parsed.examples.slice(0, 3).map((ex) => ({
        arabic: applySmartPartialTashkeel(ex.arabic),
        english: ex.english,
        contextLabel: ex.contextLabel,
      })),
      level: targetLevel,
      source: 'gemini',
    };

    setServerCache(cacheKey, result);
    return res.json(result);
  } catch (err: unknown) {
    let message =
      err instanceof Error ? err.message : 'Failed to analyze Arabic word with Gemini API.';
    try {
      const parsedErr = JSON.parse(message) as { error?: { message?: string } };
      if (parsedErr?.error?.message) {
        message = parsedErr.error.message;
      }
    } catch {
      // Keep original message
    }

    const isInvalidKey =
      message.includes('API key') ||
      message.includes('API_KEY_INVALID') ||
      message.includes('PERMISSION_DENIED') ||
      message.includes('403');

    const friendlyNotice = isInvalidKey
      ? 'Showing built-in Arabic lexicon fallback.'
      : message === 'TIMEOUT_UPSTREAM'
        ? 'Showing fast built-in lexicon fallback.'
        : 'Showing fast built-in lexicon fallback.';

    const hasExact = Boolean(findExactLexiconMatch(trimmedWord));
    if (hasExact || !isInvalidKey) {
      const fallback = lookupFallbackWord(
        trimmedWord,
        trimmedContext,
        friendlyNotice,
        targetLevel
      );
      return res.json(fallback);
    }

    return res.status(401).json({
      error: friendlyNotice,
      fallback: lookupFallbackWord(
        trimmedWord,
        trimmedContext,
        friendlyNotice,
        targetLevel
      ),
    });
  }
});

app.post('/api/lesson/quiz', async (req, res) => {
  const { lessonId, titleEn, level, textAr } = req.body as {
    lessonId?: string;
    titleEn?: string;
    level?: string;
    textAr?: string;
  };

  if (!textAr || typeof textAr !== 'string' || !textAr.trim()) {
    return res.status(400).json({ error: 'Arabic passage text is required to generate a quiz.' });
  }

  const cleanTitle = titleEn?.trim() || 'Arabic Reading Passage';
  const apiKey = getConfiguredApiKey();

  if (!apiKey) {
    const payload: LessonQuizResponse = {
      questions: generateFallbackLessonQuiz(lessonId, textAr, cleanTitle),
      source: 'fallback',
      notice: 'Showing built-in comprehension questions for this passage.',
    };
    return res.json(payload);
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const prompt = `Create exactly 3 multiple-choice reading comprehension questions based strictly on this Arabic passage for a ${level || 'intermediate'} learner.

Passage Title: "${cleanTitle}"
Arabic Text:
"""
${textAr.slice(0, 3000)}
"""

Rules:
- Each question must test real comprehension of facts, actions, or ideas stated directly in the passage above.
- Provide questionEn (clear English question), questionAr (Arabic question formatted with Smart Partial Tashkeel), 4 distinct options (concise English answers with key Arabic phrase in parentheses where helpful), correctIndex (0-3), and explanation (1 short sentence quoting or citing the relevant passage detail).`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionEn: { type: Type.STRING },
              questionAr: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              correctIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
            },
            required: ['questionEn', 'questionAr', 'options', 'correctIndex', 'explanation'],
          },
        },
      },
      required: ['questions'],
    };

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT_UPSTREAM')), 4500)
    );

    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          systemInstruction:
            'You are an Arabic reading comprehension assessment designer. Return exactly 3 grounded multiple-choice questions in compact JSON.',
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
      timeoutPromise,
    ]);

    const rawText = (response?.text ?? '').trim();
    if (!rawText) {
      throw new Error('Empty quiz response from Gemini API.');
    }

    const parsed = JSON.parse(rawText) as {
      questions?: Array<{
        questionEn: string;
        questionAr: string;
        options: string[];
        correctIndex: number;
        explanation: string;
      }>;
    };

    if (!Array.isArray(parsed.questions) || parsed.questions.length < 3) {
      throw new Error('Incomplete quiz returned from Gemini API.');
    }

    const questions: LessonQuizQuestion[] = parsed.questions.slice(0, 3).map((q, idx) => ({
      id: `ai-q-${idx + 1}`,
      questionEn: q.questionEn,
      questionAr: applySmartPartialTashkeel(q.questionAr),
      options: q.options.slice(0, 4),
      correctIndex: Math.max(0, Math.min(3, Number(q.correctIndex) || 0)),
      explanation: q.explanation,
    }));

    const payload: LessonQuizResponse = {
      questions,
      source: 'gemini',
    };
    return res.json(payload);
  } catch {
    const payload: LessonQuizResponse = {
      questions: generateFallbackLessonQuiz(lessonId, textAr, cleanTitle),
      source: 'fallback',
      notice: 'Gemini API is temporarily busy. Showing built-in comprehension questions for this passage.',
    };
    return res.json(payload);
  }
});

function extractYouTubeVideoId(url?: string): string | null {
  if (!url || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/embed/')) {
        return parsed.pathname.replace('/embed/', '').split('/')[0] || null;
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        return parsed.pathname.replace('/shorts/', '').split('/')[0] || null;
      }
      return parsed.searchParams.get('v');
    }
  } catch {
    return null;
  }
  return null;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

interface RawCaptionSegment {
  startSec: number;
  endSec: number;
  text: string;
}

function groupCaptionCues(
  cues: Array<{ startSec: number; durSec: number; text: string }>,
  targetSegmentCount = 48
): RawCaptionSegment[] {
  if (cues.length === 0) return [];

  const totalSpan = Math.max(
    15,
    cues[cues.length - 1].startSec + Math.max(2, cues[cues.length - 1].durSec)
  );
  const minSegmentSeconds = totalSpan > targetSegmentCount * 10 ? totalSpan / targetSegmentCount : 8;

  const grouped: RawCaptionSegment[] = [];
  let currentTexts: string[] = [];
  let currentStart = cues[0].startSec;
  let currentEnd = cues[0].startSec + cues[0].durSec;
  let currentWords = 0;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    currentTexts.push(cue.text);
    currentEnd = Math.max(currentEnd, cue.startSec + Math.max(1.5, cue.durSec));
    currentWords += cue.text.split(/\s+/).filter(Boolean).length;

    const elapsed = currentEnd - currentStart;
    const endsSentence = /[.؟!؛]$/.test(cue.text);
    const isLast = i === cues.length - 1;

    if (
      isLast ||
      (elapsed >= minSegmentSeconds && (endsSentence || currentWords >= 18)) ||
      currentWords >= 34 ||
      elapsed >= Math.max(22, minSegmentSeconds * 1.45)
    ) {
      grouped.push({
        startSec: Math.round(currentStart * 10) / 10,
        endSec: Math.round(currentEnd * 10) / 10,
        text: currentTexts.join(' ').replace(/\s+/g, ' ').trim(),
      });
      if (!isLast) {
        currentTexts = [];
        currentStart = cues[i + 1].startSec;
        currentEnd = cues[i + 1].startSec + cues[i + 1].durSec;
        currentWords = 0;
      }
    }
  }

  return grouped;
}

function extractJsonArrayAfter(source: string, marker: string): string | null {
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) return null;
  const start = source.indexOf('[', markerIdx + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return null;
}

interface CaptionCue {
  startSec: number;
  durSec: number;
  text: string;
}

function parseCaptionPayload(bodyText: string): CaptionCue[] {
  const trimmed = bodyText.trim();
  if (!trimmed) return [];

  // Try JSON3 format
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as {
        events?: Array<{
          tStartMs?: number;
          dDurationMs?: number;
          segs?: Array<{ utf8?: string }>;
        }>;
      };
      const cues: CaptionCue[] = [];
      for (const ev of json.events || []) {
        if (!Array.isArray(ev.segs)) continue;
        const text = ev.segs
          .map((s) => s.utf8 || '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text || text === '\n') continue;
        const startSec = Math.max(0, (Number(ev.tStartMs) || 0) / 1000);
        const durSec = Math.max(1.5, (Number(ev.dDurationMs) || 3000) / 1000);
        cues.push({ startSec, durSec, text });
      }
      if (cues.length > 0) return cues;
    } catch {
      // Fall through to XML parsing
    }
  }

  // Parse standard XML <text start="..." dur="..."> or srv3 <p t="..." d="...">
  const cues: CaptionCue[] = [];
  const textRegex = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(trimmed)) !== null) {
    const attrs = match[1];
    const rawText = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawText) continue;
    const startMatch = attrs.match(/start="([\d.]+)"/);
    const durMatch = attrs.match(/dur="([\d.]+)"/);
    const startSec = startMatch ? Number(startMatch[1]) : 0;
    const durSec = durMatch ? Number(durMatch[1]) : 3;
    if (Number.isFinite(startSec)) {
      cues.push({
        startSec,
        durSec: Number.isFinite(durSec) && durSec > 0 ? durSec : 3,
        text: rawText,
      });
    }
  }
  if (cues.length > 0) return cues;

  const pRegex = /<p\s+([^>]*)>([\s\S]*?)<\/p>/g;
  while ((match = pRegex.exec(trimmed)) !== null) {
    const attrs = match[1];
    const rawText = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawText) continue;
    const tMatch = attrs.match(/t="(\d+)"/);
    const dMatch = attrs.match(/d="(\d+)"/);
    const startSec = tMatch ? Number(tMatch[1]) / 1000 : 0;
    const durSec = dMatch ? Number(dMatch[1]) / 1000 : 3;
    if (Number.isFinite(startSec)) {
      cues.push({
        startSec,
        durSec: Number.isFinite(durSec) && durSec > 0 ? durSec : 3,
        text: rawText,
      });
    }
  }

  return cues;
}

async function fetchCaptionCuesFromTrackUrl(baseUrl: string): Promise<CaptionCue[]> {
  try {
    const urlObj = new URL(baseUrl);
    if (!urlObj.searchParams.has('fmt')) {
      urlObj.searchParams.set('fmt', 'srv3');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(urlObj.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    clearTimeout(timer);
    if (res.ok) {
      const cues = parseCaptionPayload(await res.text());
      if (cues.length > 0) return cues;
    }
  } catch {
    // Try original URL without extra params
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(baseUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      return parseCaptionPayload(await res.text());
    }
  } catch {
    // Non-fatal track fetch error
  }
  return [];
}

async function fetchYouTubeMetadataAndTranscript(youtubeUrl: string): Promise<{
  videoTitle: string;
  authorName: string;
  durationSeconds: number;
  languageCode: string;
  segments: RawCaptionSegment[];
}> {
  const videoId = extractYouTubeVideoId(youtubeUrl);
  let videoTitle = '';
  let authorName = '';
  let durationSeconds = 240;
  let languageCode = '';
  let segments: RawCaptionSegment[] = [];

  if (!videoId) {
    return { videoTitle, authorName, durationSeconds, languageCode, segments };
  }

  // 1. Fetch YouTube oEmbed metadata for real video title
  try {
    const oembedController = new AbortController();
    const oembedTimer = setTimeout(() => oembedController.abort(), 2500);
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      { signal: oembedController.signal }
    );
    clearTimeout(oembedTimer);
    if (oembedRes.ok) {
      const oembedJson = (await oembedRes.json()) as { title?: string; author_name?: string };
      videoTitle = oembedJson.title?.trim() || '';
      authorName = oembedJson.author_name?.trim() || '';
    }
  } catch {
    // Non-fatal metadata lookup failure
  }

  let candidateTracks: Array<{ baseUrl?: string; languageCode?: string; kind?: string }> = [];

  // 2. Extract duration and captionTracks from watch page HTML
  try {
    const pageController = new AbortController();
    const pageTimer = setTimeout(() => pageController.abort(), 3500);
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=ar`, {
      signal: pageController.signal,
      headers: {
        'Accept-Language': 'ar,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    clearTimeout(pageTimer);

    if (pageRes.ok) {
      const html = await pageRes.text();

      const lengthMatch = html.match(/"lengthSeconds":"(\d+)"/);
      if (lengthMatch?.[1]) {
        const parsedLen = Number(lengthMatch[1]);
        if (Number.isFinite(parsedLen) && parsedLen > 0) {
          durationSeconds = parsedLen;
        }
      } else {
        const approxMatch = html.match(/"approxDurationMs":"(\d+)"/);
        if (approxMatch?.[1]) {
          const parsedMs = Number(approxMatch[1]);
          if (Number.isFinite(parsedMs) && parsedMs > 0) {
            durationSeconds = Math.round(parsedMs / 1000);
          }
        }
      }

      const rawTracksJson = extractJsonArrayAfter(html, '"captionTracks":');
      if (rawTracksJson) {
        candidateTracks = JSON.parse(rawTracksJson) as Array<{
          baseUrl?: string;
          languageCode?: string;
          kind?: string;
        }>;
      }
    }
  } catch {
    // Try InnerTube / timedtext fallbacks next
  }

  // 3. Fallback: YouTube InnerTube player endpoint for captionTracks if watch page blocked or omitted them
  if (candidateTracks.length === 0) {
    try {
      const ytController = new AbortController();
      const ytTimer = setTimeout(() => ytController.abort(), 3500);
      const ytRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        signal: ytController.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '19.09.37',
              hl: 'ar',
            },
          },
          videoId,
        }),
      });
      clearTimeout(ytTimer);

      if (ytRes.ok) {
        const ytData = (await ytRes.json()) as {
          videoDetails?: { lengthSeconds?: string; title?: string; author?: string };
          captions?: {
            playerCaptionsTracklistRenderer?: {
              captionTracks?: Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
            };
          };
        };
        if (ytData.videoDetails?.lengthSeconds) {
          const parsedLen = Number(ytData.videoDetails.lengthSeconds);
          if (Number.isFinite(parsedLen) && parsedLen > 0) {
            durationSeconds = parsedLen;
          }
        }
        if (!videoTitle && ytData.videoDetails?.title) {
          videoTitle = ytData.videoDetails.title.trim();
        }
        const innerTracks = ytData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(innerTracks)) {
          candidateTracks = innerTracks;
        }
      }
    } catch {
      // Non-fatal InnerTube fallback failure
    }
  }

  // 4. Fetch actual captions from preferred track
  if (candidateTracks.length > 0) {
    const preferredTrack =
      candidateTracks.find((t) => t.languageCode?.startsWith('ar') && t.kind !== 'asr') ??
      candidateTracks.find((t) => t.languageCode?.startsWith('ar')) ??
      candidateTracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ??
      candidateTracks[0];

    if (preferredTrack?.baseUrl) {
      languageCode = preferredTrack.languageCode || '';
      const cues = await fetchCaptionCuesFromTrackUrl(preferredTrack.baseUrl);
      if (cues.length > 0) {
        segments = groupCaptionCues(cues, 48);
        const lastSegEnd = Math.ceil(segments[segments.length - 1].endSec);
        if (lastSegEnd > durationSeconds) {
          durationSeconds = lastSegEnd;
        }
      }
    }
  }

  // 5. Fallback: Direct timedtext list/fetch endpoint
  if (segments.length === 0) {
    try {
      const listController = new AbortController();
      const listTimer = setTimeout(() => listController.abort(), 3000);
      const listRes = await fetch(
        `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&type=list`,
        { signal: listController.signal }
      );
      clearTimeout(listTimer);

      if (listRes.ok) {
        const listXml = await listRes.text();
        const tracks: Array<{ lang: string; kind: string; name: string }> = [];
        const trRegex = /<track\s+([^>]+?)\/?>/g;
        let m: RegExpExecArray | null;
        while ((m = trRegex.exec(listXml)) !== null) {
          const attrs = m[1];
          const lang = attrs.match(/lang_code="([^"]+)"/)?.[1] || '';
          const kind = attrs.match(/kind="([^"]+)"/)?.[1] || '';
          const name = attrs.match(/name="([^"]*)"/)?.[1] || '';
          if (lang) tracks.push({ lang, kind, name });
        }

        const chosen =
          tracks.find((t) => t.lang.startsWith('ar') && t.kind !== 'asr') ??
          tracks.find((t) => t.lang.startsWith('ar')) ??
          tracks.find((t) => t.lang.startsWith('en') && t.kind !== 'asr') ??
          tracks[0];

        if (chosen) {
          languageCode = chosen.lang;
          const ttUrl = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(chosen.lang)}${chosen.kind ? `&kind=${encodeURIComponent(chosen.kind)}` : ''}${chosen.name ? `&name=${encodeURIComponent(chosen.name)}` : ''}`;
          const cues = await fetchCaptionCuesFromTrackUrl(ttUrl);
          if (cues.length > 0) {
            segments = groupCaptionCues(cues, 48);
            const lastSegEnd = Math.ceil(segments[segments.length - 1].endSec);
            if (lastSegEnd > durationSeconds) {
              durationSeconds = lastSegEnd;
            }
          }
        }
      }
    } catch {
      // Non-fatal timedtext fallback failure
    }
  }

  return { videoTitle, authorName, durationSeconds, languageCode, segments };
}

app.post('/api/lesson/youtube-captions', async (req, res) => {
  const { youtubeUrl } = req.body as { youtubeUrl?: string };
  const cleanUrl = youtubeUrl?.trim() || '';
  const videoId = extractYouTubeVideoId(cleanUrl);

  if (!videoId) {
    return res.status(400).json({ error: 'Please provide a valid YouTube Video URL.' });
  }

  const { videoTitle, durationSeconds, languageCode, segments } =
    await fetchYouTubeMetadataAndTranscript(cleanUrl);

  if (segments.length === 0) {
    return res.json({
      ok: false,
      videoId,
      suggestedTitle: videoTitle,
      videoDurationSeconds: durationSeconds,
      languageCode: '',
      rawTranscriptText: '',
      message:
        'تعذّر استخراج الترجمة تلقائيًا من يوتيوب (قد تكون محجوبة أو غير متوفرة). يمكنك لصق نص الفيديو الحقيقي أدناه.',
    });
  }

  const rawTranscriptText = segments
    .map((seg) => `${formatTimestamp(seg.startSec)} ${seg.text}`)
    .join('\n\n');

  return res.json({
    ok: true,
    videoId,
    suggestedTitle: videoTitle,
    videoDurationSeconds: durationSeconds,
    languageCode,
    segmentCount: segments.length,
    rawTranscriptText,
  });
});

app.post('/api/lesson/process', async (req, res) => {
  const { contentType, title, level, textAr, youtubeUrl } = req.body as {
    contentType?: 'text' | 'video';
    title?: string;
    subtitle?: string;
    level?: string;
    textAr?: string;
    youtubeUrl?: string;
  };

  const cleanTitle = title?.trim() || '';
  const cleanText = textAr?.trim() || '';
  const cleanUrl = youtubeUrl?.trim() || '';
  const targetLevel = level || 'intermediate';
  const apiKey = getConfiguredApiKey();

  if (contentType === 'video') {
    if (!cleanUrl || !extractYouTubeVideoId(cleanUrl)) {
      return res.status(400).json({ error: 'Please provide a valid YouTube Video URL.' });
    }

    const { videoTitle, durationSeconds, languageCode, segments: rawCaptionSegments } =
      await fetchYouTubeMetadataAndTranscript(cleanUrl);

    // Case A: User manually supplied/pasted REAL transcript text -> preserve real timestamps if present, apply Smart Partial Tashkeel
    if (cleanText) {
      const parsedFromPaste = parsePastedTranscriptSegments(cleanText, durationSeconds);
      let finalSegments: TranscriptSegment[] = parsedFromPaste;
      let description =
        'Video lesson with full-length interactive Arabic transcript and Smart Partial Tashkeel.';
      let source: 'gemini' | 'fallback' = 'fallback';

      const pastedHasArabic = /[\u0600-\u06FF]/.test(cleanText);

      if (apiKey && parsedFromPaste.length > 0) {
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });

          const BATCH_SIZE = 16;
          const batches: TranscriptSegment[][] = [];
          for (let i = 0; i < parsedFromPaste.length; i += BATCH_SIZE) {
            batches.push(parsedFromPaste.slice(i, i + BATCH_SIZE));
          }

          const batchResults = await Promise.all(
            batches.slice(0, 5).map(async (batch, batchIdx) => {
              const offset = batchIdx * BATCH_SIZE;
              const numberedInput = batch
                .map((s, j) => `[${offset + j}] (${Math.round(s.startSec)}s-${Math.round(s.endSec)}s): ${s.textAr}`)
                .join('\n');

              const prompt = `Format and polish ONLY this exact pasted transcript for a ${targetLevel} Arabic learner. Strictly preserve every segment's real content without inventing extra dialogue.
Video Title: "${cleanTitle || videoTitle}"
Segments:
${numberedInput}

Rules:
- Return EXACTLY ${batch.length} items in "items" matching the exact order above.
- ${pastedHasArabic ? 'Keep the original Arabic words intact; lightly normalize punctuation and apply Smart Partial Tashkeel (التشكيل الجزئي الذكي: vowelize final letters, essential Shaddah, and critical Sukun).' : `Translate each segment faithfully into natural Modern Standard Arabic (${targetLevel} level) and apply Smart Partial Tashkeel.`}
${batchIdx === 0 ? '- Also provide descriptionEn: a concise 1-sentence English summary.' : ''}`;

              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT_UPSTREAM')), 8500)
              );

              const response = await Promise.race([
                ai.models.generateContent({
                  model: 'gemini-3.1-flash-lite',
                  contents: prompt,
                  config: {
                    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
                    systemInstruction:
                      'You are an Arabic editor. Format pasted transcripts faithfully with Smart Partial Tashkeel without inventing or adding unstated dialogue.',
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        items: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              textAr: { type: Type.STRING },
                            },
                            required: ['textAr'],
                          },
                        },
                        descriptionEn: { type: Type.STRING },
                      },
                      required: ['items'],
                    },
                  },
                }),
                timeoutPromise,
              ]);

              const parsed = JSON.parse((response?.text ?? '').trim()) as {
                items?: Array<{ textAr: string }>;
                descriptionEn?: string;
              };
              return { offset, batch, parsed };
            })
          );

          const updated = [...finalSegments];
          let anySuccess = false;
          for (const resBatch of batchResults) {
            if (resBatch.parsed.descriptionEn?.trim()) {
              description = resBatch.parsed.descriptionEn.trim();
            }
            if (Array.isArray(resBatch.parsed.items)) {
              resBatch.batch.forEach((_seg, idxInBatch) => {
                const aiText = resBatch.parsed.items?.[idxInBatch]?.textAr?.trim();
                if (aiText) {
                  anySuccess = true;
                  updated[resBatch.offset + idxInBatch] = {
                    ...updated[resBatch.offset + idxInBatch],
                    textAr: applySmartPartialTashkeel(aiText),
                  };
                }
              });
            }
          }
          if (anySuccess) {
            finalSegments = updated;
            source = 'gemini';
          }
        } catch {
          // Fall through with deterministic Smart Partial Tashkeel segments
        }
      }

      const maxEndSec = finalSegments.length > 0 ? Math.ceil(finalSegments[finalSegments.length - 1].endSec) : durationSeconds;
      return res.json({
        formattedTextAr: finalSegments.map((s) => s.textAr).join('\n\n'),
        transcriptSegments: finalSegments,
        videoDurationSeconds: Math.max(durationSeconds, maxEndSec),
        description,
        suggestedTitle: videoTitle || cleanTitle,
        source,
      });
    }

    // Case B: Extracted real timestamped captions from YouTube across the ENTIRE video
    if (rawCaptionSegments.length > 0) {
      const isArabicCaptions = languageCode.startsWith('ar') || /[\u0600-\u06FF]/.test(rawCaptionSegments[0].text);
      let finalSegments: TranscriptSegment[] = rawCaptionSegments.map((seg, idx) => ({
        id: `seg-${idx + 1}`,
        startSec: seg.startSec,
        endSec: seg.endSec,
        textAr: isArabicCaptions ? applySmartPartialTashkeel(seg.text) : seg.text,
      }));
      let description =
        'Full-length YouTube transcript extracted with timestamps and Smart Partial Tashkeel.';
      let source: 'gemini' | 'fallback' = 'fallback';

      if (apiKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });

          // Process ALL segments across the entire video in batches so timestamps stay 1:1
          const BATCH_SIZE = 16;
          const batches: RawCaptionSegment[][] = [];
          for (let i = 0; i < rawCaptionSegments.length; i += BATCH_SIZE) {
            batches.push(rawCaptionSegments.slice(i, i + BATCH_SIZE));
          }

          const batchResults = await Promise.all(
            batches.slice(0, 5).map(async (batch, batchIdx) => {
              const offset = batchIdx * BATCH_SIZE;
              const numberedInput = batch
                .map((s, j) => `[${offset + j}] (${Math.round(s.startSec)}s-${Math.round(s.endSec)}s): ${s.text}`)
                .join('\n');

              const prompt = `Process ONLY these real extracted YouTube video transcript segments for a ${targetLevel} Arabic learner. Do NOT invent extra dialogue.
Video Title: "${cleanTitle || videoTitle}"
Segments:
${numberedInput}

Rules:
- Return EXACTLY ${batch.length} items in the "items" array matching the exact order and indices above.
- For each segment: if the input is English or non-Arabic, translate it faithfully into natural Modern Standard Arabic (${targetLevel} level); if already Arabic, clean punctuation lightly without altering meaning.
- Apply Smart Partial Tashkeel (التشكيل الجزئي الذكي): vowelize final case/verb endings, essential Shaddah, and critical Sukun.
${batchIdx === 0 ? '- Also include descriptionEn: a concise 1-sentence English summary of the full video.' : ''}`;

              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('TIMEOUT_UPSTREAM')), 8500)
              );

              const response = await Promise.race([
                ai.models.generateContent({
                  model: 'gemini-3.1-flash-lite',
                  contents: prompt,
                  config: {
                    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
                    systemInstruction:
                      'You are an Arabic curriculum editor. Preserve 1-to-1 segment correspondence and format every segment with Smart Partial Tashkeel.',
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        items: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              textAr: { type: Type.STRING },
                            },
                            required: ['textAr'],
                          },
                        },
                        descriptionEn: { type: Type.STRING },
                      },
                      required: ['items'],
                    },
                  },
                }),
                timeoutPromise,
              ]);

              const parsed = JSON.parse((response?.text ?? '').trim()) as {
                items?: Array<{ textAr: string }>;
                descriptionEn?: string;
              };
              return { offset, batch, parsed };
            })
          );

          let anySuccess = false;
          const updated = [...finalSegments];
          for (const resBatch of batchResults) {
            if (resBatch.parsed.descriptionEn?.trim()) {
              description = resBatch.parsed.descriptionEn.trim();
            }
            if (Array.isArray(resBatch.parsed.items)) {
              resBatch.batch.forEach((_seg, idxInBatch) => {
                const aiText = resBatch.parsed.items?.[idxInBatch]?.textAr?.trim();
                if (aiText) {
                  anySuccess = true;
                  updated[resBatch.offset + idxInBatch] = {
                    ...updated[resBatch.offset + idxInBatch],
                    textAr: applySmartPartialTashkeel(aiText),
                  };
                }
              });
            }
          }

          if (anySuccess) {
            finalSegments = updated;
            source = 'gemini';
          }
        } catch {
          // Keep extracted captions with local Smart Partial Tashkeel
        }
      }

      return res.json({
        formattedTextAr: finalSegments.map((s) => s.textAr).join('\n\n'),
        transcriptSegments: finalSegments,
        videoDurationSeconds: durationSeconds,
        description,
        suggestedTitle: videoTitle || cleanTitle,
        source,
      });
    }

    // Case C: YouTube blocked captions or no subtitles exist -> NEVER invent or hallucinate a transcript
    return res.json({
      needsManualTranscript: true,
      formattedTextAr: '',
      transcriptSegments: [],
      videoDurationSeconds: durationSeconds,
      description: 'YouTube video lesson for listening comprehension and synced reading.',
      suggestedTitle: videoTitle || cleanTitle,
      message:
        'تعذّر جلب الترجمة تلقائيًا من يوتيوب (قد تكون محجوبة أو غير متوفرة). ألصق نص الفيديو الحقيقي أدناه أو انشره كدرس مرئي.',
      source: 'none',
    });
  }

  // Written Text lesson: apply Smart Partial Tashkeel via Gemini AI + internal formatter
  if (!cleanText) {
    return res.status(400).json({ error: 'Arabic reading text content is required.' });
  }

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const prompt = `Apply Smart Partial Tashkeel (التشكيل الجزئي الذكي) to the following Arabic reading passage for a ${targetLevel} learner without changing any words or meaning.

Arabic Text:
"""
${cleanText.slice(0, 4000)}
"""

Smart Partial Tashkeel Rules:
- Vowelize final letters of words (حركة الإعراب / التنوين) accurately based on Arabic grammar.
- Keep essential Shaddah (الشدة) and critical Sukun on diphthongs (e.g., بيْت، يوْم) and final silent endings.
- Leave unproblematic middle letters clean and uncluttered like a modern Arabic textbook.
- Preserve paragraph breaks.
- Also provide a concise 1-sentence English description summarizing the passage.`;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          formattedTextAr: { type: Type.STRING },
          descriptionEn: { type: Type.STRING },
        },
        required: ['formattedTextAr', 'descriptionEn'],
      };

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT_UPSTREAM')), 5500)
      );

      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            systemInstruction:
              'You are an Arabic grammarian and textbook editor. Apply accurate Smart Partial Tashkeel (التشكيل الجزئي الذكي) to Arabic texts without altering words.',
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        timeoutPromise,
      ]);

      const rawJson = (response?.text ?? '').trim();
      if (rawJson) {
        const parsed = JSON.parse(rawJson) as {
          formattedTextAr?: string;
          descriptionEn?: string;
        };
        if (parsed.formattedTextAr?.trim()) {
          return res.json({
            formattedTextAr: applySmartPartialTashkeel(parsed.formattedTextAr.trim()),
            description:
              parsed.descriptionEn?.trim() ||
              'Reading passage formatted with Smart Partial Tashkeel for interactive word lookup.',
            source: 'gemini',
          });
        }
      }
    } catch {
      // Fall through to deterministic Smart Partial Tashkeel formatter
    }
  }

  return res.json({
    formattedTextAr: applySmartPartialTashkeel(cleanText),
    description: 'Reading passage formatted with Smart Partial Tashkeel for interactive word lookup.',
    source: 'fallback',
  });
});

const serverTtsCache = new Map<string, { buffer: Buffer; contentType: string }>();
const MAX_TTS_CACHE_ENTRIES = 500;
let geminiTtsCooldownUntil = 0;

function isGeminiQuotaError(message: string): boolean {
  return /429|RESOURCE_EXHAUSTED|quota|rate[- ]?limit/i.test(message);
}

function extractQuotaCooldownMs(message: string): number {
  const secMatch = message.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (secMatch?.[1]) {
    const secs = Number(secMatch[1]);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(12 * 60 * 60 * 1000, Math.max(60 * 1000, secs * 1000));
    }
  }
  return 60 * 60 * 1000;
}

function setServerTtsCache(key: string, entry: { buffer: Buffer; contentType: string }) {
  if (serverTtsCache.size >= MAX_TTS_CACHE_ENTRIES) {
    const oldestKey = serverTtsCache.keys().next().value;
    if (oldestKey) serverTtsCache.delete(oldestKey);
  }
  serverTtsCache.set(key, entry);
}

function splitTextForTts(text: string, maxChunkLen = 175): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChunkLen) return [normalized];

  const chunks: string[] = [];
  const words = normalized.split(' ');
  let current = '';

  for (const word of words) {
    if ((current ? `${current} ${word}` : word).length <= maxChunkLen) {
      current = current ? `${current} ${word}` : word;
    } else {
      if (current) chunks.push(current);
      if (word.length > maxChunkLen) {
        chunks.push(word.slice(0, maxChunkLen));
        current = '';
      } else {
        current = word;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 6);
}

function ensureWavBuffer(rawBuffer: Buffer, mimeType?: string): Buffer {
  if (rawBuffer.length >= 4 && rawBuffer.subarray(0, 4).toString('ascii') === 'RIFF') {
    return rawBuffer;
  }
  const rateMatch = mimeType?.match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + rawBuffer.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(rawBuffer.length, 40);
  return Buffer.concat([header, rawBuffer]);
}

app.get('/api/tts', async (req, res) => {
  const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';
  const mode =
    req.query.mode === 'word' || req.query.mode === 'example'
      ? req.query.mode
      : 'sentence';
  const styleHint =
    typeof req.query.style === 'string' && req.query.style.trim()
      ? req.query.style.trim().slice(0, 220)
      : 'Natural, warm, crystal-clear native Modern Standard Arabic pronunciation in pausal form without final case endings';

  const cleanText =
    mode === 'word'
      ? stripFinalIrabForSpeech(rawQuery).slice(0, 220)
      : sanitizeArabicForSpeech(rawQuery).slice(0, 900);

  if (!cleanText) {
    return res.status(400).json({ error: 'Arabic text is required for TTS.' });
  }

  const cacheKey = `${mode}::${cleanText}`;
  const cachedAudio = serverTtsCache.get(cacheKey);
  if (cachedAudio) {
    res.setHeader('Content-Type', cachedAudio.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cachedAudio.buffer);
  }

  // Prefer expressive neural Gemini TTS when quota is available; enter cooldown on 429 RESOURCE_EXHAUSTED
  const apiKey = getConfiguredApiKey();
  const canAttemptGeminiTts =
    Boolean(apiKey) && Date.now() >= geminiTtsCooldownUntil && cleanText.length <= 420;

  if (canAttemptGeminiTts && apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const ttsTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TTS_TIMEOUT')), mode === 'word' ? 4500 : 6000)
      );

      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanText,
                  speechMetadata: {
                    style: styleHint,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        }),
        ttsTimeout,
      ]);

      const inlineAudio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const base64Audio = inlineAudio?.data;
      if (base64Audio) {
        const rawBuffer = Buffer.from(base64Audio, 'base64');
        const wavBuffer = ensureWavBuffer(rawBuffer, inlineAudio?.mimeType);
        if (wavBuffer.length > 44) {
          setServerTtsCache(cacheKey, { buffer: wavBuffer, contentType: 'audio/wav' });
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          return res.send(wavBuffer);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isGeminiQuotaError(msg)) {
        const cooldownMs = extractQuotaCooldownMs(msg);
        geminiTtsCooldownUntil = Date.now() + cooldownMs;
        console.info(
          `[TTS Server] Gemini TTS daily quota reached; using Google TTS audio stream for ${Math.round(cooldownMs / 60000)}m.`
        );
      } else {
        console.info('[TTS Server] Gemini TTS unavailable, switching to Google TTS audio stream.');
      }
    }
  }

  try {
    const chunks = splitTextForTts(cleanText);
    const buffers: Buffer[] = [];

    for (const chunk of chunks) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=ar&client=tw-ob`;
      const upstream = await fetch(ttsUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      clearTimeout(timer);

      if (!upstream.ok) {
        throw new Error(`TTS upstream error: ${upstream.status}`);
      }

      const arrayBuf = await upstream.arrayBuffer();
      buffers.push(Buffer.from(arrayBuf));
    }

    const merged = Buffer.concat(buffers);
    if (merged.length === 0) {
      throw new Error('Empty TTS audio response.');
    }

    setServerTtsCache(cacheKey, { buffer: merged, contentType: 'audio/mpeg' });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(merged);
  } catch (err) {
    console.error(
      '[TTS Server] Upstream Google TTS failed:',
      err instanceof Error ? err.message : err
    );
    return res.status(502).json({
      error: 'Arabic TTS audio stream is currently unavailable.',
    });
  }
});

// AI-Generated Vocabulary Retention & Comprehension Exam
app.post('/api/exams/generate', async (req, res) => {
  const { level, focus, count, words } = req.body as {
    level?: string;
    focus?: string;
    count?: number;
    words?: Array<{
      id?: string;
      wordWithTashkeel?: string;
      englishMeaning?: string;
      partOfSpeech?: string;
      exampleAr?: string;
      exampleEn?: string;
    }>;
  };

  const targetLevel = normalizeProficiencyLevel(level);
  const questionCount = Math.max(3, Math.min(10, Number(count) || 5));
  const cleanWords = Array.isArray(words)
    ? words
        .filter((w) => w.wordWithTashkeel?.trim() && w.englishMeaning?.trim())
        .slice(0, 14)
    : [];

  const levelLabels: Record<ProficiencyLevel, { en: string; ar: string }> = {
    beginner: { en: 'Beginner', ar: 'المبتدئ' },
    intermediate: { en: 'Intermediate', ar: 'المتوسط' },
    advanced: { en: 'Advanced', ar: 'المتقدم' },
  };

  const buildFallbackExam = (notice?: string): GeneratedExam => {
    const fallbackPool =
      cleanWords.length > 0
        ? cleanWords
        : [
            {
              id: 'lex-qahwa',
              wordWithTashkeel: 'القَهْوَةُ',
              englishMeaning: 'the coffee',
              partOfSpeech: 'Noun',
              exampleAr: 'شَرِبْتُ القَهْوَةَ فِي الصَّبَاحِ البَاكِرِ.',
              exampleEn: 'I drank coffee early in the morning.',
            },
            {
              id: 'lex-hikma',
              wordWithTashkeel: 'الحِكْمَةُ',
              englishMeaning: 'wisdom',
              partOfSpeech: 'Noun',
              exampleAr: 'تَأْتِي الحِكْمَةُ مِنَ التَّجْرِبَةِ وَالتَّأَمُّلِ.',
              exampleEn: 'Wisdom comes from experience and reflection.',
            },
            {
              id: 'lex-kitab',
              wordWithTashkeel: 'الكِتَابُ',
              englishMeaning: 'the book',
              partOfSpeech: 'Noun',
              exampleAr: 'قَرَأْتُ الكِتَابَ الجَدِيدَ فِي المَكْتَبَةِ.',
              exampleEn: 'I read the new book in the library.',
            },
          ];

    const distractorMeanings = [
      'the morning journey',
      'quiet conversation',
      'deep reflection',
      'the ancient market',
      'warm hospitality',
      'knowledge and study',
    ];

    const questions = Array.from({ length: Math.min(questionCount, Math.max(3, fallbackPool.length)) }).map(
      (_, idx) => {
        const target = fallbackPool[idx % fallbackPool.length];
        const wordAr = applySmartPartialTashkeel(target.wordWithTashkeel || 'الكَلِمَةُ');
        const meaning = target.englishMeaning || 'meaning';
        const isFillBlank = idx % 2 === 1 && target.exampleAr;

        if (isFillBlank && target.exampleAr) {
          const strippedTarget = stripTashkeel(wordAr);
          const blankSentence = target.exampleAr
            .split(/\s+/)
            .map((tok) => (stripTashkeel(tok).includes(strippedTarget) ? '______' : tok))
            .join(' ');
          const otherWords = fallbackPool
            .filter((w) => w.wordWithTashkeel !== target.wordWithTashkeel)
            .map((w) => applySmartPartialTashkeel(w.wordWithTashkeel || ''));
          const padArabic = ['المَكْتَبَةُ', 'الصَّبَاحُ', 'التَّعَلُّمُ', 'الرِّحْلَةُ'];
          const distractors = [...new Set([...otherWords, ...padArabic])]
            .filter((w) => stripTashkeel(w) !== strippedTarget)
            .slice(0, 3);
          const rawOptions = [wordAr, ...distractors];
          const correctIndex = idx % rawOptions.length;
          const rotated = [...rawOptions];
          [rotated[0], rotated[correctIndex]] = [rotated[correctIndex], rotated[0]];

          return {
            id: `exam-q-${idx + 1}`,
            type: 'fill_blank' as const,
            targetCardId: target.id,
            targetWordAr: wordAr,
            promptAr: 'اختر الكلمة المناسبة لإكمال الجملة:',
            promptEn: 'Choose the word that best completes the Arabic sentence:',
            contextSentenceAr: applySmartPartialTashkeel(
              blankSentence.includes('______') ? blankSentence : `${target.exampleAr} (______ )`
            ),
            options: rotated,
            correctIndex,
            explanationEn: `"${wordAr}" means "${meaning}" and fits the sentence context.`,
            explanationAr: `الكلمة الصّحيحة هي «${wordAr}» ومعناها (${meaning}).`,
          };
        }

        const otherMeanings = fallbackPool
          .filter((w) => w.englishMeaning !== meaning)
          .map((w) => w.englishMeaning || '');
        const distractors = [...new Set([...otherMeanings, ...distractorMeanings])]
          .filter((m) => m && m.toLowerCase() !== meaning.toLowerCase())
          .slice(0, 3);
        const rawOptions = [meaning, ...distractors];
        const correctIndex = idx % rawOptions.length;
        const rotated = [...rawOptions];
        [rotated[0], rotated[correctIndex]] = [rotated[correctIndex], rotated[0]];

        return {
          id: `exam-q-${idx + 1}`,
          type: 'meaning' as const,
          targetCardId: target.id,
          targetWordAr: wordAr,
          promptAr: `ما المَعْنَى الصَّحِيحُ لِكَلِمَةِ «${wordAr}»؟`,
          promptEn: `What is the accurate meaning of "${wordAr}"?`,
          contextSentenceAr: target.exampleAr
            ? applySmartPartialTashkeel(target.exampleAr)
            : undefined,
          options: rotated,
          correctIndex,
          explanationEn: `"${wordAr}" (${target.partOfSpeech || 'Arabic vocabulary'}) translates to "${meaning}".`,
          explanationAr: `تُترجم كلمة «${wordAr}» إلى "${meaning}".`,
        };
      }
    );

    return {
      titleEn: `${levelLabels[targetLevel].en} Vocabulary Exam`,
      titleAr: `امتحانُ المفرداتِ — المستوى ${levelLabels[targetLevel].ar}`,
      level: targetLevel,
      questions,
      source: 'fallback',
      notice,
    };
  };

  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    return res.json(buildFallbackExam('Using offline exam generator from your saved deck.'));
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const wordsSummary =
      cleanWords.length > 0
        ? cleanWords
            .map(
              (w, i) =>
                `${i + 1}. "${w.wordWithTashkeel}" (${w.partOfSpeech || 'word'}) = "${w.englishMeaning}"${w.exampleAr ? ` | example: ${w.exampleAr}` : ''}`
            )
            .join('\n')
        : 'No custom saved cards yet; generate essential level-appropriate Modern Standard Arabic words.';

    const prompt = `Create a ${questionCount}-question Arabic vocabulary & contextual comprehension exam for a ${targetLevel} (${levelLabels[targetLevel].ar}) learner.
Focus mode: ${focus || 'saved_vocabulary'}

Learner's Saved Vocabulary Words:
${wordsSummary}

Requirements:
- Prioritize testing the learner's saved Arabic words listed above.
- Mix question types: "meaning" (identify the exact English meaning from context), "fill_blank" (complete an Arabic sentence with ______ using the right Arabic word from 4 choices), and "usage" (choose the best Arabic sentence or contextual nuance).
- Use Smart Partial Tashkeel (التشكيل الجزئي الذكي) on all Arabic prompts, sentences, and Arabic options.
- Always provide exactly 4 distinct options per question and accurate correctIndex (0..3).
- Provide concise bilingual feedback (explanationEn and explanationAr).`;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT_UPSTREAM')), 10000)
    );

    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          systemInstruction:
            'You are an Arabic assessment designer creating crisp, pedagogical, textbook-quality Modern Standard Arabic exams.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              titleEn: { type: Type.STRING },
              titleAr: { type: Type.STRING },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    targetWordAr: { type: Type.STRING },
                    promptAr: { type: Type.STRING },
                    promptEn: { type: Type.STRING },
                    contextSentenceAr: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    correctIndex: { type: Type.INTEGER },
                    explanationEn: { type: Type.STRING },
                    explanationAr: { type: Type.STRING },
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
        },
      }),
      timeoutPromise,
    ]);

    const raw = (response?.text ?? '').trim();
    const parsed = JSON.parse(raw) as {
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
    };

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      throw new Error('Invalid exam schema returned.');
    }

    const sanitizedQuestions = parsed.questions.slice(0, questionCount).map((q, idx) => {
      const normalizedTarget = normalizeArabicWord(q.targetWordAr || '');
      const matchedCard = cleanWords.find(
        (w) => normalizeArabicWord(w.wordWithTashkeel || '') === normalizedTarget
      );
      const qType: 'meaning' | 'fill_blank' | 'usage' =
        q.type === 'fill_blank' || q.type === 'usage' ? q.type : 'meaning';
      const opts = Array.isArray(q.options) && q.options.length >= 2 ? q.options.slice(0, 4) : ['Option A', 'Option B', 'Option C', 'Option D'];
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

    return res.json({
      titleEn: parsed.titleEn || `${levelLabels[targetLevel].en} Vocabulary Exam`,
      titleAr: applySmartPartialTashkeel(
        parsed.titleAr || `امتحانُ المفرداتِ — المستوى ${levelLabels[targetLevel].ar}`
      ),
      level: targetLevel,
      questions: sanitizedQuestions,
      source: 'gemini',
    } satisfies GeneratedExam);
  } catch (err) {
    console.warn(
      '[Exams API] Falling back to local exam generator:',
      err instanceof Error ? err.message : err
    );
    return res.json(buildFallbackExam('Generated using local vocabulary exam builder.'));
  }
});

// AI-Generated Real-Life Arabic Conversation Scenarios & Practice Sentences
app.post('/api/conversation/generate', async (req, res) => {
  const { level, scenarioId, customTopic, words } = req.body as {
    level?: string;
    scenarioId?: string;
    customTopic?: string;
    words?: Array<{
      wordWithTashkeel?: string;
      englishMeaning?: string;
    }>;
  };

  const targetLevel = normalizeProficiencyLevel(level);
  const cleanWords = Array.isArray(words)
    ? words
        .filter((w) => w.wordWithTashkeel?.trim() && w.englishMeaning?.trim())
        .slice(0, 8)
    : [];
  const chosenScenario = customTopic?.trim() || scenarioId?.trim() || 'cafe';

  const buildFallbackConversation = (notice?: string): GeneratedConversation => {
    const usedList = cleanWords.map((w) => applySmartPartialTashkeel(w.wordWithTashkeel || ''));
    const spotlightOne = usedList[0] || 'القَهْوَةُ';
    const spotlightTwo = usedList[1] || 'السَّعَادَةُ';
    const topicTitleMap: Record<string, { ar: string; en: string }> = {
      cafe: { ar: 'حِوَارٌ فِي المَقْهَى الهَادِئِ', en: 'At a Neighborhood Café' },
      market: { ar: 'فِي السُّوقِ التَّقْلِيدِيِّ', en: 'At the Local Market' },
      travel: { ar: 'فِي المَطَارِ وَالسَّفَرِ', en: 'Travel & Airport' },
      work: { ar: 'فِي بِيئَةِ العَمَلِ وَالدِّرَاسَةِ', en: 'Work & Study Discussion' },
      daily: { ar: 'مُحَادَثَةٌ يَوْمِيَّةٌ بِالفُصْحَى', en: 'Everyday Arabic Conversation' },
    };
    const meta = topicTitleMap[chosenScenario] || {
      ar: `مُحَادَثَةٌ حَوْلَ: ${chosenScenario}`,
      en: `Dialogue: ${chosenScenario}`,
    };

    const turns = [
      {
        id: 'turn-1',
        speakerAr: 'سَلْمَى',
        speakerEn: 'Salma',
        role: 'partner' as const,
        arabic: applySmartPartialTashkeel('السَّلَامُ عَلَيْكُمْ! أَهْلًا بِكَ، كَيْفَ يَوْمُكَ اليَوْمَ؟'),
        transliteration: 'as-salāmu ʿalaykum! ahlan bika, kayfa yawmuka al-yawm?',
        english: 'Peace be upon you! Welcome, how is your day going today?',
        usedWords: [],
      },
      {
        id: 'turn-2',
        speakerAr: 'أَنْتَ',
        speakerEn: 'You',
        role: 'learner' as const,
        arabic: applySmartPartialTashkeel(`وَعَلَيْكُمُ السَّلَامُ! يَوْمِي جَمِيلٌ، وَأَنَا أَتَعَلَّمُ كَلِمَاتٍ جَدِيدَةً مِثْلَ ${spotlightOne}.`),
        transliteration: 'wa-ʿalaykumu s-salām! yawmī jamīl, wa-anā ataʿallamu kalimātin jadīda.',
        english: `And upon you be peace! My day is great, and I am learning new words like ${spotlightOne}.`,
        usedWords: [spotlightOne],
      },
      {
        id: 'turn-3',
        speakerAr: 'سَلْمَى',
        speakerEn: 'Salma',
        role: 'partner' as const,
        arabic: applySmartPartialTashkeel(`رَائِعٌ جِدًّا! هَلْ تَسْتَخْدِمُ ${spotlightOne} فِي حَيَاتِكَ اليَوْمِيَّةِ؟`),
        transliteration: 'rāʾiʿ jiddan! hal tastakhdimu hādhihi l-kalima fī ḥayātika al-yawmiyya?',
        english: `Wonderful! Do you use "${spotlightOne}" in your daily life?`,
        usedWords: [spotlightOne],
      },
      {
        id: 'turn-4',
        speakerAr: 'أَنْتَ',
        speakerEn: 'You',
        role: 'learner' as const,
        arabic: applySmartPartialTashkeel(`نَعَمْ، بِالتَّأْكِيدِ! فَهِيَ تَجْلِبُ لِي ${spotlightTwo} وَالمَعْرِفَةَ.`),
        transliteration: 'naʿam, bi-t-taʾkīd! fa-hiya tajlibu lī al-maʿrifa.',
        english: `Yes, of course! It brings me ${spotlightTwo} and knowledge.`,
        usedWords: [spotlightTwo],
      },
      {
        id: 'turn-5',
        speakerAr: 'سَلْمَى',
        speakerEn: 'Salma',
        role: 'partner' as const,
        arabic: applySmartPartialTashkeel('نُطْقُكَ وَاضِحٌ وَجَمِيلٌ. اسْتَمِرَّ فِي القِرَاءَةِ وَالِاسْتِمَاعِ كُلَّ يَوْمٍ!'),
        transliteration: 'nuṭquka wāḍiḥun wa-jamīl. istamirra fī l-qirāʾati wa-l-istimāʿi kulla yawm!',
        english: 'Your pronunciation is clear and natural. Keep reading and listening every day!',
        usedWords: [],
      },
    ];

    const practiceSentences = (cleanWords.length > 0
      ? cleanWords.slice(0, 4)
      : [
          { wordWithTashkeel: 'القَهْوَةُ', englishMeaning: 'the coffee' },
          { wordWithTashkeel: 'الحِكْمَةُ', englishMeaning: 'wisdom' },
          { wordWithTashkeel: 'السَّعَادَةُ', englishMeaning: 'happiness' },
        ]
    ).map((w, idx) => {
      const wAr = applySmartPartialTashkeel(w.wordWithTashkeel || '');
      return {
        id: `prac-${idx + 1}`,
        arabic: applySmartPartialTashkeel(`أُحِبُّ اسْتِخْدَامَ كَلِمَةِ ${wAr} فِي مُحَادَثَاتِي اليَوْمِيَّةِ.`),
        english: `I enjoy using the word "${wAr}" (${w.englishMeaning || ''}) in my daily conversations.`,
        focusWordAr: wAr,
        tipEn: `Practice saying "${wAr}" smoothly inside a full Modern Standard Arabic sentence.`,
      };
    });

    return {
      scenarioId: chosenScenario,
      titleAr: meta.ar,
      titleEn: meta.en,
      settingAr: 'مَوْقِفٌ تَوَاصُلِيٌّ وَاقِعِيٌّ لِلتَّدَرُّبِ عَلَى النُّطْقِ وَالمُفْرَدَاتِ الجَدِيدَةِ.',
      settingEn: 'A practical everyday Modern Standard Arabic conversation featuring your saved vocabulary.',
      level: targetLevel,
      targetWords: usedList.length > 0 ? usedList : ['القَهْوَةُ', 'السَّعَادَةُ'],
      turns,
      practiceSentences,
      source: 'fallback',
      notice,
    };
  };

  const apiKey = getConfiguredApiKey();
  if (!apiKey) {
    return res.json(
      buildFallbackConversation('Built with local conversation templates. Configure GEMINI_API_KEY for custom AI dialogues.')
    );
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const wordsInstruction =
      cleanWords.length > 0
        ? cleanWords.map((w) => `- ${w.wordWithTashkeel} (${w.englishMeaning})`).join('\n')
        : '- Use practical, natural vocabulary suited to the learner level.';

    const prompt = `Generate a realistic Modern Standard Arabic dialogue scenario and practice sentences for a ${targetLevel} learner.
Scenario / Topic: "${chosenScenario}"
${getLevelExampleInstruction(targetLevel)}

Naturally weave as many of these saved learner words as fit naturally into the dialogue & practice sentences:
${wordsInstruction}

Requirements:
- Produce 6 natural dialogue turns alternating between a conversational partner ("partner") and the learner ("learner").
- Include Arabic text with Smart Partial Tashkeel (التشكيل الجزئي الذكي), clean transliteration, natural English translation, and list which target words appeared in each turn (usedWords).
- Also produce 4 standalone real-life practice sentences featuring the learner's vocabulary with a brief tipEn for speaking practice.`;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT_UPSTREAM')), 10000)
    );

    const response = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          systemInstruction:
            'You are a native Modern Standard Arabic conversation coach creating authentic, expressive dialogues with Smart Partial Tashkeel.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              titleAr: { type: Type.STRING },
              titleEn: { type: Type.STRING },
              settingAr: { type: Type.STRING },
              settingEn: { type: Type.STRING },
              targetWords: { type: Type.ARRAY, items: { type: Type.STRING } },
              turns: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speakerAr: { type: Type.STRING },
                    speakerEn: { type: Type.STRING },
                    role: { type: Type.STRING },
                    arabic: { type: Type.STRING },
                    transliteration: { type: Type.STRING },
                    english: { type: Type.STRING },
                    usedWords: { type: Type.ARRAY, items: { type: Type.STRING } },
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
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    arabic: { type: Type.STRING },
                    english: { type: Type.STRING },
                    focusWordAr: { type: Type.STRING },
                    tipEn: { type: Type.STRING },
                  },
                  required: ['arabic', 'english', 'focusWordAr', 'tipEn'],
                },
              },
            },
            required: [
              'titleAr',
              'titleEn',
              'settingAr',
              'settingEn',
              'targetWords',
              'turns',
              'practiceSentences',
            ],
          },
        },
      }),
      timeoutPromise,
    ]);

    const parsed = JSON.parse((response?.text ?? '').trim()) as {
      titleAr?: string;
      titleEn?: string;
      settingAr?: string;
      settingEn?: string;
      targetWords?: string[];
      turns?: Array<{
        speakerAr: string;
        speakerEn: string;
        role: string;
        arabic: string;
        transliteration: string;
        english: string;
        usedWords?: string[];
      }>;
      practiceSentences?: Array<{
        arabic: string;
        english: string;
        focusWordAr: string;
        tipEn: string;
      }>;
    };

    if (!Array.isArray(parsed.turns) || parsed.turns.length === 0) {
      throw new Error('Empty dialogue returned.');
    }

    return res.json({
      scenarioId: chosenScenario,
      titleAr: applySmartPartialTashkeel(parsed.titleAr || chosenScenario),
      titleEn: parsed.titleEn || 'Arabic Conversation Practice',
      settingAr: applySmartPartialTashkeel(parsed.settingAr || ''),
      settingEn: parsed.settingEn || 'Real-life Arabic dialogue practice.',
      level: targetLevel,
      targetWords: (parsed.targetWords || []).map((w) => applySmartPartialTashkeel(w)),
      turns: parsed.turns.slice(0, 8).map((t, idx) => ({
        id: `ai-turn-${idx + 1}`,
        speakerAr: t.speakerAr || (t.role === 'learner' ? 'أنت' : 'الشريك'),
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
        tipEn: s.tipEn || '',
      })),
      source: 'gemini',
    } satisfies GeneratedConversation);
  } catch (err) {
    console.warn(
      '[Conversation API] Falling back to local dialogue generator:',
      err instanceof Error ? err.message : err
    );
    return res.json(buildFallbackConversation('Generated using built-in conversation scenario.'));
  }
});

async function startServer() {
  const PORT = 3000;
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Qalam server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
