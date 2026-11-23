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
  parsePastedTranscriptSegments,
  stripFinalIrabForSpeech,
} from './arabic';
import {
  fetchGeminiGenerateContent,
  getClientGeminiApiKey,
} from './geminiAuth';

export { getClientGeminiApiKey };

const GEMINI_API_COOLDOWN_KEY = 'qalam_gemini_text_cooldown_until';
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

let memoryCooldownUntil = 0;

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

function setCooldown(durationMs: number): void {
  const until = Date.now() + durationMs;
  memoryCooldownUntil = until;
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(GEMINI_API_COOLDOWN_KEY, String(until));
    }
  } catch {
    // Ignore storage access errors
  }
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
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
  return trimmed;
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
    const { response, errorBody } = await fetchGeminiGenerateContent({
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
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      },
    });

    if (!response.ok) {
      console.error(
        `[Gemini Client] ${GEMINI_MODEL} returned HTTP ${response.status} ${response.statusText}:`,
        errorBody
      );
      if (response.status === 429 || /RESOURCE_EXHAUSTED|quota|rate[- ]?limit/i.test(errorBody)) {
        setCooldown(30 * 60 * 1000);
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

  const fallback = lookupFallbackWord(trimmedWord, trimmedContext, undefined, targetLevel);

  const apiKey = getClientGeminiApiKey();
  if (!apiKey || Date.now() < getCooldownUntil()) {
    return fallback;
  }

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

  const parsed = await generateGeminiJson<Omit<WordAnalysis, 'word' | 'source'>>({
    prompt,
    systemInstruction:
      'You are a native-speaking Arabic linguist and curriculum designer. Strictly match example sentence complexity, length, and vocabulary to the requested learner level (beginner, intermediate, or advanced), provide complete internal vocalization without final case endings in vocalizedWord, and return Smart Partial Tashkeel in display fields.',
    timeoutMs: 4000,
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
  });

  if (!parsed || !Array.isArray(parsed.examples) || parsed.examples.length < 1 || !parsed.englishMeaning) {
    return fallback;
  }

  const resolvedWordType = inferArabicWordType(parsed.wordType || parsed.partOfSpeech);
  const resolvedPartOfSpeech = parsed.partOfSpeech || fallback.partOfSpeech || 'Word';

  return {
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
    transliteration: parsed.transliteration || fallback.transliteration || '',
    englishMeaning: parsed.englishMeaning,
    examples: parsed.examples.slice(0, 3).map((ex) => ({
      arabic: applySmartPartialTashkeel(ex.arabic),
      english: ex.english,
      contextLabel: ex.contextLabel,
    })),
    level: targetLevel,
    source: 'gemini',
  };
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
  const fallbackPayload: LessonQuizResponse = {
    questions: generateFallbackLessonQuiz(params.lessonId, params.textAr, cleanTitle),
    source: 'fallback',
    notice: 'Built-in comprehension questions for this passage.',
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

  return {
    questions: sanitized,
    source: 'gemini',
  };
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
  const apiKey = getClientGeminiApiKey();
  if (!apiKey || Date.now() < getCooldownUntil()) {
    return params.fallbackBuilder();
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

Learner's Saved Vocabulary Words:
${wordsSummary}

Requirements:
- Prioritize testing the learner's saved Arabic words listed above.
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

  return {
    titleEn: parsed.titleEn || `${levelLabels[params.level].en} Vocabulary Exam`,
    titleAr: applySmartPartialTashkeel(
      parsed.titleAr || `امتحانُ المفرداتِ — المستوى ${levelLabels[params.level].ar}`
    ),
    level: params.level,
    questions: sanitizedQuestions,
    source: 'gemini',
  };
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
  const apiKey = getClientGeminiApiKey();
  if (!apiKey || Date.now() < getCooldownUntil()) {
    return params.fallbackBuilder();
  }

  const chosenScenario = params.customTopic?.trim() || params.scenarioId.trim() || 'cafe';
  const cleanWords = params.words.slice(0, 8);
  const wordsInstruction =
    cleanWords.length > 0
      ? cleanWords.map((w) => `- ${w.wordWithTashkeel} (${w.englishMeaning})`).join('\n')
      : '- Use practical, natural vocabulary suited to the learner level.';

  const prompt = `Generate a realistic Modern Standard Arabic dialogue scenario and practice sentences for a ${params.level} learner.
Scenario / Topic: "${chosenScenario}"
${getLevelExampleInstruction(params.level)}

Naturally weave as many of these saved learner words as fit naturally into the dialogue & practice sentences:
${wordsInstruction}

Requirements:
- Produce 6 natural dialogue turns alternating between a conversational partner ("partner") and the learner ("learner").
- Include Arabic text with Smart Partial Tashkeel (التشكيل الجزئي الذكي), clean transliteration, natural English translation, and list which target words appeared in each turn (usedWords).
- Also produce 4 standalone real-life practice sentences featuring the learner's vocabulary with a brief tipEn for speaking practice.`;

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

  return {
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
}
