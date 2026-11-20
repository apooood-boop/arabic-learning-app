import type { ArabicFontStyle, ProficiencyLevel, TranscriptSegment } from '../types/arabic.ts';

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

export const TTS_UNSUPPORTED_MESSAGE_AR =
  'متصفحك لا يدعم النطق العربي حالياً؛ جرّب متصفح Chrome أو Edge أو فعّل أصوات العربية في إعدادات جهازك';

export interface SpeakArabicOptions {
  rate?: number;
  onStart?: () => void;
  onBoundary?: (charIndex: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
  onUnsupportedNotice?: (message: string) => void;
}

let cachedVoices: SpeechSynthesisVoice[] = [];
let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeAudioElement: HTMLAudioElement | null = null;
let pendingSpeakTimer: number | null = null;
let startWatchdogTimer: number | null = null;
let safetyEndTimer: number | null = null;
let currentSpeechSession = 0;
let activeEndCallback: (() => void) | null = null;

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

function resolveArabicVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    cachedVoices = voices;
  }
  const pool = voices.length > 0 ? voices : cachedVoices;
  return (
    pool.find((v) => v.lang.toLowerCase() === 'ar-sa') ??
    pool.find((v) => v.lang.toLowerCase().startsWith('ar'))
  );
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
}

function releaseActiveAudio() {
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
}

function notifyTtsUnsupported(options?: SpeakArabicOptions) {
  options?.onUnsupportedNotice?.(TTS_UNSUPPORTED_MESSAGE_AR);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('qalam:tts-notice', { detail: { message: TTS_UNSUPPORTED_MESSAGE_AR } })
    );
  }
}

export function speakArabic(
  text: string,
  optionsOrRate: SpeakArabicOptions | number = {}
): boolean {
  const options: SpeakArabicOptions =
    typeof optionsOrRate === 'number' ? { rate: optionsOrRate } : optionsOrRate;

  const rate = options.rate ?? 0.92;
  const cleanDisplay = text.trim();
  const ttsText = stripTashkeel(cleanDisplay).replace(/\s+/g, ' ').trim();

  if (!ttsText || typeof window === 'undefined') {
    options.onEnd?.();
    return false;
  }

  currentSpeechSession += 1;
  const sessionId = currentSpeechSession;

  clearSpeechTimers();
  releaseActiveAudio();

  if (activeEndCallback) {
    const prevEnd = activeEndCallback;
    activeEndCallback = null;
    prevEnd();
  }

  if ('speechSynthesis' in window) {
    try {
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

  const failAndNotify = () => {
    if (currentSpeechSession !== sessionId) return;
    notifyTtsUnsupported(options);
    options.onError?.(TTS_UNSUPPORTED_MESSAGE_AR);
    finalize();
  };

  const playAudioFallback = (attemptDirectGoogle = false) => {
    if (currentSpeechSession !== sessionId) return;
    clearSpeechTimers();
    releaseActiveAudio();

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }

    const encoded = encodeURIComponent(ttsText.slice(0, 900));
    const url = attemptDirectGoogle
      ? `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(ttsText.slice(0, 180))}&tl=ar&client=tw-ob`
      : `/api/tts?q=${encoded}`;

    try {
      const audio = new Audio(url);
      audio.playbackRate = Math.max(0.65, Math.min(1.5, rate));
      activeAudioElement = audio;
      let started = false;

      audio.onplay = () => {
        if (currentSpeechSession !== sessionId) return;
        started = true;
        options.onStart?.();
      };

      audio.ontimeupdate = () => {
        if (currentSpeechSession !== sessionId) return;
        if (audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
          const progress = Math.max(0, Math.min(1, audio.currentTime / audio.duration));
          const approxCharIndex = Math.floor(progress * ttsText.length);
          options.onBoundary?.(approxCharIndex);
        }
      };

      audio.onended = () => {
        finalize();
      };

      audio.onerror = () => {
        if (currentSpeechSession !== sessionId) return;
        if (!attemptDirectGoogle) {
          playAudioFallback(true);
        } else {
          failAndNotify();
        }
      };

      // Optimistic start indicator so button responds immediately
      options.onStart?.();

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          if (currentSpeechSession !== sessionId) return;
          if (!started && !attemptDirectGoogle) {
            playAudioFallback(true);
          } else if (!started) {
            failAndNotify();
          }
        });
      }

      const estimatedMs = Math.max(
        2500,
        Math.min(20000, (ttsText.length * 165) / Math.max(0.5, rate))
      );
      safetyEndTimer = window.setTimeout(finalize, estimatedMs);
    } catch {
      if (!attemptDirectGoogle) {
        playAudioFallback(true);
      } else {
        failAndNotify();
      }
    }
  };

  const hasSpeechApi = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const arabicVoice = hasSpeechApi ? resolveArabicVoice() : undefined;

  if (!hasSpeechApi || !arabicVoice) {
    playAudioFallback(false);
    return true;
  }

  try {
    const utterance = new SpeechSynthesisUtterance(ttsText);
    utterance.lang = 'ar-SA';
    utterance.voice = arabicVoice;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;

    activeUtterance = utterance;
    let speechStarted = false;

    utterance.onstart = () => {
      if (currentSpeechSession !== sessionId) return;
      speechStarted = true;
      if (startWatchdogTimer !== null) {
        window.clearTimeout(startWatchdogTimer);
        startWatchdogTimer = null;
      }
      options.onStart?.();
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

    utterance.onerror = () => {
      if (currentSpeechSession !== sessionId) return;
      activeUtterance = null;
      // Seamless fallback to MP3 stream if browser speech fails
      playAudioFallback(false);
    };

    options.onStart?.();

    pendingSpeakTimer = window.setTimeout(() => {
      if (currentSpeechSession !== sessionId) return;
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.speak(utterance);

      // If browser silently drops utterance without firing onstart within 550ms, use Audio fallback
      startWatchdogTimer = window.setTimeout(() => {
        if (currentSpeechSession !== sessionId || speechStarted) return;
        activeUtterance = null;
        playAudioFallback(false);
      }, 550);

      const estimatedMs = Math.max(
        2500,
        Math.min(18000, (ttsText.length * 165) / Math.max(0.5, rate))
      );
      safetyEndTimer = window.setTimeout(finalize, estimatedMs);
    }, 35);

    return true;
  } catch {
    playAudioFallback(false);
    return true;
  }
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

