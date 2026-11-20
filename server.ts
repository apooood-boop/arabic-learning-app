import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { findExactLexiconMatch, lookupFallbackWord } from './src/data/fallbackLexicon.ts';
import { generateFallbackLessonQuiz } from './src/data/lessonQuizzes.ts';
import type {
  LessonQuizQuestion,
  LessonQuizResponse,
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
  const cacheKey = `v2::${normalizeArabicWord(trimmedWord)}::${trimmedContext.slice(0, 80)}`;

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
      'Using built-in Arabic lexicon mode for instant translation.'
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

    const prompt = `Analyze this Arabic word for a ${level || 'intermediate'} learner.
Word: "${trimmedWord}"
Context sentence: "${trimmedContext}"

Return strict JSON with:
- wordWithTashkeel: the Arabic word formatted with Smart Partial Tashkeel (التشكيل الجزئي الذكي: vowelize final letter / حركة الإعراب, essential الشدة, and critical Sukun).
- partOfSpeech: concise English POS (e.g. "Noun", "Verb (Present)", "Adjective", "Adverb", "Preposition").
- wordType: ONE concise Arabic grammatical category chosen strictly from: "اسم", "فعل", "حرف", "ظرف", "صفة", or "ضمير".
- root: ONLY the original 3 or 4 root Arabic letters separated by " - " (for example "ك - ت - ب" or "ق - و - م"). NEVER include derived words, meanings, or extra text. Return "" if it is an uninflected particle/pronoun with no triliteral root.
- transliteration: clean Latin phonetic transliteration.
- englishMeaning: accurate English meaning in the given context (if polysemous, mention primary + secondary sense briefly).
- examples: 2 (or 3 if strongly polysemous) HYPER-REALISTIC, natural everyday Arabic sentences actually used by native speakers in real life (conversations, cafés, work, travel, family, news — NEVER artificial textbook filler).
  * POLYSEMY RULE: If the word has multiple common meanings across contexts (e.g., عَيْن eye vs. water spring, فَصْل season vs. classroom, بَيْت house vs. verse), each example MUST showcase a distinct real-world meaning!
  * Strictly use Smart Partial Tashkeel (التشكيل الجزئي الذكي: vowelize final endings/tanwin, Shaddah, and critical Sukun; leave middle letters clean).
  * Include contextLabel (e.g. "Daily Conversation", "Alternate Meaning") and accurate English translation for each.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        wordWithTashkeel: { type: Type.STRING },
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
            'You are a native-speaking Arabic linguist and lexicographer. Always provide accurate Arabic wordType, pure dash-separated root letters (never derived examples), and hyper-realistic everyday native Arabic sentences strictly formatted with Smart Partial Tashkeel.',
          responseMimeType: 'application/json',
          responseSchema,
        },
      });

    // Race Gemini with a snappy 3s timeout so the UI stays fast and responsive
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT_UPSTREAM')), 3000)
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

    const result: WordAnalysis = {
      word: trimmedWord,
      wordWithTashkeel: applySmartPartialTashkeel(parsed.wordWithTashkeel || trimmedWord),
      partOfSpeech: parsed.partOfSpeech || 'Word',
      wordType: inferArabicWordType(parsed.wordType || parsed.partOfSpeech),
      root: formatMinimalArabicRoot(parsed.root),
      transliteration: parsed.transliteration || '',
      englishMeaning: parsed.englishMeaning,
      examples: parsed.examples.slice(0, 3).map((ex) => ({
        arabic: applySmartPartialTashkeel(ex.arabic),
        english: ex.english,
        contextLabel: ex.contextLabel,
      })),
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
      const fallback = lookupFallbackWord(trimmedWord, trimmedContext, friendlyNotice);
      return res.json(fallback);
    }

    return res.status(401).json({
      error: friendlyNotice,
      fallback: lookupFallbackWord(trimmedWord, trimmedContext, friendlyNotice),
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

const serverTtsCache = new Map<string, Buffer>();
const MAX_TTS_CACHE_ENTRIES = 200;

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

app.get('/api/tts', async (req, res) => {
  const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';
  const cleanText = stripTashkeel(rawQuery).replace(/\s+/g, ' ').trim().slice(0, 900);

  if (!cleanText) {
    return res.status(400).json({ error: 'Arabic text is required for TTS.' });
  }

  const cachedAudio = serverTtsCache.get(cleanText);
  if (cachedAudio) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cachedAudio);
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

    if (serverTtsCache.size >= MAX_TTS_CACHE_ENTRIES) {
      const oldestKey = serverTtsCache.keys().next().value;
      if (oldestKey) serverTtsCache.delete(oldestKey);
    }
    serverTtsCache.set(cleanText, merged);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(merged);
  } catch {
    return res.status(502).json({
      error: 'Arabic TTS audio stream is currently unavailable.',
    });
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
