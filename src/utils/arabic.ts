import type { ArabicFontStyle, ProficiencyLevel, TranscriptSegment } from '../types/arabic.ts';
import {
  fetchGeminiGenerateContent,
  getClientGeminiApiKey as getSharedClientGeminiApiKey,
  notifyGeminiQuotaNotice,
  parseGeminiQuotaInfo,
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

export function normalizeStandaloneArabicKey(word: string): string {
  let cleaned = word
    .replace(/\u0640/g, '')
    .replace(PUNCTUATION_EDGE_REGEX, '')
    .trim();

  // Strip accusative tanween fath + trailing Alef seat (e.g. كِتَابًا -> كِتَاب) unless inherent adverb
  const bareNoMarks = stripTashkeel(cleaned);
  if (
    !new Set([
      'مبكرا', 'جدا', 'شكرا', 'دائما', 'احيانا', 'أحيانا', 'صباحا', 'مساء', 'ايضا', 'أيضا',
      'معا', 'كثيرا', 'قليلا', 'سريعا', 'اهلا', 'أهلا', 'مرحبا', 'فعلا', 'حقا', 'طبعا',
      'ابدا', 'أبدا', 'غدا', 'تماما', 'عادة', 'فجأة', 'حديثا', 'قديما', 'مباشرة',
    ]).has(bareNoMarks) &&
    cleaned.length >= 4 &&
    /\u064B[\u064E-\u0652\u0651]*[اأى]$/.test(cleaned)
  ) {
    cleaned = cleaned.replace(/\u064B([\u064E-\u0652\u0651]*)[اأى]$/, '$1');
  }

  return normalizeArabicWord(cleaned);
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

/**
 * Normalizes an Arabic word extracted from reading context into a clean standalone
 * dictionary/vocabulary entry by removing sentence-bound grammatical case endings (الإعراب)
 * while preserving internal vocalization, Shaddah, fixed-vowel particles, and adverbs.
 */
export function normalizeStandaloneVocabWord(
  word: string,
  meta?: { wordType?: string; partOfSpeech?: string }
): string {
  const cleaned = word
    .replace(/\u0640/g, '')
    .replace(PUNCTUATION_EDGE_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  const tokens = cleaned.split(' ').filter(Boolean);
  if (tokens.length === 0) return '';

  const normalizeSingleStandaloneToken = (
    token: string,
    tokenMeta?: { wordType?: string; partOfSpeech?: string }
  ): string => {
    const bare = stripTashkeel(token);
    if (!bare) return token;

    if (FIXED_FINAL_VOWEL_WORDS.has(bare)) {
      return token;
    }

    const isAdverb =
      tokenMeta?.wordType === 'ظرف' ||
      Boolean(tokenMeta?.partOfSpeech?.toLowerCase().includes('adverb')) ||
      ADVERB_TANWEEN_WORDS.has(bare);

    if (isAdverb && ADVERB_TANWEEN_WORDS.has(bare)) {
      return token;
    }

    const units: Array<{ char: string; marks: string; isArabicLetter: boolean }> = [];
    for (const ch of token) {
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
    if (letterIndices.length === 0) return token;

    const lastIdx = letterIndices[letterIndices.length - 1];
    const prevIdx = letterIndices.length >= 2 ? letterIndices[letterIndices.length - 2] : -1;
    const lastUnit = units[lastIdx];

    // Strip accusative tanween fath + trailing Alef / Alef Maqsura seat (e.g. كِتَابًا -> كِتَاب)
    const hasTrailingTanwinSeat =
      prevIdx >= 0 &&
      (lastUnit.char === 'ا' || lastUnit.char === 'ى') &&
      (units[prevIdx].marks.includes('\u064B') || lastUnit.marks.includes('\u064B'));

    if (hasTrailingTanwinSeat) {
      units[prevIdx].marks = [...units[prevIdx].marks].filter((m) => m !== '\u064B').join('');
      lastUnit.marks = [...lastUnit.marks].filter((m) => m !== '\u064B').join('');
      if (isAdverb) {
        return units.map((u) => u.char + u.marks).join('');
      }
      return units
        .slice(0, lastIdx)
        .map((u) => u.char + u.marks)
        .join('');
    }

    // Preserve past-tense 3ms verb citation fatha (e.g. كَتَبَ، ذَهَبَ) when tagged as verb
    const isVerb =
      tokenMeta?.wordType === 'فعل' ||
      Boolean(tokenMeta?.partOfSpeech?.toLowerCase().includes('verb'));
    const isPastCitationFatha =
      isVerb &&
      lastUnit.marks.includes('\u064E') &&
      !lastUnit.marks.includes('\u064B') &&
      !/^[يتنأ]/.test(bare);

    if (isPastCitationFatha) {
      return token;
    }

    // Strip context-bound case vowels & tanween (-a, -u, -i, -an, -un, -in) while preserving Shaddah/Sukun
    lastUnit.marks = [...lastUnit.marks]
      .filter((m) => !ARABIC_CASE_AND_TANWEEN_MARKS.has(m))
      .join('');

    return units.map((u) => u.char + u.marks).join('');
  };

  return tokens
    .map((t, idx) =>
      idx === tokens.length - 1
        ? normalizeSingleStandaloneToken(t, meta)
        : normalizeSingleStandaloneToken(t)
    )
    .join(' ')
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
let activeObjectUrlIsCached = false;
let activeBufferSource: AudioBufferSourceNode | null = null;
let activeFetchController: AbortController | null = null;
let activeBoundaryRaf: number | null = null;
let sharedAudioContext: AudioContext | null = null;
let audioContextUnlocked = false;
let pendingSpeakTimer: number | null = null;
let startWatchdogTimer: number | null = null;
let safetyEndTimer: number | null = null;
let publicTtsTimeoutTimer: number | null = null;
let currentSpeechSession = 0;
let activeEndCallback: (() => void) | null = null;
let activeLoadingCacheKey: string | null = null;

interface CachedTtsAudioEntry {
  buffer: ArrayBuffer;
  dataB64: string;
  blobUrl: string;
  contentType: string;
}

const clientTtsAudioCache = new Map<string, CachedTtsAudioEntry>();
const inFlightTtsRequests = new Map<
  string,
  Promise<{ buffer: ArrayBuffer; contentType: string } | null>
>();
const MAX_CLIENT_TTS_CACHE = 200;
const PERSISTENT_TTS_CACHE_KEY = 'qalam_tts_audio_cache_v1';
const MAX_PERSISTENT_TTS_ENTRIES = 40;
const MAX_PERSISTENT_CLIP_B64_CHARS = 420_000;
const CLIENT_GEMINI_COOLDOWN_KEY = 'qalam_gemini_tts_cooldown_until';
const CLIENT_GEMINI_REJECTED_KEY = 'qalam_gemini_tts_rejected_reason';
const STATIC_API_TTS_UNAVAILABLE_KEY = 'qalam_static_tts_unavailable';
let clientGeminiTtsCooldownUntil = 0;
let clientGeminiRejectedReason: string | null = null;
let staticApiTtsUnavailable = false;

interface StoredTtsClip {
  dataB64: string;
  contentType: string;
  savedAt: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function buildNormalizedTtsCacheKey(
  mode: 'word' | 'example' | 'sentence',
  rawText: string
): string {
  if (mode === 'word') {
    const normWord = normalizeArabicWord(rawText);
    return `word::${normWord || stripTashkeel(rawText).replace(/\s+/g, ' ').trim()}`;
  }
  const normPhrase = stripTashkeel(rawText)
    .replace(/\u0640/g, '')
    .replace(/[،؟؛.!?"'()«»…\-–—:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
  return `phrase::${normPhrase}`;
}

function readPersistentTtsMap(): Record<string, StoredTtsClip> {
  if (typeof window === 'undefined') return {};
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = storage?.getItem(PERSISTENT_TTS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, StoredTtsClip>;
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

function getPersistentTtsCache(
  key: string
): { buffer: ArrayBuffer; contentType: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const map = readPersistentTtsMap();
    const entry = map[key];
    if (!entry?.dataB64) return null;
    const buffer = base64ToArrayBuffer(entry.dataB64);
    if (buffer.byteLength <= 44) return null;
    return { buffer, contentType: entry.contentType || 'audio/wav' };
  } catch {
    return null;
  }
}

function setPersistentTtsCache(
  key: string,
  buffer: ArrayBuffer,
  contentType: string
): void {
  if (typeof window === 'undefined') return;
  try {
    const dataB64 = arrayBufferToBase64(buffer);
    if (!dataB64 || dataB64.length > MAX_PERSISTENT_CLIP_B64_CHARS) {
      return;
    }

    const map = readPersistentTtsMap();
    map[key] = {
      dataB64,
      contentType: contentType || 'audio/wav',
      savedAt: Date.now(),
    };

    const sortedEntries = Object.entries(map).sort(
      (a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0)
    );
    let trimmedEntries = sortedEntries.slice(0, MAX_PERSISTENT_TTS_ENTRIES);

    const writeToStorage = (storage: Storage | undefined, entries: Array<[string, StoredTtsClip]>) => {
      if (!storage) return false;
      let candidate = [...entries];
      while (candidate.length > 0) {
        try {
          storage.setItem(PERSISTENT_TTS_CACHE_KEY, JSON.stringify(Object.fromEntries(candidate)));
          return true;
        } catch {
          // Evict oldest half on QuotaExceededError and retry
          if (candidate.length <= 1) break;
          candidate = candidate.slice(0, Math.ceil(candidate.length / 2));
        }
      }
      return false;
    };

    writeToStorage(window.localStorage, trimmedEntries);
    writeToStorage(window.sessionStorage, trimmedEntries.slice(0, 18));
  } catch {
    // Non-fatal if storage is unavailable
  }
}

export function invalidateCachedArabicAudio(
  text: string,
  mode?: 'word' | 'example' | 'sentence'
): void {
  if (typeof window === 'undefined' || !text.trim()) return;

  const clean = text.trim().slice(0, 900);
  const candidateModes: Array<'word' | 'example' | 'sentence'> = mode
    ? [mode]
    : ['word', 'example', 'sentence'];

  const keysToRemove = new Set<string>();
  for (const m of candidateModes) {
    keysToRemove.add(buildNormalizedTtsCacheKey(m, clean));
    if (m === 'word') {
      keysToRemove.add(buildNormalizedTtsCacheKey('word', stripFinalIrabForSpeech(clean)));
      keysToRemove.add(buildNormalizedTtsCacheKey('word', normalizeStandaloneVocabWord(clean)));
    } else {
      keysToRemove.add(buildNormalizedTtsCacheKey(m, sanitizeArabicForSpeech(clean)));
    }
  }

  for (const key of keysToRemove) {
    const existing = clientTtsAudioCache.get(key);
    if (existing?.blobUrl && existing.blobUrl !== activeObjectUrl) {
      try {
        URL.revokeObjectURL(existing.blobUrl);
      } catch {
        // Ignore revoke errors
      }
    }
    clientTtsAudioCache.delete(key);
    inFlightTtsRequests.delete(key);
  }

  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = storage?.getItem(PERSISTENT_TTS_CACHE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, StoredTtsClip>;
      if (!parsed || typeof parsed !== 'object') continue;
      let changed = false;
      for (const key of keysToRemove) {
        if (key in parsed) {
          delete parsed[key];
          changed = true;
        }
      }
      if (changed) {
        storage.setItem(PERSISTENT_TTS_CACHE_KEY, JSON.stringify(parsed));
      }
    } catch {
      // Non-fatal if storage is unavailable
    }
  }
}

export interface AudioDiagnosticsSnapshot {
  speechSynthesisSupported: boolean;
  totalVoices: number;
  arabicVoices: Array<{ name: string; lang: string; localService: boolean }>;
  memoryCachedClips: number;
  persistentCachedClips: number;
  geminiAudioCooldownActive: boolean;
  geminiAudioCooldownRemainingSec: number;
  geminiAudioRejectedReason: string | null;
  staticApiTtsUnavailable: boolean;
}

export function getAudioDiagnosticsSnapshot(): AudioDiagnosticsSnapshot {
  const speechSynthesisSupported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined';

  let voices: SpeechSynthesisVoice[] = [];
  if (speechSynthesisSupported) {
    try {
      voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        cachedVoices = voices;
      } else if (cachedVoices.length > 0) {
        voices = cachedVoices;
      }
    } catch {
      voices = [];
    }
  }

  const arabicVoices = voices
    .filter((v) => v.lang.toLowerCase().startsWith('ar'))
    .map((v) => ({
      name: v.name,
      lang: v.lang,
      localService: v.localService,
    }));

  let persistentCachedClips = 0;
  if (typeof window !== 'undefined') {
    try {
      const raw =
        window.localStorage?.getItem(PERSISTENT_TTS_CACHE_KEY) ||
        window.sessionStorage?.getItem(PERSISTENT_TTS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          persistentCachedClips = Object.keys(parsed).length;
        }
      }
    } catch {
      persistentCachedClips = 0;
    }
  }

  const cooldownUntil = getClientGeminiCooldownUntil();
  const remainingMs = Math.max(0, cooldownUntil - Date.now());

  return {
    speechSynthesisSupported,
    totalVoices: voices.length,
    arabicVoices,
    memoryCachedClips: clientTtsAudioCache.size,
    persistentCachedClips,
    geminiAudioCooldownActive: remainingMs > 0,
    geminiAudioCooldownRemainingSec: Math.ceil(remainingMs / 1000),
    geminiAudioRejectedReason: getClientGeminiRejectedReason(),
    staticApiTtsUnavailable: isStaticApiTtsUnavailable(),
  };
}

export function clearArabicAudioCooldowns(): void {
  clientGeminiTtsCooldownUntil = 0;
  clientGeminiRejectedReason = null;
  staticApiTtsUnavailable = false;
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage?.removeItem(CLIENT_GEMINI_COOLDOWN_KEY);
      window.sessionStorage?.removeItem(CLIENT_GEMINI_REJECTED_KEY);
      window.sessionStorage?.removeItem(STATIC_API_TTS_UNAVAILABLE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('qalam:gemini-key-changed', () => {
    clearArabicAudioCooldowns();
  });
}

export function clearAllArabicAudioCaches(): { clearedMemory: number; clearedPersistent: number } {
  stopArabicSpeech();
  const clearedMemory = clientTtsAudioCache.size;
  for (const [, entry] of clientTtsAudioCache.entries()) {
    if (entry?.blobUrl) {
      try {
        URL.revokeObjectURL(entry.blobUrl);
      } catch {
        // Ignore revoke errors
      }
    }
  }
  clientTtsAudioCache.clear();
  inFlightTtsRequests.clear();

  let clearedPersistent = 0;
  if (typeof window !== 'undefined') {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        const raw = storage?.getItem(PERSISTENT_TTS_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') {
            clearedPersistent = Math.max(clearedPersistent, Object.keys(parsed).length);
          }
          storage.removeItem(PERSISTENT_TTS_CACHE_KEY);
        }
      } catch {
        // Ignore storage errors
      }
    }
  }

  clearArabicAudioCooldowns();

  return { clearedMemory, clearedPersistent };
}

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

function setClientTtsCache(
  key: string,
  value: { buffer: ArrayBuffer; contentType: string; dataB64?: string }
): CachedTtsAudioEntry {
  const existing = clientTtsAudioCache.get(key);
  if (existing) {
    return existing;
  }
  if (clientTtsAudioCache.size >= MAX_CLIENT_TTS_CACHE) {
    const oldestKey = clientTtsAudioCache.keys().next().value;
    if (oldestKey) {
      const oldest = clientTtsAudioCache.get(oldestKey);
      if (oldest?.blobUrl) {
        try {
          URL.revokeObjectURL(oldest.blobUrl);
        } catch {
          // Ignore revoke errors
        }
      }
      clientTtsAudioCache.delete(oldestKey);
    }
  }
  const contentType = value.contentType || 'audio/wav';
  const dataB64 = value.dataB64 || arrayBufferToBase64(value.buffer);
  const blobUrl = URL.createObjectURL(new Blob([value.buffer], { type: contentType }));
  const entry: CachedTtsAudioEntry = {
    buffer: value.buffer,
    dataB64,
    blobUrl,
    contentType,
  };
  clientTtsAudioCache.set(key, entry);
  return entry;
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
  if (publicTtsTimeoutTimer !== null) {
    window.clearTimeout(publicTtsTimeoutTimer);
    publicTtsTimeoutTimer = null;
  }
  if (activeBoundaryRaf !== null) {
    window.cancelAnimationFrame(activeBoundaryRaf);
    activeBoundaryRaf = null;
  }
}

function releaseActiveAudio() {
  if (activeFetchController) {
    try {
      activeFetchController.abort(new DOMException('Superseded by new audio playback', 'AbortError'));
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

  if (activeObjectUrl && !activeObjectUrlIsCached) {
    try {
      URL.revokeObjectURL(activeObjectUrl);
    } catch {
      // Ignore URL revoke errors
    }
  }
  activeObjectUrl = null;
  activeObjectUrlIsCached = false;
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

  // Automatically invalidate in-memory and session cache entries on re-test so preview uses updated pronunciation logic
  invalidateCachedArabicAudio(sourceText, mode);

  let ttsText = '';
  let karaokeText = '';
  if (mode === 'word') {
    ttsText = stripFinalIrabForSpeech(sourceText, {
      wordType: options.wordType,
      partOfSpeech: options.partOfSpeech,
    });
    karaokeText = ttsText;
  } else if (mode === 'example') {
    ttsText = applySmartPartialTashkeel(sourceText);
    karaokeText = ttsText;
  } else {
    ttsText = applySmartPartialTashkeel(sourceText);
    karaokeText = stripTashkeel(sourceText).replace(/\s+/g, ' ').trim();
  }

  if (!ttsText || typeof window === 'undefined') {
    options.onEnd?.();
    return false;
  }

  const normalizedCacheKey = buildNormalizedTtsCacheKey(mode, ttsText.slice(0, 900));

  console.info('[Qalam Audio] Spoken text & source details:', {
    mode,
    sourceText,
    ttsText,
    cacheKey: normalizedCacheKey,
  });

  // Prevent duplicate parallel requests if audio for this exact normalized word/phrase is already loading
  if (activeLoadingCacheKey === normalizedCacheKey && inFlightTtsRequests.has(normalizedCacheKey)) {
    console.info('[Qalam Audio] Audio request already in flight for this text; ignoring duplicate click.');
    return true;
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
  activeLoadingCacheKey = null;

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
    if (activeLoadingCacheKey === normalizedCacheKey) {
      activeLoadingCacheKey = null;
    }
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
    contentType: string,
    cachedBlobUrl?: string
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

    // Fallback to cached or ephemeral Blob URL HTMLAudioElement if AudioContext decoding fails
    const objectUrl =
      cachedBlobUrl ||
      URL.createObjectURL(new Blob([audioBuffer], { type: contentType || 'audio/wav' }));
    activeObjectUrl = objectUrl;
    activeObjectUrlIsCached = Boolean(cachedBlobUrl);

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

  const splitArabicForPublicTts = (raw: string, maxLen = 165): string[] => {
    const clean = raw.replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLen) return clean ? [clean] : [];
    const chunks: string[] = [];
    let remaining = clean;
    while (remaining.length > maxLen) {
      let cut = -1;
      for (const sep of ['.', '؟', '!', '؛', '،', ' ']) {
        const idx = remaining.lastIndexOf(sep, maxLen);
        if (idx > Math.floor(maxLen * 0.45)) {
          cut = idx + 1;
          break;
        }
      }
      if (cut <= 0) cut = maxLen;
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  };

  const playPublicWebTtsFallback = async (): Promise<boolean> => {
    if (currentSpeechSession !== sessionId) return false;
    const chunks = splitArabicForPublicTts(ttsText.slice(0, 500), 165);
    if (chunks.length === 0) return false;

    const firstChunk = chunks[0];
    const playChunk = (chunkText: string, isFirstChunk: boolean): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        if (currentSpeechSession !== sessionId) {
          resolve(false);
          return;
        }
        const directUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunkText)}&tl=ar&client=tw-ob`;
        try {
          const audio = new Audio(directUrl);
          audio.setAttribute('referrerpolicy', 'no-referrer');
          audio.preload = 'auto';
          audio.playbackRate = Math.max(0.68, Math.min(1.4, effectiveRate));
          activeAudioElement = audio;

          let settled = false;
          let started = false;
          const clearTimer = () => {
            if (publicTtsTimeoutTimer !== null) {
              window.clearTimeout(publicTtsTimeoutTimer);
              publicTtsTimeoutTimer = null;
            }
          };

          const failChunk = (reason: string) => {
            if (settled) return;
            settled = true;
            clearTimer();
            try {
              audio.onplay = null;
              audio.onended = null;
              audio.onerror = null;
              audio.pause();
            } catch {
              // Ignore
            }
            if (activeAudioElement === audio) {
              activeAudioElement = null;
            }
            console.info(`[Qalam Audio] Public web TTS unavailable (${reason}); advancing fallback.`);
            resolve(false);
          };

          publicTtsTimeoutTimer = window.setTimeout(() => {
            if (!started) {
              failChunk('load timeout');
            }
          }, 2600);

          audio.onplay = () => {
            if (currentSpeechSession !== sessionId) {
              failChunk('session cancelled');
              return;
            }
            started = true;
            clearTimer();
            if (isFirstChunk) {
              options.onStart?.();
            }
          };

          audio.onended = () => {
            if (settled) return;
            settled = true;
            clearTimer();
            resolve(true);
          };

          audio.onerror = () => {
            failChunk('stream blocked or HTTP error');
          };

          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => {
              failChunk(err instanceof Error ? err.message : 'play() rejected');
            });
          }
        } catch (err) {
          resolve(false);
          console.info('[Qalam Audio] Public web TTS init failed:', err);
        }
      });

    const firstOk = await playChunk(firstChunk, true);
    if (!firstOk) return false;
    if (currentSpeechSession !== sessionId) return true;

    for (let i = 1; i < chunks.length; i++) {
      if (currentSpeechSession !== sessionId) return true;
      const nextOk = await playChunk(chunks[i], false);
      if (!nextOk) break;
    }

    finalize();
    return true;
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
      if (/PROXY_GENERATION_DISABLED|generateContent is not supported|401|403|API_KEY_SERVICE_BLOCKED|API keys are not supported/i.test(errText)) {
        geminiDiag = 'Gemini audio model disabled by environment / proxy; using web TTS fallback.';
        console.info('[Qalam Audio]', geminiDiag);
        setClientGeminiCooldown(24 * 3600 * 1000, geminiDiag);
      } else {
        console.warn(
          `[Qalam Audio] Gemini TTS failed (HTTP ${geminiRes.status} ${geminiRes.statusText}):`,
          errText
        );
      }
      if (geminiRes.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(errText)) {
        const quota = parseGeminiQuotaInfo(errText, 'audio');
        geminiDiag = quota.userMessage;
        setClientGeminiCooldown(quota.cooldownMs, quota.userMessage);
        notifyGeminiQuotaNotice(quota.userMessage);
      } else if (
        geminiRes.status === 401 ||
        geminiRes.status === 403 ||
        /API_KEY_INVALID|PERMISSION_DENIED|API_KEY_SERVICE_BLOCKED|API keys are not supported|PROXY_GENERATION_DISABLED/i.test(errText)
      ) {
        geminiDiag = `Gemini audio model restricted or disabled (HTTP ${geminiRes.status})`;
        setClientGeminiCooldown(24 * 3600 * 1000, geminiDiag);
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

  const requestAiAudioOrServerCache = async (
    cleanForUrl: string,
    cacheKey: string
  ): Promise<{ buffer: ArrayBuffer; contentType: string } | null> => {
    const existingInFlight = inFlightTtsRequests.get(cacheKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const requestPromise = (async (): Promise<{
      buffer: ArrayBuffer;
      contentType: string;
    } | null> => {
      const genController = new AbortController();
      const genTimeoutMs = mode === 'word' ? 15000 : mode === 'example' ? 20000 : 25000;
      const genTimer = window.setTimeout(
        () => genController.abort(new DOMException('Audio request timed out', 'TimeoutError')),
        genTimeoutMs
      );

      try {
        // 1. Try backend `/api/tts` first if running on full-stack Node host (non-static)
        if (!isStaticApiTtsUnavailable()) {
          try {
            const params = new URLSearchParams({
              q: cleanForUrl,
              mode,
              style: prosody.style,
            });
            const res = await fetch(`/api/tts?${params.toString()}`, {
              signal: genController.signal,
            });
            const ct = (res.headers.get('content-type') || '').toLowerCase();

            if (res.ok && ct.startsWith('audio/')) {
              const buf = await res.arrayBuffer();
              if (buf.byteLength > 100) {
                return { buffer: buf, contentType: ct };
              }
            } else if (res.status === 404 || res.status === 405 || !ct.startsWith('audio/')) {
              markStaticApiTtsUnavailable();
            }
          } catch (serverErr) {
            const errName = (serverErr as Error)?.name;
            if (errName !== 'AbortError' && errName !== 'TimeoutError') {
              console.info(
                '[Qalam Audio] /api/tts unavailable:',
                serverErr instanceof Error ? serverErr.message : serverErr
              );
            }
          }
        }

        // 2. Direct Gemini TTS when VITE_GEMINI_API_KEY is present and not cooling down
        const clientGeminiKey = getClientViteGeminiApiKey();
        if (!clientGeminiKey) {
          geminiDiag = 'VITE_GEMINI_API_KEY is missing in environment';
          return null;
        }

        const cooldownUntil = getClientGeminiCooldownUntil();
        if (Date.now() < cooldownUntil) {
          const secsLeft = Math.max(5, Math.ceil((cooldownUntil - Date.now()) / 1000));
          geminiDiag =
            secsLeft <= 120
              ? `Free audio quota is temporarily cooling down — please retry in ~${secsLeft} seconds.`
              : getClientGeminiRejectedReason() ||
                'Free audio quota is temporarily cooling down — please retry in 30–60 seconds.';
          return null;
        }

        try {
          const geminiAudio = await requestGeminiTtsAudio(
            clientGeminiKey,
            cleanForUrl,
            genController.signal
          );
          if (geminiAudio) {
            return geminiAudio;
          }
        } catch (geminiErr) {
          if ((geminiErr as Error)?.name === 'AbortError') {
            geminiDiag = `Direct Gemini TTS timed out after ${genTimeoutMs}ms`;
          } else {
            geminiDiag = `Direct Gemini TTS network error (${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)})`;
          }
          console.warn(`[Qalam Audio] ${geminiDiag}`);
        }

        return null;
      } finally {
        window.clearTimeout(genTimer);
      }
    })();

    inFlightTtsRequests.set(cacheKey, requestPromise);
    try {
      const clip = await requestPromise;
      // Persist immediately on generation even if user navigated away so Gemini quota is never wasted twice
      if (clip) {
        setClientTtsCache(cacheKey, clip);
        setPersistentTtsCache(cacheKey, clip.buffer, clip.contentType);
      }
      return clip;
    } finally {
      inFlightTtsRequests.delete(cacheKey);
    }
  };

  const runAudioPlaybackChain = async () => {
    if (currentSpeechSession !== sessionId) return;

    const cleanForUrl = ttsText.slice(0, 900);
    const cacheKey = normalizedCacheKey;

    // 1. Check normalized cache (memory base64/blob URL -> localStorage/sessionStorage base64) FIRST
    const memCached = clientTtsAudioCache.get(cacheKey);
    if (memCached) {
      try {
        await playAudioBufferThroughContext(
          memCached.buffer,
          memCached.contentType,
          memCached.blobUrl
        );
        return;
      } catch (err) {
        console.warn('[Qalam Audio] Cached memory clip failed, clearing:', err);
        try {
          URL.revokeObjectURL(memCached.blobUrl);
        } catch {
          // Ignore
        }
        clientTtsAudioCache.delete(cacheKey);
      }
    }

    const persistentCached = getPersistentTtsCache(cacheKey);
    if (persistentCached) {
      const promoted = setClientTtsCache(cacheKey, persistentCached);
      try {
        await playAudioBufferThroughContext(
          promoted.buffer,
          promoted.contentType,
          promoted.blobUrl
        );
        return;
      } catch (err) {
        console.warn('[Qalam Audio] Persistent cached clip failed:', err);
        clientTtsAudioCache.delete(cacheKey);
      }
    }

    // 2. If browser speechSynthesis has a genuine Arabic (ar-*) voice, use it directly (0 Gemini quota spent)
    const voiceInfo = resolveArabicVoiceInfo();
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

    const continueAfterBrowserVoiceUnavailable = async () => {
      if (currentSpeechSession !== sessionId) return;

      if (!isOnline) {
        geminiDiag = 'Browser appears offline (navigator.onLine === false)';
        failAndNotify();
        return;
      }

      activeLoadingCacheKey = cacheKey;
      options.onLoading?.();

      // 3. When window.speechSynthesis has no ar-* voice (or failed), try free public web TTS fallback BEFORE Gemini audio
      const publicPlayed = await playPublicWebTtsFallback();
      if (publicPlayed || currentSpeechSession !== sessionId) {
        if (activeLoadingCacheKey === cacheKey) {
          activeLoadingCacheKey = null;
        }
        return;
      }

      // 4. Fallback to Gemini TTS (or server cache) and cache result by normalized Arabic text
      const fetchedClip = await requestAiAudioOrServerCache(cleanForUrl, cacheKey);
      if (activeLoadingCacheKey === cacheKey) {
        activeLoadingCacheKey = null;
      }
      if (currentSpeechSession !== sessionId) return;

      if (fetchedClip) {
        const stored = setClientTtsCache(cacheKey, fetchedClip);
        await playAudioBufferThroughContext(stored.buffer, stored.contentType, stored.blobUrl);
        return;
      }

      // 5. Last resort if speechSynthesis had 0 loaded voices initially: try ar-SA speechSynthesis once
      if (!voiceInfo.hasArabicVoice && voiceInfo.totalVoices === 0) {
        const lastResortStarted = tryBrowserSpeechSynthesis(() => {
          const cooldownReason =
            geminiDiag.toLowerCase().includes('cooling down') ||
            geminiDiag.toLowerCase().includes('quota') ||
            geminiDiag.toLowerCase().includes('429')
              ? geminiDiag
              : undefined;
          failAndNotify(cooldownReason);
        });
        if (lastResortStarted) return;
      }

      // Calm notice if Gemini quota is cooling down, otherwise gentle fallback message
      const cooldownReason =
        geminiDiag.toLowerCase().includes('cooling down') ||
        geminiDiag.toLowerCase().includes('quota') ||
        geminiDiag.toLowerCase().includes('429')
          ? geminiDiag
          : undefined;
      failAndNotify(cooldownReason);
    };

    if (voiceInfo.hasArabicVoice && voiceInfo.voice) {
      const startedSpeech = tryBrowserSpeechSynthesis(() => {
        void continueAfterBrowserVoiceUnavailable();
      }, true);
      if (startedSpeech) return;
    }

    await continueAfterBrowserVoiceUnavailable();
  };

  void runAudioPlaybackChain();
  return true;
}

export function stopArabicSpeech(): void {
  currentSpeechSession += 1;
  activeLoadingCacheKey = null;
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

