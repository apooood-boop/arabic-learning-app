import type { ArabicFontStyle, ProficiencyLevel, TranscriptSegment } from '../types/arabic.ts';
import {
  fetchGeminiGenerateContent,
  getClientGeminiApiKey as getSharedClientGeminiApiKey,
} from './geminiAuth.ts';

const TASHKEEL_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC_CHAR_REGEX = /[\u0600-\u06FF]/;
const PUNCTUATION_EDGE_REGEX = /^[«»"'()[\]{}.,،؛:؟!\-—]+|[«»"'()[\]{}.,،؛:؟!\-—]+$/g;

export function stripTashkeel(text: string): string {
  return text.replace(TASHKEEL_REGEX, '');
}

const COMBINING_MARK_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED]/;
const ARABIC_LETTER_REGEX = /[\u0621-\u064A]/;

const SUN_LETTERS = new Set([
  'ت', 'ث', 'د', 'ذ', 'ر', 'ز', 'س', 'ش', 'ص', 'ض', 'ط', 'ظ', 'ل', 'ن',
]);

const PARTIAL_PARTICLE_MAP: Record<string, string> = {
  'من': 'مِنْ',
  'عن': 'عَنْ',
  'على': 'عَلَى',
  'الى': 'إِلَى',
  'إلى': 'إِلَى',
  'في': 'في',
  'مع': 'مَعَ',
  'بين': 'بيْنَ',
  'ثم': 'ثُمَّ',
  'او': 'أَوْ',
  'أو': 'أَوْ',
  'لكن': 'لكِنْ',
  'قد': 'قَدْ',
  'لم': 'لَمْ',
  'لن': 'لَنْ',
  'ان': 'إِنَّ',
  'إن': 'إِنَّ',
  'أن': 'أَنَّ',
  'هذا': 'هَذَا',
  'هذه': 'هَذِهِ',
  'ذلك': 'ذلِكَ',
  'تلك': 'تِلْكَ',
  'الذي': 'الّذي',
  'التي': 'الّتي',
  'الذين': 'الّذينَ',
  'هو': 'هُوَ',
  'هي': 'هِيَ',
  'هم': 'هُمْ',
  'نحن': 'نَحْنُ',
  'انا': 'أَنَا',
  'أنا': 'أَنَا',
  'انت': 'أَنْتَ',
  'أنت': 'أَنْتَ',
  'كل': 'كُلُّ',
  'بعض': 'بَعْضُ',
  'غير': 'غيْرُ',
  'كان': 'كانَ',
  'كانت': 'كانَتْ',
  'يكون': 'يكونُ',
  'تكون': 'تكونُ',
  'ليس': 'ليْسَ',
  'هنا': 'هُنا',
  'هناك': 'هُناكَ',
  'اليوم': 'اليوْمَ',
  'الان': 'الآنَ',
  'الآن': 'الآنَ',
  'جدا': 'جِدًّا',
  'ايضا': 'أيْضًا',
  'أيضا': 'أيْضًا',
  'دائما': 'دائِمًا',
  'احيانا': 'أحْيانًا',
  'أحيانا': 'أحْيانًا',
  'صباحا': 'صباحًا',
  'مساء': 'مساءً',
  'شكرا': 'شُكْرًا',
  'اهلا': 'أهْلًا',
  'أهلا': 'أهْلًا',
  'كثيرا': 'كثيرًا',
  'قليلا': 'قليلًا',
  'مبكرا': 'مُبكِّرًا',
  'سريعا': 'سريعًا',
  'معا': 'مَعًا',
  'يوم': 'يوْم',
  'بيت': 'بيْت',
  'شيء': 'شيْء',
  'كيف': 'كيْفَ',
  'ليل': 'ليْل',
  'صيف': 'صيْف',
  'لون': 'لوْن',
  'صوت': 'صوْت',
  'خير': 'خيْر',
};

const PREPOSITION_SET = new Set([
  'في', 'من', 'الى', 'إلى', 'على', 'عن', 'مع', 'بين', 'نحو', 'امام', 'أمام', 'خلف', 'تحت', 'فوق',
]);

function normalizeBareKey(word: string): string {
  return word.replace(TASHKEEL_REGEX, '').trim();
}

function addSunAndNisbaMarks(word: string): string {
  let result = word;

  // Insert Shaddah on sun letter after definite article ال (or بـ/لـ/كـ/وـ/فـ + ال)
  const prefixMatch = result.match(/^([وفبكل]?ال)([\u0621-\u064A])(.*)$/);
  if (prefixMatch && SUN_LETTERS.has(prefixMatch[2])) {
    result = `${prefixMatch[1]}${prefixMatch[2]}\u0651${prefixMatch[3]}`;
  } else {
    // Handle لل + sun letter (e.g. للشمس -> للشّمس)
    const liMatch = result.match(/^(لل)([\u0621-\u064A])(.*)$/);
    if (liMatch && SUN_LETTERS.has(liMatch[2]) && liMatch[2] !== 'ل') {
      result = `${liMatch[1]}${liMatch[2]}\u0651${liMatch[3]}`;
    }
  }

  // Nisba feminine ending ية -> يّة
  if (result.endsWith('ية') && !result.endsWith('يّة')) {
    result = `${result.slice(0, -2)}ي\u0651ة`;
  }

  return result;
}

function hasAnyTashkeel(word: string): boolean {
  return COMBINING_MARK_REGEX.test(word);
}

function vowelizeUnmarkedWord(
  rawWord: string,
  prevBare: string | null,
  afterVerb: boolean
): { formatted: string; isVerb: boolean } {
  const bare = normalizeBareKey(rawWord);
  if (!bare) return { formatted: rawWord, isVerb: false };

  // Direct particle/common-word table
  const mapped = PARTIAL_PARTICLE_MAP[bare];
  if (mapped) {
    return { formatted: mapped, isVerb: bare === 'كان' || bare === 'كانت' || bare === 'يكون' || bare === 'تكون' || bare === 'ليس' };
  }

  let formatted = addSunAndNisbaMarks(bare);
  const lastChar = bare[bare.length - 1];
  const canTakeFinalVowel = !['ا', 'ى', 'و', 'ي'].includes(lastChar);
  const isDefinite = /^([وفبكل]?ال|لل)/.test(bare);
  const isLikelyPresentVerb =
    !isDefinite &&
    bare.length >= 4 &&
    /^[يتن]/.test(bare) &&
    !bare.endsWith('ة') &&
    !bare.endsWith('ات') &&
    !bare.endsWith('ون') &&
    !bare.endsWith('ين') &&
    !['يوم', 'بيت', 'تحت', 'نحو', 'بين', 'تلك'].includes(bare);

  if (prevBare && PREPOSITION_SET.has(prevBare)) {
    if (canTakeFinalVowel) {
      formatted += isDefinite || bare.endsWith('ة') ? '\u0650' : '\u064D';
    }
    return { formatted, isVerb: false };
  }

  if (isLikelyPresentVerb && canTakeFinalVowel) {
    formatted += '\u064F';
    return { formatted, isVerb: true };
  }

  if (canTakeFinalVowel && isDefinite) {
    formatted += afterVerb ? '\u064E' : '\u064F';
    return { formatted, isVerb: false };
  }

  if (bare.endsWith('ة')) {
    formatted += afterVerb ? '\u064B' : '\u064C';
    return { formatted, isVerb: false };
  }

  return { formatted, isVerb: false };
}

function toSmartPartialTashkeelWord(word: string): string {
  // Parse word into array of { char, marks } units
  const units: Array<{ char: string; marks: string; isArabicLetter: boolean }> = [];
  for (const ch of word) {
    if (COMBINING_MARK_REGEX.test(ch) && units.length > 0) {
      units[units.length - 1].marks += ch;
    } else {
      units.push({
        char: ch,
        marks: '',
        isArabicLetter: ARABIC_LETTER_REGEX.test(ch),
      });
    }
  }

  const letterIndices: number[] = [];
  units.forEach((u, idx) => {
    if (u.isArabicLetter) letterIndices.push(idx);
  });

  if (letterIndices.length === 0) return word;

  // Keep concise 1-2 letter particles (e.g. مِنْ، عَنْ، لَمْ، قَدْ) clear
  if (letterIndices.length <= 2) {
    return word;
  }

  const lastLetterIdx = letterIndices[letterIndices.length - 1];
  const prevLetterIdx = letterIndices[letterIndices.length - 2];
  const lastChar = units[lastLetterIdx].char;
  const isTrailingTanwinSeat =
    (lastChar === '\u0627' || lastChar === '\u0649') &&
    units[prevLetterIdx].marks.includes('\u064B');

  return units
    .map((unit, idx) => {
      if (!unit.isArabicLetter || !unit.marks) {
        return unit.char + unit.marks;
      }

      // 1. Always keep full harakah / tanwin / shaddah / sukun on the final letter (حرف الإعراب)
      if (idx === lastLetterIdx) {
        return unit.char + unit.marks;
      }

      // 2. Keep tanwin fath (ً) + shaddah on the letter immediately preceding trailing alif/alif maksura
      if (isTrailingTanwinSeat && idx === prevLetterIdx) {
        const kept = [...unit.marks].filter(
          (m) => m === '\u064B' || m === '\u0651'
        );
        return unit.char + kept.join('');
      }

      // 3. Internal letters: keep only Shaddah (ّ), Dagger Alef (ٰ), and Sukun (ْ) on و/ي diphthongs
      const keptInternal = [...unit.marks].filter((m) => {
        if (m === '\u0651' || m === '\u0670') return true;
        if (m === '\u0652' && (unit.char === '\u0648' || unit.char === '\u064A')) {
          return true;
        }
        return false;
      });

      return unit.char + keptInternal.join('');
    })
    .join('');
}

/**
 * Applies Smart Partial Tashkeel (التشكيل الجزئي الذكي):
 * - For already-vowelized text: preserves final case/grammatical vowelization (حركة الإعراب والتنوين),
 *   essential Shaddah (الشدة), diphthong Sukun (السكون), and clean long vowels while stripping cluttered internal marks.
 * - For unvowelized Arabic text: automatically applies sun-letter Shaddah, particle/preposition vowelization,
 *   prepositional i'rab endings, and essential partial markings.
 */
export function applySmartPartialTashkeel(text: string): string {
  if (!text) return text;

  let prevBare: string | null = null;
  let verbSeenInClause = false;
  let subjectSeenAfterVerb = false;

  return text.replace(/([\u0600-\u06FF]+)|([.؟!؛\n]+)/g, (match, wordSeg, punctSeg) => {
    if (punctSeg) {
      prevBare = null;
      verbSeenInClause = false;
      subjectSeenAfterVerb = false;
      return punctSeg;
    }

    if (!wordSeg) return match;

    const bare = normalizeBareKey(wordSeg);

    if (hasAnyTashkeel(wordSeg)) {
      const cleaned = toSmartPartialTashkeelWord(wordSeg);
      prevBare = bare;
      return cleaned;
    }

    const afterVerbForObject = verbSeenInClause && subjectSeenAfterVerb;
    const { formatted, isVerb } = vowelizeUnmarkedWord(wordSeg, prevBare, afterVerbForObject);

    if (isVerb) {
      verbSeenInClause = true;
      subjectSeenAfterVerb = false;
    } else if (verbSeenInClause && !PREPOSITION_SET.has(bare)) {
      subjectSeenAfterVerb = true;
    }

    if (PREPOSITION_SET.has(bare)) {
      verbSeenInClause = false;
      subjectSeenAfterVerb = false;
    }

    prevBare = bare;
    return formatted;
  });
}

export function normalizeArabicWord(word: string): string {
  return stripTashkeel(word)
    .replace(PUNCTUATION_EDGE_REGEX, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .trim();
}

export function cleanWordEdgePunctuation(token: string): {
  leading: string;
  core: string;
  trailing: string;
  isArabicWord: boolean;
} {
  const leadMatch = token.match(/^[«»"'()[\]{}.,،؛:؟!\-—]+/);
  const leading = leadMatch ? leadMatch[0] : '';
  const withoutLead = token.slice(leading.length);

  const trailMatch = withoutLead.match(/[«»"'()[\]{}.,،؛:؟!\-—]+$/);
  const trailing = trailMatch ? trailMatch[0] : '';
  const core = trailing ? withoutLead.slice(0, -trailing.length) : withoutLead;

  return {
    leading,
    core,
    trailing,
    isArabicWord: core.length > 0 && ARABIC_CHAR_REGEX.test(core),
  };
}

export interface TextToken {
  id: string;
  raw: string;
  leading: string;
  core: string;
  trailing: string;
  isArabicWord: boolean;
  isWhitespace: boolean;
}

export function tokenizeArabicParagraph(paragraph: string, pIndex: number): TextToken[] {
  const parts = paragraph.split(/(\s+)/);
  return parts.map((part, idx) => {
    if (/^\s+$/.test(part)) {
      return {
        id: `p${pIndex}-w${idx}`,
        raw: part,
        leading: '',
        core: '',
        trailing: '',
        isArabicWord: false,
        isWhitespace: true,
      };
    }
    const parsed = cleanWordEdgePunctuation(part);
    return {
      id: `p${pIndex}-w${idx}`,
      raw: part,
      ...parsed,
      isWhitespace: false,
    };
  });
}

export function countArabicWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => cleanWordEdgePunctuation(token).isArabicWord).length;
}

export function extractYouTubeVideoId(url?: string): string | null {
  if (!url || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    let videoId = '';
    if (parsed.hostname.includes('youtu.be')) {
      videoId = parsed.pathname.slice(1).split('/')[0];
    } else if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.replace('/embed/', '').split('/')[0];
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.replace('/shorts/', '').split('/')[0];
      } else {
        videoId = parsed.searchParams.get('v') ?? '';
      }
    }
    return videoId || null;
  } catch {
    return null;
  }
}

export function extractYouTubeEmbedUrl(url?: string): string | null {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0`;
}

export function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatMinimalArabicRoot(rawRoot?: string): string {
  if (!rawRoot) return '';
  let cleaned = stripTashkeel(rawRoot).trim();
  if (!cleaned || cleaned === '—' || cleaned === '-' || /^none$/i.test(cleaned) || cleaned.includes('لا يوجد')) {
    return '';
  }

  // Remove labels like "الجذر:", "جذر:", "Root:" (keep what comes after) and parenthetical notes
  cleaned = cleaned
    .replace(/^(?:الجذر|جذر|root)\s*[:：\-]?\s*/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .trim();

  const dashTokens = cleaned
    .split(/[-–—/،,|]+|\s+/)
    .map((part) => part.replace(/[^\u0621-\u064A]/g, ''))
    .filter((part) => part.length > 0);

  let letters: string[] = [];
  if (dashTokens.length >= 2 && dashTokens.every((t) => t.length === 1)) {
    letters = dashTokens.slice(0, 4);
  } else if (dashTokens.length >= 1) {
    const firstWord = dashTokens[0];
    if (firstWord.length >= 2 && firstWord.length <= 4) {
      letters = [...firstWord];
    } else if (dashTokens.length >= 3) {
      letters = dashTokens.slice(0, 4).map((t) => t[0]).filter(Boolean);
    }
  }

  if (letters.length < 2 || letters.length > 4) return '';
  return letters.join(' - ');
}

export function inferArabicWordType(wordTypeOrPos?: string): string {
  const raw = (wordTypeOrPos || '').trim();
  if (!raw) return 'اسم';

  const normalizedAr = stripTashkeel(raw);
  if (/^(فعل|اسم|حرف|ظرف|صفة|ضمير)$/.test(normalizedAr)) {
    return normalizedAr;
  }
  if (normalizedAr.includes('فعل')) return 'فعل';
  if (normalizedAr.includes('حرف') || normalizedAr.includes('أداة')) return 'حرف';
  if (normalizedAr.includes('ظرف')) return 'ظرف';
  if (normalizedAr.includes('صفة') || normalizedAr.includes('نعت')) return 'صفة';
  if (normalizedAr.includes('ضمير')) return 'ضمير';
  if (normalizedAr.includes('اسم') || normalizedAr.includes('مصدر')) return 'اسم';

  const lower = raw.toLowerCase();
  if (lower.includes('verb')) return 'فعل';
  if (
    lower.includes('preposition') ||
    lower.includes('conjunction') ||
    lower.includes('particle') ||
    lower.includes('interjection')
  ) {
    return 'حرف';
  }
  if (lower.includes('adverb')) return 'ظرف';
  if (lower.includes('adjective')) return 'صفة';
  if (lower.includes('pronoun')) return 'ضمير';
  return 'اسم';
}

function parseTimestampToken(token: string): number | null {
  const match = token.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  if (match[3] !== undefined) {
    const h = Number(match[1]);
    const m = Number(match[2]);
    const s = Number(match[3]);
    return h * 3600 + m * 60 + s;
  }
  const m = Number(match[1]);
  const s = Number(match[2]);
  return m * 60 + s;
}

export function parsePastedTranscriptSegments(
  rawText: string,
  fallbackDurationSeconds = 240
): TranscriptSegment[] {
  const lines = rawText.replace(/\r/g, '').split('\n');
  const timedCues: Array<{ startSec: number; text: string }> = [];

  let pendingSec: number | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Standalone YouTube transcript timestamp line e.g. "0:14" or "1:02:05"
    const standaloneTime = parseTimestampToken(trimmed.replace(/[\[\]()]/g, ''));
    if (standaloneTime !== null) {
      pendingSec = standaloneTime;
      continue;
    }

    // Inline timestamp + text e.g. "0:14 نص عربي" or "[01:20] - نص عربي"
    const inlineMatch = trimmed.match(/^[\[\(]?(\d{1,2}:\d{2}(?::\d{2})?)[\]\)]?\s*(?:[-–|]\s*)?(.+)$/);
    if (inlineMatch) {
      const sec = parseTimestampToken(inlineMatch[1]);
      if (sec !== null && inlineMatch[2].trim()) {
        timedCues.push({ startSec: sec, text: inlineMatch[2].trim() });
        pendingSec = null;
        continue;
      }
    }

    if (pendingSec !== null) {
      timedCues.push({ startSec: pendingSec, text: trimmed });
      pendingSec = null;
    } else if (timedCues.length > 0) {
      timedCues[timedCues.length - 1].text += ` ${trimmed}`;
    }
  }

  // If user pasted YouTube timestamped transcript (>= 2 timed cues), preserve or cleanly group cues
  if (timedCues.length >= 2) {
    const totalDur = Math.max(
      fallbackDurationSeconds || 0,
      timedCues[timedCues.length - 1].startSec + 8
    );

    // If <= 60 cues or cues are spaced >= 4s apart on average, keep 1:1 timestamps intact
    if (timedCues.length <= 60) {
      return timedCues.map((cue, idx) => {
        const nextStart = timedCues[idx + 1] ? timedCues[idx + 1].startSec : totalDur;
        return {
          id: `seg-${idx + 1}`,
          startSec: Number(cue.startSec.toFixed(1)),
          endSec: Number(Math.max(cue.startSec + 1.5, nextStart).toFixed(1)),
          textAr: applySmartPartialTashkeel(cue.text.replace(/\s+/g, ' ').trim()),
        };
      });
    }

    const grouped: TranscriptSegment[] = [];
    let chunkTexts: string[] = [];
    let chunkStart = timedCues[0].startSec;
    let chunkWords = 0;

    for (let i = 0; i < timedCues.length; i++) {
      const cue = timedCues[i];
      const nextCue = timedCues[i + 1];
      chunkTexts.push(cue.text);
      chunkWords += cue.text.split(/\s+/).filter(Boolean).length;

      const nextStart = nextCue ? nextCue.startSec : totalDur;
      const elapsed = nextStart - chunkStart;
      const endsSentence = /[.؟!؛]$/.test(cue.text);
      const isLast = i === timedCues.length - 1;

      if (isLast || (elapsed >= 8 && (endsSentence || chunkWords >= 14)) || chunkWords >= 28 || elapsed >= 22) {
        grouped.push({
          id: `seg-${grouped.length + 1}`,
          startSec: Number(chunkStart.toFixed(1)),
          endSec: Number(Math.max(chunkStart + 1.5, nextStart).toFixed(1)),
          textAr: applySmartPartialTashkeel(chunkTexts.join(' ').replace(/\s+/g, ' ').trim()),
        });
        if (!isLast && nextCue) {
          chunkTexts = [];
          chunkStart = nextCue.startSec;
          chunkWords = 0;
        }
      }
    }

    return grouped;
  }

  // Otherwise distribute plain paragraphs proportionally across duration
  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const pieces =
    paragraphs.length >= 2
      ? paragraphs
      : rawText.split(/(?<=[.؟!؛])\s+/).map((s) => s.trim()).filter(Boolean);

  if (pieces.length === 0) return [];
  const totalDur = Math.max(pieces.length * 10, fallbackDurationSeconds || 180);
  const weights = pieces.map((p) => Math.max(5, stripTashkeel(p).length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);

  let cursor = 0;
  return pieces.map((textAr, idx) => {
    const span = (weights[idx] / Math.max(1, totalWeight)) * totalDur;
    const startSec = Math.round(cursor * 10) / 10;
    const endSec = idx === pieces.length - 1 ? totalDur : Math.round((cursor + span) * 10) / 10;
    cursor += span;
    return {
      id: `seg-${idx + 1}`,
      startSec,
      endSec: Math.max(startSec + 1, endSec),
      textAr: applySmartPartialTashkeel(textAr),
    };
  });
}

export function getArabicFontClass(fontStyle?: ArabicFontStyle | string): string {
  if (fontStyle === 'amiri') return 'font-arabic-amiri';
  if (fontStyle === 'naskh') return 'font-arabic-naskh';
  return 'font-arabic-scheherazade';
}

export const LEVEL_LABELS: Record<
  ProficiencyLevel,
  { en: string; ar: string; summary: string; summaryAr: string; image: string }
> = {
  beginner: {
    en: 'Beginner',
    ar: 'مبتدئ',
    summary: 'Foundational everyday dialogues and short descriptive passages with smart partial vowelization.',
    summaryAr: 'أساسيات القراءة والمفردات اليومية',
    image: '/src/assets/images/level_beginner_courtyard_1795024353693.jpg',
  },
  intermediate: {
    en: 'Intermediate',
    ar: 'متوسط',
    summary: 'Cultural essays, biographical narratives, and connected prose in Modern Standard Arabic.',
    summaryAr: 'نصوص متنوعة وتراكيب لغوية أعمق',
    image: '/src/assets/images/level_intermediate_library_1795024354374.jpg',
  },
  advanced: {
    en: 'Advanced',
    ar: 'متقدم',
    summary: 'Classical literary reflections, philosophical prose, and nuanced idiomatic expression.',
    summaryAr: 'مقالات أدبية وثقافية متقدمة',
    image: '/src/assets/images/level_advanced_calligraphy_1795024354167.jpg',
  },
};

const FIXED_FINAL_VOWEL_WORDS = new Set([
  'هو', 'هي', 'نحن', 'انت', 'أنت', 'انتم', 'أنتم', 'ثم', 'كيف', 'اين', 'أين', 'مع', 'منذ', 'متى',
]);

const ADVERB_TANWEEN_WORDS = new Set([
  'مبكرا', 'جدا', 'شكرا', 'دائما', 'احيانا', 'أحيانا', 'صباحا', 'مساء', 'ايضا', 'أيضا',
  'معا', 'كثيرا', 'قليلا', 'سريعا', 'اهلا', 'أهلا', 'مرحبا', 'فعلا', 'حقا', 'طبعا',
  'ابدا', 'أبدا', 'غدا', 'تماما', 'عادة', 'فجأة', 'حديثا', 'قديما', 'مباشرة',
]);

const ARABIC_CASE_AND_TANWEEN_MARKS = new Set([
  '\u064B', // Tanween Fath
  '\u064C', // Tanween Damm
  '\u064D', // Tanween Kasr
  '\u064E', // Fatha
  '\u064F', // Damma
  '\u0650', // Kasra
]);

const NO_FINAL_SUKUN_LETTERS = new Set(['ا', 'أ', 'إ', 'آ', 'ى', 'و', 'ي', 'ة']);

function stripFinalIrabSingleToken(
  token: string,
  meta?: { wordType?: string; partOfSpeech?: string }
): string {
  const cleaned = token
    .replace(/\u0640/g, '') // Remove tatweel
    .replace(PUNCTUATION_EDGE_REGEX, '')
    .trim();

  if (!cleaned) return '';

  const bare = stripTashkeel(cleaned);
  if (FIXED_FINAL_VOWEL_WORDS.has(bare)) {
    return cleaned;
  }

  const units: Array<{ char: string; marks: string; isArabicLetter: boolean }> = [];
  for (const ch of cleaned) {
    if (COMBINING_MARK_REGEX.test(ch) && units.length > 0) {
      units[units.length - 1].marks += ch;
    } else {
      units.push({
        char: ch,
        marks: '',
        isArabicLetter: ARABIC_LETTER_REGEX.test(ch),
      });
    }
  }

  const letterIndices: number[] = [];
  units.forEach((u, idx) => {
    if (u.isArabicLetter) letterIndices.push(idx);
  });

  if (letterIndices.length === 0) return cleaned;

  const lastIdx = letterIndices[letterIndices.length - 1];
  const prevIdx = letterIndices.length >= 2 ? letterIndices[letterIndices.length - 2] : -1;
  const lastUnit = units[lastIdx];

  const isAdverb =
    meta?.wordType === 'ظرف' ||
    Boolean(meta?.partOfSpeech?.toLowerCase().includes('adverb')) ||
    ADVERB_TANWEEN_WORDS.has(bare);

  // Handle accusative Tanween Fath on trailing Alef / Alef Maqsura seat (e.g. كِتَابًا -> كِتَابْ)
  const hasTrailingTanwinSeat =
    prevIdx >= 0 &&
    (lastUnit.char === 'ا' || lastUnit.char === 'ى') &&
    (units[prevIdx].marks.includes('\u064B') || lastUnit.marks.includes('\u064B'));

  if (hasTrailingTanwinSeat) {
    units[prevIdx].marks = [...units[prevIdx].marks].filter((m) => m !== '\u064B').join('');
    lastUnit.marks = [...lastUnit.marks].filter((m) => m !== '\u064B').join('');

    if (isAdverb) {
      // Adverbs pause smoothly on -ā without nasal -an tanween
      return units.map((u) => u.char + u.marks).join('');
    }

    // Nouns & adjectives drop the accusative Alef seat so TTS reads the base pausal stem cleanly
    const stemUnits = units.slice(0, lastIdx);
    const stemLast = stemUnits[stemUnits.length - 1];
    if (
      stemLast &&
      stemLast.isArabicLetter &&
      !NO_FINAL_SUKUN_LETTERS.has(stemLast.char) &&
      !stemLast.marks.includes('\u0651') &&
      !stemLast.marks.includes('\u0652')
    ) {
      stemLast.marks += '\u0652';
    }
    return stemUnits.map((u) => u.char + u.marks).join('');
  }

  // Also handle unvocalized accusative -an nouns ending in Alef seat when explicitly typed (e.g. فنجانا)
  if (!hasAnyTashkeel(cleaned) && !isAdverb && bare.length >= 4 && bare.endsWith('ا') && !bare.startsWith('ال')) {
    // Keep genuine Alef nouns like دعا/عصا/دنيا untouched; only strip obvious adverbial/tanween-alef if marked
  }

  // Keep Shaddah / Sukun / Dagger Alef on the final letter, strip grammatical case vowels & tanween
  const keptFinalMarks = [...lastUnit.marks].filter(
    (m) => !ARABIC_CASE_AND_TANWEEN_MARKS.has(m)
  );
  const hasFinalShaddah = keptFinalMarks.includes('\u0651');
  const hasFinalSukun = keptFinalMarks.includes('\u0652');

  // Add pausal Sukun on consonant endings (not on long vowels, ta marbuta, or shaddah)
  if (
    !hasFinalShaddah &&
    !hasFinalSukun &&
    !NO_FINAL_SUKUN_LETTERS.has(lastUnit.char) &&
    letterIndices.length >= 3
  ) {
    keptFinalMarks.push('\u0652');
  }

  lastUnit.marks = keptFinalMarks.join('');
  return units.map((u) => u.char + u.marks).join('');
}

/**
 * Formats an isolated Arabic word (or short phrase) for clear, natural pausal TTS pronunciation:
 * - Preserves internal vocalization (فتحة، كسرة، ضمة، شدة، سكون) for accurate word pronunciation
 * - Strips grammatical case endings (الإعراب / -u, -a, -i / tanween) from the final letter
 */
export function stripFinalIrabForSpeech(
  text: string,
  meta?: { wordType?: string; partOfSpeech?: string }
): string {
  const normalized = text.replace(/\u0640/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0) return '';

  return words
    .map((w, idx) =>
      idx === words.length - 1
        ? stripFinalIrabSingleToken(w, meta)
        : stripFinalIrabSingleToken(w)
    )
    .join(' ')
    .trim();
}

export function sanitizeArabicForSpeech(text: string): string {
  return text
    .replace(/\u0640/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ExpressiveProsody {
  rateMultiplier: number;
  pitch: number;
  style: string;
}

export function resolveExpressiveProsody(options: {
  meaningHint?: string;
  wordType?: string;
  partOfSpeech?: string;
  mode?: 'word' | 'example' | 'sentence';
}): ExpressiveProsody {
  const meaning = (options.meaningHint || '').toLowerCase();
  const pos = (options.partOfSpeech || '').toLowerCase();
  const wordType = options.wordType || '';

  if (
    /happy|happiness|delighted|smile|welcome|generos|hospital|sweet|delicious|fresh|love|joy|garden|flower|jasmine|honey|warm|bright|coffee/.test(
      meaning
    )
  ) {
    return {
      rateMultiplier: options.mode === 'word' ? 0.94 : 0.96,
      pitch: 1.06,
      style:
        'Warm, welcoming, gently uplifting native Arabic pronunciation, clear pausal articulation without case-ending inflection',
    };
  }

  if (
    /calm|tranquil|serenity|peace|wisdom|contemplat|ancient|history|manuscript|quiet|evening|night|reflect/.test(
      meaning
    )
  ) {
    return {
      rateMultiplier: options.mode === 'word' ? 0.88 : 0.92,
      pitch: 0.95,
      style:
        'Calm, resonant, thoughtful native Arabic pronunciation, unhurried and clear without final case endings',
    };
  }

  if (
    wordType === 'فعل' ||
    pos.includes('verb') ||
    /wake|walk|run|exit|innovat|prominent|study|read|write|drink|buy|return|manifest/.test(meaning)
  ) {
    return {
      rateMultiplier: options.mode === 'word' ? 0.96 : 0.98,
      pitch: 1.03,
      style:
        'Crisp, engaged, lively native Arabic pronunciation with distinct syllable clarity and pausal ending',
    };
  }

  return {
    rateMultiplier: options.mode === 'word' ? 0.92 : 0.96,
    pitch: 1.0,
    style:
      'Natural, warm, crystal-clear native Modern Standard Arabic pronunciation in pausal form without final case endings',
  };
}

export const TTS_UNSUPPORTED_MESSAGE_AR =
  'تعذّر تشغيل الصوت عبر خادم النطق أو المتصفح؛ تأكد من إعدادات الصوت في جهازك أو جرّب متصفح Chrome أو Safari';

export const TTS_FAILED_MESSAGE =
  'Could not play Arabic audio right now. تعذّر تشغيل الصوت؛ تحقق من الاتصال أو إعدادات الصوت.';

export interface SpeakArabicOptions {
  rate?: number;
  mode?: 'word' | 'example' | 'sentence';
  vocalizedText?: string;
  meaningHint?: string;
  wordType?: string;
  partOfSpeech?: string;
  onLoading?: () => void;
  onStart?: () => void;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  onUnsupportedNotice?: (message: string) => void;
}

let cachedVoices: SpeechSynthesisVoice[] = [];
let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeAudioElement: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeBufferSource: AudioBufferSourceNode | null = null;
let activeFetchController: AbortController | null = null;
let activeBoundaryRaf: number | null = null;
let sharedAudioContext: AudioContext | null = null;
let audioContextUnlocked = false;
let pendingSpeakTimer: number | null = null;
let startWatchdogTimer: number | null = null;
let safetyEndTimer: number | null = null;
let currentSpeechSession = 0;
let activeEndCallback: (() => void) | null = null;

const clientTtsAudioCache = new Map<string, { buffer: ArrayBuffer; contentType: string }>();
const MAX_CLIENT_TTS_CACHE = 200;
const CLIENT_GEMINI_COOLDOWN_KEY = 'qalam_gemini_tts_cooldown_until';
const CLIENT_GEMINI_REJECTED_KEY = 'qalam_gemini_tts_rejected_reason';
const STATIC_API_TTS_UNAVAILABLE_KEY = 'qalam_static_tts_unavailable';
let clientGeminiTtsCooldownUntil = 0;
let clientGeminiRejectedReason: string | null = null;
let staticApiTtsUnavailable = false;

function isStaticApiTtsUnavailable(): boolean {
  if (staticApiTtsUnavailable) return true;
  try {
    if (window.sessionStorage?.getItem(STATIC_API_TTS_UNAVAILABLE_KEY) === '1') {
      staticApiTtsUnavailable = true;
      return true;
    }
  } catch {
    // Ignore storage access errors
  }
  return false;
}

function markStaticApiTtsUnavailable(): void {
  staticApiTtsUnavailable = true;
  try {
    window.sessionStorage?.setItem(STATIC_API_TTS_UNAVAILABLE_KEY, '1');
  } catch {
    // Ignore storage access errors
  }
}

function getClientGeminiCooldownUntil(): number {
  if (clientGeminiTtsCooldownUntil > Date.now()) return clientGeminiTtsCooldownUntil;
  try {
    const raw = window.sessionStorage?.getItem(CLIENT_GEMINI_COOLDOWN_KEY);
    const parsed = raw ? Number(raw) : 0;
    if (Number.isFinite(parsed) && parsed > Date.now()) {
      clientGeminiTtsCooldownUntil = parsed;
      return parsed;
    }
  } catch {
    // Ignore storage errors
  }
  return 0;
}

function getClientGeminiRejectedReason(): string | null {
  if (clientGeminiRejectedReason) return clientGeminiRejectedReason;
  try {
    const raw = window.sessionStorage?.getItem(CLIENT_GEMINI_REJECTED_KEY);
    if (raw) {
      clientGeminiRejectedReason = raw;
      return raw;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function setClientGeminiCooldown(durationMs: number, rejectedReason?: string): void {
  const until = Date.now() + durationMs;
  clientGeminiTtsCooldownUntil = until;
  if (rejectedReason) {
    clientGeminiRejectedReason = rejectedReason;
  }
  try {
    window.sessionStorage?.setItem(CLIENT_GEMINI_COOLDOWN_KEY, String(until));
    if (rejectedReason) {
      window.sessionStorage?.setItem(CLIENT_GEMINI_REJECTED_KEY, rejectedReason);
    }
  } catch {
    // Ignore storage errors
  }
}

function setClientTtsCache(key: string, value: { buffer: ArrayBuffer; contentType: string }) {
  if (clientTtsAudioCache.size >= MAX_CLIENT_TTS_CACHE) {
    const oldestKey = clientTtsAudioCache.keys().next().value;
    if (oldestKey) clientTtsAudioCache.delete(oldestKey);
  }
  clientTtsAudioCache.set(key, value);
}

function getClientViteGeminiApiKey(): string | null {
  return getSharedClientGeminiApiKey();
}

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioCtx();
    audioContextUnlocked = false;
  }
  return sharedAudioContext;
}

/**
 * Must be called synchronously inside user-click / keydown gesture handlers
 * BEFORE any async fetch/await so Chrome, Safari, and mobile browsers allow audio playback.
 */
export function unlockArabicAudioContext(): void {
  if (typeof window === 'undefined') return;
  try {
    const ctx = getOrCreateAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {
          // Will retry during playback
        });
      }
      if (!audioContextUnlocked) {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        audioContextUnlocked = true;
      }
    }
  } catch {
    // Non-fatal if AudioContext cannot be created
  }

  if ('speechSynthesis' in window) {
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {
      // Ignore
    }
  }
}

function decodeBase64AudioToWavBuffer(base64Data: string, mimeType?: string): ArrayBuffer {
  const binary = window.atob(base64Data);
  const rawBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    rawBytes[i] = binary.charCodeAt(i);
  }

  // Already a WAV container (starts with 'RIFF') or MP3/OGG audio
  const hasRiffHeader =
    rawBytes.length >= 4 &&
    rawBytes[0] === 0x52 &&
    rawBytes[1] === 0x49 &&
    rawBytes[2] === 0x46 &&
    rawBytes[3] === 0x46;

  if (hasRiffHeader || (mimeType && !/l16|pcm/i.test(mimeType) && /wav|mpeg|mp3|ogg|webm/i.test(mimeType))) {
    return rawBytes.buffer;
  }

  // Raw 16-bit mono PCM (audio/L16 or audio/pcm): prepend a 44-byte RIFF/WAVE header
  const rateMatch = mimeType?.match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? Number(rateMatch[1]) || 24000 : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const wavBuffer = new ArrayBuffer(44 + rawBytes.byteLength);
  const view = new DataView(wavBuffer);
  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + rawBytes.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, rawBytes.byteLength, true);

  new Uint8Array(wavBuffer, 44).set(rawBytes);
  return wavBuffer;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  const loadVoices = () => {
    const list = window.speechSynthesis.getVoices();
    if (list.length > 0) {
      cachedVoices = list;
    }
  };
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

function scoreArabicVoice(voice: SpeechSynthesisVoice): number {
  const lang = voice.lang.toLowerCase();
  if (!lang.startsWith('ar')) return -1;

  let score = 0;
  if (lang === 'ar-sa') score += 35;
  else if (lang === 'ar-eg') score += 28;
  else if (lang === 'ar-xa') score += 26;
  else if (lang === 'ar-001' || lang === 'ar-ae') score += 24;
  else score += 14;

  const name = voice.name.toLowerCase();
  if (/natural|neural|online/.test(name)) score += 50;
  if (/google|microsoft|siri|apple/.test(name)) score += 20;
  if (/tarik|maged|laila|salma|zariyah|hamed|mariam|naayf/.test(name)) score += 18;
  if (!voice.localService) score += 8;
  return score;
}

interface ArabicVoiceResolution {
  voice: SpeechSynthesisVoice | undefined;
  totalVoices: number;
  hasArabicVoice: boolean;
}

function resolveArabicVoiceInfo(): ArabicVoiceResolution {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { voice: undefined, totalVoices: 0, hasArabicVoice: false };
  }
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    cachedVoices = voices;
  }
  const pool = voices.length > 0 ? voices : cachedVoices;
  const ranked = pool
    .map((v) => ({ v, score: scoreArabicVoice(v) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score);

  return {
    voice: ranked[0]?.v,
    totalVoices: pool.length,
    hasArabicVoice: ranked.length > 0,
  };
}

function clearSpeechTimers() {
  if (pendingSpeakTimer !== null) {
    window.clearTimeout(pendingSpeakTimer);
    pendingSpeakTimer = null;
  }
  if (startWatchdogTimer !== null) {
    window.clearTimeout(startWatchdogTimer);
    startWatchdogTimer = null;
  }
  if (safetyEndTimer !== null) {
    window.clearTimeout(safetyEndTimer);
    safetyEndTimer = null;
  }
  if (activeBoundaryRaf !== null) {
    window.cancelAnimationFrame(activeBoundaryRaf);
    activeBoundaryRaf = null;
  }
}

function releaseActiveAudio() {
  if (activeFetchController) {
    try {
      activeFetchController.abort();
    } catch {
      // Ignore abort errors
    }
    activeFetchController = null;
  }

  if (activeBufferSource) {
    try {
      activeBufferSource.onended = null;
      activeBufferSource.stop();
      activeBufferSource.disconnect();
    } catch {
      // Ignore Web Audio teardown errors
    }
    activeBufferSource = null;
  }

  if (activeAudioElement) {
    try {
      activeAudioElement.onplay = null;
      activeAudioElement.ontimeupdate = null;
      activeAudioElement.onended = null;
      activeAudioElement.onerror = null;
      activeAudioElement.pause();
      activeAudioElement.removeAttribute('src');
      activeAudioElement.load();
    } catch {
      // Ignore audio teardown errors
    }
    activeAudioElement = null;
  }

  if (activeObjectUrl) {
    try {
      URL.revokeObjectURL(activeObjectUrl);
    } catch {
      // Ignore URL revoke errors
    }
    activeObjectUrl = null;
  }
}

function notifyTtsNotice(message: string, options?: SpeakArabicOptions) {
  options?.onUnsupportedNotice?.(message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('qalam:tts-notice', { detail: { message } })
    );
  }
}

export function speakArabic(
  text: string,
  optionsOrRate: SpeakArabicOptions | number = {}
): boolean {
  const options: SpeakArabicOptions =
    typeof optionsOrRate === 'number' ? { rate: optionsOrRate } : optionsOrRate;

  // CRITICAL: Unlock Web AudioContext synchronously inside user click/tap gesture before any async work
  unlockArabicAudioContext();

  const baseRate = options.rate ?? 0.92;
  const mode = options.mode ?? 'sentence';
  const sourceText = (options.vocalizedText || text).trim();

  let ttsText = '';
  let karaokeText = '';
  if (mode === 'word') {
    ttsText = stripFinalIrabForSpeech(sourceText, {
      wordType: options.wordType,
      partOfSpeech: options.partOfSpeech,
    });
    karaokeText = ttsText;
  } else if (mode === 'example') {
    ttsText = sanitizeArabicForSpeech(sourceText);
    karaokeText = ttsText;
  } else {
    // Keep expressive vocalization for neural AI TTS while tracking stripped length for karaoke boundary indices
    ttsText = sanitizeArabicForSpeech(sourceText);
    karaokeText = stripTashkeel(sourceText).replace(/\s+/g, ' ').trim();
  }

  if (!ttsText || typeof window === 'undefined') {
    options.onEnd?.();
    return false;
  }

  const prosody = resolveExpressiveProsody({
    meaningHint: options.meaningHint,
    wordType: options.wordType,
    partOfSpeech: options.partOfSpeech,
    mode,
  });

  const effectiveRate = Math.max(
    0.7,
    Math.min(1.25, Number((baseRate * prosody.rateMultiplier).toFixed(2)))
  );

  currentSpeechSession += 1;
  const sessionId = currentSpeechSession;

  clearSpeechTimers();
  releaseActiveAudio();

  if (activeEndCallback) {
    const prevEnd = activeEndCallback;
    activeEndCallback = null;
    prevEnd();
  }

  let didCancelActiveSpeech = false;
  if ('speechSynthesis' in window) {
    try {
      didCancelActiveSpeech =
        window.speechSynthesis.speaking || window.speechSynthesis.pending;
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {
      // Ignore cancel errors on unsupported browsers
    }
  }

  activeEndCallback = options.onEnd ?? null;

  const finalize = () => {
    if (currentSpeechSession !== sessionId) return;
    clearSpeechTimers();
    releaseActiveAudio();
    activeUtterance = null;
    const cb = activeEndCallback;
    activeEndCallback = null;
    cb?.();
  };

  let geminiDiag = 'Gemini TTS not attempted';
  let voiceDiag = 'speechSynthesis voice check pending';

  const failAndNotify = (reason?: string) => {
    if (currentSpeechSession !== sessionId) return;
    const msg = reason || TTS_FAILED_MESSAGE;
    console.warn(
      `[Qalam Audio] Spoken Arabic playback unavailable. Gemini status: ${geminiDiag} | Browser speechSynthesis status: ${voiceDiag}`
    );
    notifyTtsNotice(msg, options);
    options.onError?.(msg);
    finalize();
  };

  const tryBrowserSpeechSynthesis = (
    onUnavailableOrError: () => void,
    syncUserGesture = false
  ): boolean => {
    const hasSpeechApi =
      'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    if (!hasSpeechApi) {
      voiceDiag = 'Web Speech API (speechSynthesis) is not supported in this browser';
      console.warn(`[Qalam Audio] ${voiceDiag}. Gemini status: ${geminiDiag}`);
      return false;
    }

    const voiceInfo = resolveArabicVoiceInfo();

    if (voiceInfo.hasArabicVoice && voiceInfo.voice) {
      voiceDiag = `Using browser Arabic voice "${voiceInfo.voice.name}" (${voiceInfo.voice.lang})`;
    } else if (voiceInfo.totalVoices > 0) {
      voiceDiag = `No Arabic speechSynthesis voice installed among ${voiceInfo.totalVoices} browser voices (expected ar-SA, ar-EG, ar-XA, or ar-*)`;
      console.warn(
        `[Qalam Audio] Cannot use browser speechSynthesis: ${voiceDiag}. Gemini status: ${geminiDiag}`
      );
      return false;
    } else {
      voiceDiag =
        'No speechSynthesis voices loaded yet (getVoices() returned empty); trying ar-SA fallback';
    }

    try {
      const browserSpeechText = mode === 'sentence' ? karaokeText : ttsText;
      const utterance = new SpeechSynthesisUtterance(browserSpeechText);
      utterance.lang = voiceInfo.voice?.lang || 'ar-SA';
      if (voiceInfo.voice) {
        utterance.voice = voiceInfo.voice;
      }
      utterance.rate = effectiveRate;
      utterance.pitch = prosody.pitch;
      utterance.volume = 1;

      activeUtterance = utterance;
      let speechStarted = false;
      let notifiedStart = false;
      const notifyStartOnce = () => {
        if (notifiedStart || currentSpeechSession !== sessionId) return;
        notifiedStart = true;
        options.onStart?.();
      };

      utterance.onstart = () => {
        if (currentSpeechSession !== sessionId) return;
        speechStarted = true;
        if (startWatchdogTimer !== null) {
          window.clearTimeout(startWatchdogTimer);
          startWatchdogTimer = null;
        }
        notifyStartOnce();
      };

      utterance.onboundary = (event: SpeechSynthesisEvent) => {
        if (currentSpeechSession !== sessionId) return;
        if (typeof event.charIndex === 'number') {
          options.onBoundary?.(event.charIndex);
        }
      };

      utterance.onend = () => {
        finalize();
      };

      utterance.onerror = (event) => {
        if (currentSpeechSession !== sessionId) return;
        // 'interrupted' / 'canceled' happens intentionally on stopArabicSpeech()
        if (event.error === 'interrupted' || event.error === 'canceled') {
          return;
        }
        voiceDiag = `speechSynthesis error (${event.error})`;
        console.warn(`[Qalam Audio] ${voiceDiag}. Gemini status: ${geminiDiag}`);
        activeUtterance = null;
        onUnavailableOrError();
      };

      const startSpeaking = () => {
        if (currentSpeechSession !== sessionId) return;
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);

        // Watchdog in case browser silently ignores speak() without firing onstart/onerror
        startWatchdogTimer = window.setTimeout(() => {
          if (currentSpeechSession !== sessionId || speechStarted) return;
          voiceDiag = 'speechSynthesis did not start within 900ms (likely missing Arabic OS voice)';
          console.warn(`[Qalam Audio] ${voiceDiag}. Gemini status: ${geminiDiag}`);
          activeUtterance = null;
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Ignore
          }
          onUnavailableOrError();
        }, 900);

        const estimatedMs = Math.max(
          2800,
          Math.min(22000, (ttsText.length * 175) / Math.max(0.5, effectiveRate))
        );
        safetyEndTimer = window.setTimeout(finalize, estimatedMs);
      };

      notifyStartOnce();

      if (syncUserGesture && !didCancelActiveSpeech) {
        startSpeaking();
      } else {
        pendingSpeakTimer = window.setTimeout(startSpeaking, 25);
      }

      return true;
    } catch (err) {
      voiceDiag = `Failed to initialize SpeechSynthesisUtterance: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[Qalam Audio] ${voiceDiag}. Gemini status: ${geminiDiag}`);
      return false;
    }
  };

  const playAudioBufferThroughContext = async (
    audioBuffer: ArrayBuffer,
    contentType: string
  ): Promise<void> => {
    if (currentSpeechSession !== sessionId) return;

    const ctx = getOrCreateAudioContext();
    if (ctx) {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        let decoded: AudioBuffer;
        try {
          decoded = await ctx.decodeAudioData(audioBuffer.slice(0));
        } catch (decodeErr) {
          // Manual RIFF/PCM fallback if browser decodeAudioData rejects raw 16-bit PCM WAV
          const view = new DataView(audioBuffer);
          const isRiff =
            audioBuffer.byteLength > 44 &&
            view.getUint8(0) === 0x52 &&
            view.getUint8(1) === 0x49 &&
            view.getUint8(2) === 0x46 &&
            view.getUint8(3) === 0x46;
          if (!isRiff) {
            throw decodeErr;
          }
          const sampleRate = view.getUint32(24, true) || 24000;
          const pcmBytes = new Int16Array(audioBuffer, 44);
          decoded = ctx.createBuffer(1, pcmBytes.length, sampleRate);
          const channel = decoded.getChannelData(0);
          for (let i = 0; i < pcmBytes.length; i++) {
            channel[i] = pcmBytes[i] / 32768;
          }
        }

        if (currentSpeechSession !== sessionId) return;

        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.playbackRate.value = Math.max(0.68, Math.min(1.4, effectiveRate));
        source.connect(ctx.destination);
        activeBufferSource = source;

        const expectedDurationMs = Math.max(
          450,
          (decoded.duration * 1000) / Math.max(0.5, source.playbackRate.value)
        );
        const startedAt = performance.now();

        options.onStart?.();

        if (options.onBoundary && karaokeText.length > 0) {
          const tickBoundary = () => {
            if (currentSpeechSession !== sessionId || activeBufferSource !== source) return;
            const elapsed = performance.now() - startedAt;
            const progress = Math.max(0, Math.min(1, elapsed / expectedDurationMs));
            options.onBoundary?.(Math.floor(progress * karaokeText.length));
            if (progress < 1) {
              activeBoundaryRaf = window.requestAnimationFrame(tickBoundary);
            }
          };
          activeBoundaryRaf = window.requestAnimationFrame(tickBoundary);
        }

        source.onended = () => {
          if (currentSpeechSession !== sessionId) return;
          finalize();
        };

        source.start(0);
        safetyEndTimer = window.setTimeout(finalize, expectedDurationMs + 1500);
        return;
      } catch (ctxErr) {
        console.warn(
          '[Qalam Audio] Web Audio decode/playback fallback to HTMLAudioElement:',
          ctxErr instanceof Error ? ctxErr.message : ctxErr
        );
      }
    }

    // Fallback to Blob HTMLAudioElement if AudioContext decoding fails
    const blob = new Blob([audioBuffer], { type: contentType || 'audio/wav' });
    const objectUrl = URL.createObjectURL(blob);
    activeObjectUrl = objectUrl;

    const audio = new Audio(objectUrl);
    audio.playbackRate = Math.max(0.68, Math.min(1.4, effectiveRate));
    activeAudioElement = audio;

    audio.ontimeupdate = () => {
      if (currentSpeechSession !== sessionId) return;
      if (audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
        const progress = Math.max(0, Math.min(1, audio.currentTime / audio.duration));
        options.onBoundary?.(Math.floor(progress * karaokeText.length));
      }
    };

    audio.onended = () => finalize();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      audio.onplay = () => {
        if (!settled) {
          settled = true;
          options.onStart?.();
          resolve();
        }
      };
      audio.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('HTMLAudioElement failed to play blob audio.'));
        }
      };
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      }
    });

    const estimatedMs = Math.max(
      2600,
      Math.min(22000, (ttsText.length * 175) / Math.max(0.5, effectiveRate))
    );
    safetyEndTimer = window.setTimeout(finalize, estimatedMs);
  };

  const playDirectGoogleAudioTag = (onErrorFallback: () => void) => {
    if (currentSpeechSession !== sessionId) return;
    const directUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(ttsText.slice(0, 180))}&tl=ar&client=tw-ob`;
    try {
      const audio = new Audio(directUrl);
      audio.playbackRate = Math.max(0.68, Math.min(1.4, effectiveRate));
      activeAudioElement = audio;
      let started = false;

      audio.onplay = () => {
        if (currentSpeechSession !== sessionId) return;
        started = true;
        options.onStart?.();
      };
      audio.onended = () => finalize();
      audio.onerror = () => {
        if (currentSpeechSession !== sessionId) return;
        console.warn('[Qalam Audio] Direct Google TTS <audio> stream was blocked or failed.');
        onErrorFallback();
      };

      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          if (currentSpeechSession !== sessionId || started) return;
          console.warn('[Qalam Audio] Direct Google TTS <audio> play() rejected:', err);
          onErrorFallback();
        });
      }
      safetyEndTimer = window.setTimeout(finalize, 12000);
    } catch {
      onErrorFallback();
    }
  };

  const requestGeminiTtsAudio = async (
    apiKey: string,
    textToSpeak: string,
    signal: AbortSignal
  ): Promise<{ buffer: ArrayBuffer; contentType: string } | null> => {
    const requestModelAudio = async (model: string, promptStyle: boolean) => {
      const partPayload = promptStyle
        ? {
            text:
              mode === 'word'
                ? `Pronounce ONLY this Arabic word clearly in natural pausal form without adding trailing case-ending vowels (سكون الوقف): ${textToSpeak}`
                : `Read this Arabic text clearly in natural Modern Standard Arabic: ${textToSpeak}`,
          }
        : {
            text: textToSpeak,
            speechMetadata: {
              style: prosody.style,
            },
          };

      return fetchGeminiGenerateContent({
        model,
        apiKey,
        signal,
        logPrefix: 'Qalam Audio',
        payload: {
          contents: [
            {
              role: 'user',
              parts: [partPayload],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        },
      });
    };

    // Prefer the canonical Gemini TTS model (`gemini-3.8-flash-lite-tts`), falling back to
    // `gemini-2.5-flash-preview-tts` if an external key returns 404 NOT_FOUND for 3.8.
    let result = await requestModelAudio('gemini-3.8-flash-lite-tts', false);
    if (result.response.status === 404) {
      result = await requestModelAudio('gemini-2.5-flash-preview-tts', true);
    }

    const geminiRes = result.response;
    const errText = result.errorBody;

    if (!geminiRes.ok) {
      console.error(
        `[Qalam Audio] Gemini TTS failed (HTTP ${geminiRes.status} ${geminiRes.statusText}):`,
        errText
      );
      if (geminiRes.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(errText)) {
        geminiDiag = 'VITE_GEMINI_API_KEY quota exceeded (HTTP 429 RESOURCE_EXHAUSTED)';
        setClientGeminiCooldown(30 * 60 * 1000, geminiDiag);
      } else if (
        geminiRes.status === 401 ||
        geminiRes.status === 403 ||
        /API_KEY_INVALID|PERMISSION_DENIED/i.test(errText)
      ) {
        geminiDiag = `VITE_GEMINI_API_KEY rejected by Gemini API (HTTP ${geminiRes.status})`;
        setClientGeminiCooldown(60 * 60 * 1000, geminiDiag);
      } else {
        geminiDiag = `Gemini TTS returned HTTP ${geminiRes.status}: ${errText.slice(0, 140)}`;
      }
      return null;
    }

    const json = (await geminiRes.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { data?: string; mimeType?: string };
          }>;
        };
      }>;
    };
    const inlineData = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inlineData?.data) {
      geminiDiag = 'Gemini API responded without audio inlineData';
      console.warn(`[Qalam Audio] ${geminiDiag}; switching to fallback audio.`);
      return null;
    }

    geminiDiag = 'Gemini TTS succeeded';
    return {
      buffer: decodeBase64AudioToWavBuffer(inlineData.data, inlineData.mimeType),
      contentType: 'audio/wav',
    };
  };

  const fetchAndPlayAiAudio = async (allowSpeechSynthesisFallback: boolean) => {
    if (currentSpeechSession !== sessionId) return;

    const cleanForUrl = ttsText.slice(0, 900);
    const cacheKey = `${mode}::${cleanForUrl}`;
    const cached = clientTtsAudioCache.get(cacheKey);

    if (cached) {
      try {
        await playAudioBufferThroughContext(cached.buffer, cached.contentType);
        return;
      } catch (err) {
        console.warn('[Qalam Audio] Cached clip failed, refetching:', err);
        clientTtsAudioCache.delete(cacheKey);
      }
    }

    options.onLoading?.();

    const controller = new AbortController();
    activeFetchController = controller;
    const timeoutMs = mode === 'word' ? 6000 : mode === 'example' ? 8000 : 12000;
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      let fetchedBuffer: ArrayBuffer | null = null;
      let fetchedContentType = 'audio/wav';

      // 1. Direct Gemini Audio / TTS FIRST when VITE_GEMINI_API_KEY is present and active
      const clientGeminiKey = getClientViteGeminiApiKey();
      if (!clientGeminiKey) {
        geminiDiag = 'VITE_GEMINI_API_KEY is missing in environment';
      } else if (Date.now() < getClientGeminiCooldownUntil()) {
        geminiDiag = getClientGeminiRejectedReason() || 'Gemini TTS cooldown active';
      } else {
        try {
          const geminiAudio = await requestGeminiTtsAudio(
            clientGeminiKey,
            cleanForUrl,
            controller.signal
          );
          if (geminiAudio) {
            fetchedBuffer = geminiAudio.buffer;
            fetchedContentType = geminiAudio.contentType;
          }
        } catch (geminiErr) {
          if ((geminiErr as Error)?.name === 'AbortError') {
            geminiDiag = `Direct Gemini TTS timed out after ${timeoutMs}ms`;
            throw geminiErr;
          }
          geminiDiag = `Direct Gemini TTS network error (${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)})`;
          console.warn(`[Qalam Audio] ${geminiDiag}; falling back.`);
        }
      }

      // 2. Fallback to backend `/api/tts` proxy when available (full-stack preview / Node host)
      if (!fetchedBuffer && !isStaticApiTtsUnavailable()) {
        try {
          const params = new URLSearchParams({
            q: cleanForUrl,
            mode,
            style: prosody.style,
          });
          const res = await fetch(`/api/tts?${params.toString()}`, {
            signal: controller.signal,
          });
          const ct = (res.headers.get('content-type') || '').toLowerCase();

          if (res.ok && ct.startsWith('audio/')) {
            const buf = await res.arrayBuffer();
            if (buf.byteLength > 100) {
              fetchedBuffer = buf;
              fetchedContentType = ct;
            }
          } else {
            if (res.status === 404 || res.status === 405 || !ct.startsWith('audio/')) {
              markStaticApiTtsUnavailable();
            }
            console.info(
              `[Qalam Audio] /api/tts unavailable (status=${res.status}); trying browser speechSynthesis.`
            );
          }
        } catch (serverErr) {
          if ((serverErr as Error)?.name === 'AbortError') {
            throw serverErr;
          }
          console.info(
            '[Qalam Audio] /api/tts unavailable:',
            serverErr instanceof Error ? serverErr.message : serverErr
          );
        }
      }

      window.clearTimeout(timeoutId);
      if (activeFetchController === controller) {
        activeFetchController = null;
      }
      if (currentSpeechSession !== sessionId) return;

      if (fetchedBuffer) {
        setClientTtsCache(cacheKey, {
          buffer: fetchedBuffer,
          contentType: fetchedContentType,
        });
        await playAudioBufferThroughContext(fetchedBuffer, fetchedContentType);
        return;
      }

      // 3. Smarter Web Speech API fallback (prefers ar-SA, ar-EG, ar-XA, or any ar* voice)
      if (allowSpeechSynthesisFallback) {
        const startedSpeech = tryBrowserSpeechSynthesis(() => {
          playDirectGoogleAudioTag(() => failAndNotify());
        });
        if (startedSpeech) return;
      }

      // 4. Final direct audio stream attempt before reporting friendly diagnostic
      playDirectGoogleAudioTag(() => failAndNotify());
    } catch (err) {
      window.clearTimeout(timeoutId);
      if (activeFetchController === controller) {
        activeFetchController = null;
      }
      if (currentSpeechSession !== sessionId) return;

      console.info(
        `[Qalam Audio] AI audio pipeline interrupted (${err instanceof Error ? err.message : String(err)}); checking browser Arabic voices.`
      );

      if (allowSpeechSynthesisFallback) {
        const startedSpeech = tryBrowserSpeechSynthesis(() => {
          playDirectGoogleAudioTag(() => failAndNotify());
        });
        if (startedSpeech) return;
      }

      playDirectGoogleAudioTag(() => failAndNotify());
    }
  };

  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

  // Unified expressive pronunciation pipeline across standalone words, card examples, AND lesson reading passages:
  // Direct VITE_GEMINI_API_KEY TTS -> unlocked AudioContext -> /api/tts -> Arabic speechSynthesis (ar-SA/ar-EG/ar-XA/ar*) -> <audio> fallback.
  if (isOnline) {
    void fetchAndPlayAiAudio(true);
    return true;
  }

  geminiDiag = 'Browser appears offline (navigator.onLine === false)';
  const startedBrowserSpeech = tryBrowserSpeechSynthesis(
    () => {
      failAndNotify();
    },
    true
  );

  if (!startedBrowserSpeech) {
    failAndNotify();
  }
  return true;
}

export function stopArabicSpeech(): void {
  currentSpeechSession += 1;
  clearSpeechTimers();
  releaseActiveAudio();
  activeUtterance = null;
  if (activeEndCallback) {
    const cb = activeEndCallback;
    activeEndCallback = null;
    cb();
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore cancel errors
    }
  }
}

