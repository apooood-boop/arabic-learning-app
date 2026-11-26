import { enrichWordMeta, lookupFallbackWord } from '../data/fallbackLexicon';
import {
  AuthUser,
  ProficiencyLevel,
  SentencePair,
  VocabCard,
  WordAnalysis,
} from '../types/arabic';
import {
  applySmartPartialTashkeel,
  countArabicWords,
  formatMinimalArabicRoot,
  inferArabicWordType,
  invalidateCachedArabicAudio,
  normalizeArabicWord,
  normalizeStandaloneArabicKey,
  normalizeStandaloneVocabWord,
  stripFinalIrabForSpeech,
  stripTashkeel,
} from './arabic';
import { analyzeArabicWordClient, isFakePlaceholderTranslation } from './geminiClient';
import { isSupabaseConfigured } from './supabaseClient';
import { upsertVocabCardsToCloudWithResult } from './supabaseSync';

export type VocabRepairField = 'translation' | 'examples' | 'root' | 'partOfSpeech';

export interface TranslationRepairRetryItem {
  cardId: string;
  word: string;
  reason: string;
}

export interface TranslationRepairFixedItem {
  cardId: string;
  word: string;
  englishMeaning: string;
  source: string;
  repairedFields?: VocabRepairField[];
}

export interface TranslationRepairProgress {
  total: number;
  completed: number;
  currentWord: string;
  fixedCount: number;
  retryCount: number;
  phase: 'translating' | 'syncing';
}

export interface TranslationRepairBreakdown {
  translations: number;
  examples: number;
  roots: number;
  partsOfSpeech: number;
}

export interface TranslationRepairSummary {
  repairedAt: number;
  scannedCount: number;
  affectedCount: number;
  fixedCount: number;
  retryCount: number;
  fixedBreakdown?: TranslationRepairBreakdown;
  fixedWords: TranslationRepairFixedItem[];
  retryItems: TranslationRepairRetryItem[];
  supabaseAttempted: boolean;
  supabaseSynced: boolean;
  supabaseSyncedCount: number;
  supabaseError?: string;
}

const VALID_ARABIC_WORD_TYPES = new Set(['اسم', 'فعل', 'حرف', 'ظرف', 'صفة', 'ضمير']);
const GENERIC_POS_REGEX = /^(word|vocabulary|translation|meaning|unknown|n\/a|none|—|-)$/i;
const PLACEHOLDER_EXAMPLE_REGEX =
  /temporarily busy|مشغولة مؤقتًا|translation pending|pending translation|original sentence from your|from your beginner reading passage/i;

export function isCardMissingOrPlaceholderTranslation(
  card:
    | (Pick<VocabCard, 'englishMeaning'> & Partial<Pick<VocabCard, 'word' | 'wordWithTashkeel'>>)
    | null
    | undefined
): boolean {
  if (!card) return false;
  const meaning = card.englishMeaning?.trim() || '';
  if (!meaning) return true;
  if (isFakePlaceholderTranslation({ englishMeaning: meaning })) return true;

  if (
    /^translation pending/i.test(meaning) ||
    /tap translate or edit/i.test(meaning) ||
    /^pending translation/i.test(meaning) ||
    /^meaning unavailable/i.test(meaning) ||
    /^no translation/i.test(meaning) ||
    /^untranslated$/i.test(meaning) ||
    GENERIC_POS_REGEX.test(meaning) ||
    meaning === '...'
  ) {
    return true;
  }

  // Flag untranslated Arabic-only text or exact Arabic copy in englishMeaning
  const hasArabic = /[\u0600-\u06FF]/.test(meaning);
  const hasEnglishLetters = /[a-zA-Z]{2,}/.test(meaning);
  if (hasArabic && !hasEnglishLetters) {
    return true;
  }

  const arabicWord = stripTashkeel(card.wordWithTashkeel || card.word || '').trim();
  if (arabicWord && stripTashkeel(meaning) === arabicWord) {
    return true;
  }

  return false;
}

export function isExampleSentenceComplete(ex: Partial<SentencePair> | null | undefined): boolean {
  if (!ex) return false;
  const arabic = (ex.arabic || '').trim();
  const english = (ex.english || '').trim();
  if (!arabic || !english) return false;
  if (!/[\u0600-\u06FF]/.test(arabic)) return false;
  if (!/[a-zA-Z]{2,}/.test(english)) return false;
  if (PLACEHOLDER_EXAMPLE_REGEX.test(english) || PLACEHOLDER_EXAMPLE_REGEX.test(arabic)) {
    return false;
  }
  return true;
}

export function getVocabCardRepairIssues(card: VocabCard | null | undefined): VocabRepairField[] {
  if (!card) return [];
  const issues: VocabRepairField[] = [];

  if (isCardMissingOrPlaceholderTranslation(card)) {
    issues.push('translation');
  }

  const validExamples = Array.isArray(card.examples)
    ? card.examples.filter((ex) => isExampleSentenceComplete(ex))
    : [];
  if (validExamples.length === 0 || (!card.hasCustomEdits && validExamples.length < 2)) {
    issues.push('examples');
  }

  const effectiveWordType = inferArabicWordType(card.wordType || card.partOfSpeech);
  const wordCount = countArabicWords(card.wordWithTashkeel || card.word || '');
  const expectsRoot =
    effectiveWordType !== 'حرف' && effectiveWordType !== 'ضمير' && wordCount <= 1;
  if (expectsRoot && !formatMinimalArabicRoot(card.root)) {
    issues.push('root');
  }

  const rawWordType = stripTashkeel((card.wordType || '').trim());
  const hasValidWordType = Boolean(rawWordType && VALID_ARABIC_WORD_TYPES.has(rawWordType));
  const rawPos = (card.partOfSpeech || '').trim();
  const hasValidPos = Boolean(rawPos && !GENERIC_POS_REGEX.test(rawPos));
  if (!hasValidWordType || !hasValidPos) {
    issues.push('partOfSpeech');
  }

  return issues;
}

export function isCardNeedingRepair(card: VocabCard | null | undefined): boolean {
  return getVocabCardRepairIssues(card).length > 0;
}

export function filterCardsOwnedByUser(
  cards: VocabCard[],
  activeUser: AuthUser | null,
  allowedUserIds?: string[]
): VocabCard[] {
  if (!activeUser || activeUser.isGuest) return [];
  const validIds = new Set(
    [activeUser.id, ...(allowedUserIds || [])].filter(
      (id): id is string => Boolean(id && id !== 'guest-demo')
    )
  );
  return cards.filter((card) => !card.userId || validIds.has(card.userId));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function resolveTargetLevel(card: VocabCard): ProficiencyLevel {
  if (
    card.level === 'beginner' ||
    card.level === 'intermediate' ||
    card.level === 'advanced'
  ) {
    return card.level;
  }
  return 'intermediate';
}

function mergeRepairedExamples(
  existing: SentencePair[] | undefined,
  incoming: SentencePair[] | undefined
): SentencePair[] {
  const cleanExisting = Array.isArray(existing)
    ? existing.filter((ex) => isExampleSentenceComplete(ex))
    : [];
  const cleanIncoming = Array.isArray(incoming)
    ? incoming.filter((ex) => isExampleSentenceComplete(ex))
    : [];

  if (cleanIncoming.length === 0) {
    return cleanExisting.length > 0 ? cleanExisting : Array.isArray(existing) ? existing : [];
  }

  const seenArabic = new Set<string>();
  const merged: SentencePair[] = [];

  for (const ex of [...cleanExisting, ...cleanIncoming]) {
    const key = stripTashkeel(ex.arabic).replace(/\s+/g, ' ').trim();
    if (!key || seenArabic.has(key)) continue;
    seenArabic.add(key);
    merged.push({
      arabic: applySmartPartialTashkeel(ex.arabic.trim()),
      english: ex.english.trim(),
      contextLabel: ex.contextLabel?.trim(),
    });
    if (merged.length >= 2) break;
  }

  return merged.length > 0 ? merged : cleanIncoming.slice(0, 2);
}

export async function repairMissingCardTranslations(params: {
  activeUser: AuthUser | null;
  cards: VocabCard[];
  allowedUserIds?: string[];
  enforceUserOwnership?: boolean;
  analysisCache?: Record<string, WordAnalysis>;
  onCardsRepaired: (nextCards: VocabCard[]) => void;
  onAnalysisCacheRepaired?: (nextCache: Record<string, WordAnalysis>) => void;
  onProgress?: (progress: TranslationRepairProgress) => void;
}): Promise<{ nextCards: VocabCard[]; summary: TranslationRepairSummary }> {
  const safeCards = Array.isArray(params.cards) ? params.cards : [];

  if (params.enforceUserOwnership && (!params.activeUser || params.activeUser.isGuest)) {
    return {
      nextCards: safeCards,
      summary: {
        repairedAt: Date.now(),
        scannedCount: 0,
        affectedCount: 0,
        fixedCount: 0,
        retryCount: 0,
        fixedBreakdown: { translations: 0, examples: 0, roots: 0, partsOfSpeech: 0 },
        fixedWords: [],
        retryItems: [],
        supabaseAttempted: false,
        supabaseSynced: false,
        supabaseSyncedCount: 0,
        supabaseError: 'Sign in with a personal account to repair and sync your flashcards.',
      },
    };
  }

  const scopedCards =
    params.activeUser && !params.activeUser.isGuest
      ? filterCardsOwnedByUser(safeCards, params.activeUser, params.allowedUserIds)
      : safeCards;

  const affectedEntries = scopedCards
    .map((card) => ({ card, issues: getVocabCardRepairIssues(card) }))
    .filter((entry) => entry.issues.length > 0);

  if (affectedEntries.length === 0) {
    const emptySummary: TranslationRepairSummary = {
      repairedAt: Date.now(),
      scannedCount: scopedCards.length,
      affectedCount: 0,
      fixedCount: 0,
      retryCount: 0,
      fixedBreakdown: { translations: 0, examples: 0, roots: 0, partsOfSpeech: 0 },
      fixedWords: [],
      retryItems: [],
      supabaseAttempted: false,
      supabaseSynced: false,
      supabaseSyncedCount: 0,
    };
    return { nextCards: safeCards, summary: emptySummary };
  }

  const repairedById = new Map<string, VocabCard>();
  const fixedWords: TranslationRepairFixedItem[] = [];
  const retryItems: TranslationRepairRetryItem[] = [];
  const breakdown: TranslationRepairBreakdown = {
    translations: 0,
    examples: 0,
    roots: 0,
    partsOfSpeech: 0,
  };

  const nextAnalysisCache: Record<string, WordAnalysis> = {};
  for (const [k, v] of Object.entries(params.analysisCache || {})) {
    if (!isFakePlaceholderTranslation(v)) {
      nextAnalysisCache[k] = v;
    }
  }
  let cacheTouched =
    Object.keys(nextAnalysisCache).length !==
    Object.keys(params.analysisCache || {}).length;

  for (let i = 0; i < affectedEntries.length; i += 1) {
    const { card, issues } = affectedEntries[i];
    const displayWord = (card.wordWithTashkeel || card.word || '').trim();

    params.onProgress?.({
      total: affectedEntries.length,
      completed: i,
      currentWord: displayWord,
      fixedCount: fixedWords.length,
      retryCount: retryItems.length,
      phase: 'translating',
    });

    if (!displayWord) {
      retryItems.push({
        cardId: card.id,
        word: '(empty)',
        reason: 'Card has no Arabic word text.',
      });
      continue;
    }

    if (i > 0) {
      await delay(140);
    }

    const contextSentence =
      card.examples?.find((ex) => ex?.arabic?.trim())?.arabic?.trim() || displayWord;
    const targetLevel = resolveTargetLevel(card);

    try {
      const analysis = await analyzeArabicWordClient({
        word: displayWord,
        contextSentence,
        level: targetLevel,
        bypassCache: true,
      });

      const lexiconMatch = lookupFallbackWord(
        displayWord,
        contextSentence,
        undefined,
        targetLevel
      );
      const isGeminiValid = !isFakePlaceholderTranslation(analysis);

      // 1. Translation
      const needsTranslation = issues.includes('translation');
      let nextMeaning = card.englishMeaning;
      let fixedTranslation = false;

      if (needsTranslation) {
        const candidateMeaning = isGeminiValid
          ? analysis.englishMeaning.trim()
          : lexiconMatch && !isFakePlaceholderTranslation(lexiconMatch)
            ? lexiconMatch.englishMeaning.trim()
            : '';

        if (
          candidateMeaning &&
          !isCardMissingOrPlaceholderTranslation({
            englishMeaning: candidateMeaning,
            word: card.word,
            wordWithTashkeel: card.wordWithTashkeel,
          })
        ) {
          nextMeaning = candidateMeaning;
          fixedTranslation = true;
        }
      }

      // 2. Part of Speech & Arabic Word Type (نوع الكلمة)
      const needsPos = issues.includes('partOfSpeech');
      const candidatePos =
        (isGeminiValid ? analysis.partOfSpeech?.trim() : '') ||
        lexiconMatch?.partOfSpeech?.trim() ||
        '';
      const currentPosValid =
        Boolean(card.partOfSpeech?.trim()) && !GENERIC_POS_REGEX.test(card.partOfSpeech.trim());
      const nextPartOfSpeech =
        currentPosValid && (card.hasCustomEdits || !needsPos)
          ? card.partOfSpeech
          : candidatePos && !GENERIC_POS_REGEX.test(candidatePos)
            ? candidatePos
            : card.partOfSpeech || 'Noun';

      const currentWordTypeClean = stripTashkeel((card.wordType || '').trim());
      const currentWordTypeValid = Boolean(
        currentWordTypeClean && VALID_ARABIC_WORD_TYPES.has(currentWordTypeClean)
      );
      const enrichedMeta = enrichWordMeta(
        displayWord,
        nextPartOfSpeech,
        currentWordTypeValid ? card.wordType : analysis.wordType || lexiconMatch?.wordType,
        card.root || analysis.root || lexiconMatch?.root
      );
      const nextWordType = currentWordTypeValid
        ? currentWordTypeClean
        : inferArabicWordType(
            analysis.wordType || lexiconMatch?.wordType || enrichedMeta.wordType || nextPartOfSpeech
          );
      const fixedPos =
        needsPos &&
        VALID_ARABIC_WORD_TYPES.has(stripTashkeel(nextWordType)) &&
        !GENERIC_POS_REGEX.test(nextPartOfSpeech);

      // 3. Arabic Root (الجذر)
      const needsRoot = issues.includes('root');
      const existingRoot = formatMinimalArabicRoot(card.root);
      const candidateRoot =
        formatMinimalArabicRoot(analysis.root) ||
        formatMinimalArabicRoot(lexiconMatch?.root) ||
        formatMinimalArabicRoot(enrichedMeta.root);
      const nextRoot = existingRoot || candidateRoot || card.root || '';
      const fixedRoot = needsRoot && Boolean(formatMinimalArabicRoot(nextRoot));

      // 4. Contextual Examples
      const needsExamples = issues.includes('examples');
      const candidateExamplesSource =
        isGeminiValid && Array.isArray(analysis.examples) && analysis.examples.length > 0
          ? analysis.examples
          : lexiconMatch?.examples;
      const nextExamples = needsExamples
        ? mergeRepairedExamples(card.examples, candidateExamplesSource)
        : card.examples;
      const beforeValidCount = Array.isArray(card.examples)
        ? card.examples.filter((ex) => isExampleSentenceComplete(ex)).length
        : 0;
      const afterValidCount = Array.isArray(nextExamples)
        ? nextExamples.filter((ex) => isExampleSentenceComplete(ex)).length
        : 0;
      const fixedExamples = needsExamples && afterValidCount > beforeValidCount;

      const repairedFields: VocabRepairField[] = [];
      if (fixedTranslation) {
        repairedFields.push('translation');
        breakdown.translations += 1;
      }
      if (fixedExamples) {
        repairedFields.push('examples');
        breakdown.examples += 1;
      }
      if (fixedRoot) {
        repairedFields.push('root');
        breakdown.roots += 1;
      }
      if (fixedPos) {
        repairedFields.push('partOfSpeech');
        breakdown.partsOfSpeech += 1;
      }

      if (repairedFields.length === 0) {
        retryItems.push({
          cardId: card.id,
          word: displayWord,
          reason:
            analysis.notice ||
            'Translation service temporarily busy — tap Retry to try again.',
        });
        continue;
      }

      const rawTashkeel =
        !card.hasCustomEdits && analysis.wordWithTashkeel?.trim()
          ? applySmartPartialTashkeel(
              normalizeStandaloneVocabWord(analysis.wordWithTashkeel, {
                wordType: nextWordType,
                partOfSpeech: nextPartOfSpeech,
              }) || analysis.wordWithTashkeel
            )
          : card.wordWithTashkeel;

      const nextWordWithTashkeel = rawTashkeel || card.wordWithTashkeel;
      const nextWord = card.hasCustomEdits
        ? card.word
        : stripTashkeel(nextWordWithTashkeel) || card.word;
      const nextKey = card.hasCustomEdits
        ? card.normalizedKey
        : normalizeStandaloneArabicKey(nextWordWithTashkeel) || card.normalizedKey;
      const nextVocalized = card.hasCustomEdits
        ? card.vocalizedWord
        : analysis.vocalizedWord?.trim() ||
          stripFinalIrabForSpeech(nextWordWithTashkeel, {
            wordType: nextWordType,
            partOfSpeech: nextPartOfSpeech,
          });

      if (nextWordWithTashkeel !== card.wordWithTashkeel) {
        invalidateCachedArabicAudio(card.wordWithTashkeel, 'word');
      }

      const updatedCard: VocabCard = {
        ...card,
        userId:
          card.userId ||
          (params.activeUser && !params.activeUser.isGuest ? params.activeUser.id : undefined),
        word: nextWord,
        wordWithTashkeel: nextWordWithTashkeel,
        vocalizedWord: nextVocalized,
        normalizedKey: nextKey,
        englishMeaning: nextMeaning,
        transliteration:
          card.hasCustomEdits && card.transliteration?.trim()
            ? card.transliteration
            : analysis.transliteration?.trim() ||
              lexiconMatch?.transliteration?.trim() ||
              card.transliteration ||
              '',
        partOfSpeech: nextPartOfSpeech,
        wordType: nextWordType,
        root: formatMinimalArabicRoot(nextRoot) || nextRoot || undefined,
        examples: nextExamples,
      };

      repairedById.set(card.id, updatedCard);
      fixedWords.push({
        cardId: card.id,
        word: nextWordWithTashkeel,
        englishMeaning: nextMeaning,
        source: isGeminiValid ? analysis.source || 'gemini' : 'lexicon',
        repairedFields,
      });

      if (isGeminiValid) {
        const cacheWordKey = normalizeArabicWord(nextWordWithTashkeel);
        if (cacheWordKey) {
          nextAnalysisCache[cacheWordKey] = analysis;
          cacheTouched = true;
        }
      }

      // If translation itself failed even though another field improved, let user know retry is available
      if (needsTranslation && !fixedTranslation) {
        retryItems.push({
          cardId: card.id,
          word: displayWord,
          reason:
            analysis.notice ||
            'Updated partial metadata, but English translation still needs retry.',
        });
      }
    } catch (err) {
      retryItems.push({
        cardId: card.id,
        word: displayWord,
        reason:
          err instanceof Error
            ? err.message
            : 'Failed to repair card — tap Retry to try again.',
      });
    }
  }

  const fixedCards = Array.from(repairedById.values());
  const nextCards =
    fixedCards.length > 0
      ? safeCards.map((card) => repairedById.get(card.id) ?? card)
      : safeCards;

  if (fixedCards.length > 0) {
    params.onCardsRepaired(nextCards);
  }
  if (cacheTouched && params.onAnalysisCacheRepaired) {
    params.onAnalysisCacheRepaired(nextAnalysisCache);
  }

  let supabaseAttempted = false;
  let supabaseSynced = false;
  let supabaseSyncedCount = 0;
  let supabaseError: string | undefined;

  if (
    fixedCards.length > 0 &&
    params.activeUser &&
    !params.activeUser.isGuest &&
    isSupabaseConfigured()
  ) {
    supabaseAttempted = true;
    params.onProgress?.({
      total: affectedEntries.length,
      completed: affectedEntries.length,
      currentWord: '',
      fixedCount: fixedWords.length,
      retryCount: retryItems.length,
      phase: 'syncing',
    });

    const syncRes = await upsertVocabCardsToCloudWithResult(
      params.activeUser,
      fixedCards
    );
    supabaseSynced = syncRes.ok;
    supabaseSyncedCount = syncRes.syncedCount;
    supabaseError = syncRes.error;

    if (!syncRes.ok) {
      console.error('[Qalam Vocab Repair] Failed to sync repaired cards to Supabase:', syncRes.error);
    }
  }

  const summary: TranslationRepairSummary = {
    repairedAt: Date.now(),
    scannedCount: scopedCards.length,
    affectedCount: affectedEntries.length,
    fixedCount: fixedWords.length,
    retryCount: retryItems.length,
    fixedBreakdown: breakdown,
    fixedWords,
    retryItems,
    supabaseAttempted,
    supabaseSynced,
    supabaseSyncedCount,
    supabaseError,
  };

  return { nextCards, summary };
}
