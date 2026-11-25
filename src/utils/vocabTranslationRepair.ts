import { AuthUser, ProficiencyLevel, VocabCard, WordAnalysis } from '../types/arabic';
import {
  applySmartPartialTashkeel,
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
}

export interface TranslationRepairProgress {
  total: number;
  completed: number;
  currentWord: string;
  fixedCount: number;
  retryCount: number;
  phase: 'translating' | 'syncing';
}

export interface TranslationRepairSummary {
  repairedAt: number;
  scannedCount: number;
  affectedCount: number;
  fixedCount: number;
  retryCount: number;
  fixedWords: TranslationRepairFixedItem[];
  retryItems: TranslationRepairRetryItem[];
  supabaseAttempted: boolean;
  supabaseSynced: boolean;
  supabaseSyncedCount: number;
  supabaseError?: string;
}

export function isCardMissingOrPlaceholderTranslation(
  card: Pick<VocabCard, 'englishMeaning'> | null | undefined
): boolean {
  if (!card) return false;
  const meaning = card.englishMeaning?.trim() || '';
  if (!meaning) return true;
  if (isFakePlaceholderTranslation({ englishMeaning: meaning })) return true;

  return (
    /^translation pending/i.test(meaning) ||
    /tap translate or edit/i.test(meaning) ||
    /^pending translation/i.test(meaning) ||
    /^meaning unavailable/i.test(meaning) ||
    /^no translation/i.test(meaning) ||
    /^untranslated$/i.test(meaning) ||
    /^n\/a$/i.test(meaning) ||
    meaning === '—' ||
    meaning === '-' ||
    meaning === '...'
  );
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

export async function repairMissingCardTranslations(params: {
  activeUser: AuthUser | null;
  cards: VocabCard[];
  analysisCache?: Record<string, WordAnalysis>;
  onCardsRepaired: (nextCards: VocabCard[]) => void;
  onAnalysisCacheRepaired?: (nextCache: Record<string, WordAnalysis>) => void;
  onProgress?: (progress: TranslationRepairProgress) => void;
}): Promise<{ nextCards: VocabCard[]; summary: TranslationRepairSummary }> {
  const safeCards = Array.isArray(params.cards) ? params.cards : [];
  const affectedCards = safeCards.filter((card) =>
    isCardMissingOrPlaceholderTranslation(card)
  );

  if (affectedCards.length === 0) {
    const emptySummary: TranslationRepairSummary = {
      repairedAt: Date.now(),
      scannedCount: safeCards.length,
      affectedCount: 0,
      fixedCount: 0,
      retryCount: 0,
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

  const nextAnalysisCache: Record<string, WordAnalysis> = {};
  for (const [k, v] of Object.entries(params.analysisCache || {})) {
    if (!isFakePlaceholderTranslation(v)) {
      nextAnalysisCache[k] = v;
    }
  }
  let cacheTouched =
    Object.keys(nextAnalysisCache).length !==
    Object.keys(params.analysisCache || {}).length;

  for (let i = 0; i < affectedCards.length; i += 1) {
    const card = affectedCards[i];
    const displayWord = (card.wordWithTashkeel || card.word || '').trim();

    params.onProgress?.({
      total: affectedCards.length,
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
      await delay(120);
    }

    const contextSentence =
      card.examples?.find((ex) => ex?.arabic?.trim())?.arabic?.trim() || displayWord;

    try {
      const analysis = await analyzeArabicWordClient({
        word: displayWord,
        contextSentence,
        level: resolveTargetLevel(card),
      });

      const resolvedMeaning = analysis.englishMeaning?.trim() || '';
      if (!resolvedMeaning || isFakePlaceholderTranslation(analysis)) {
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
                wordType: analysis.wordType || card.wordType,
                partOfSpeech: analysis.partOfSpeech || card.partOfSpeech,
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
            wordType: analysis.wordType || card.wordType,
            partOfSpeech: analysis.partOfSpeech || card.partOfSpeech,
          });

      const hasValidExistingExamples =
        Array.isArray(card.examples) &&
        card.examples.some((ex) => ex?.arabic?.trim() && ex?.english?.trim());
      const nextExamples = hasValidExistingExamples
        ? card.examples
        : Array.isArray(analysis.examples) && analysis.examples.length > 0
          ? analysis.examples
          : card.examples;

      if (nextWordWithTashkeel !== card.wordWithTashkeel) {
        invalidateCachedArabicAudio(card.wordWithTashkeel, 'word');
      }

      const updatedCard: VocabCard = {
        ...card,
        word: nextWord,
        wordWithTashkeel: nextWordWithTashkeel,
        vocalizedWord: nextVocalized,
        normalizedKey: nextKey,
        englishMeaning: resolvedMeaning,
        transliteration:
          card.hasCustomEdits && card.transliteration?.trim()
            ? card.transliteration
            : analysis.transliteration?.trim() || card.transliteration || '',
        partOfSpeech:
          card.hasCustomEdits && card.partOfSpeech?.trim() && card.partOfSpeech !== 'Noun'
            ? card.partOfSpeech
            : analysis.partOfSpeech?.trim() || card.partOfSpeech || 'Noun',
        wordType: card.wordType || analysis.wordType,
        root: card.root || analysis.root,
        examples: nextExamples,
      };

      repairedById.set(card.id, updatedCard);
      fixedWords.push({
        cardId: card.id,
        word: nextWordWithTashkeel,
        englishMeaning: resolvedMeaning,
        source: analysis.source || 'gemini',
      });

      const cacheWordKey = normalizeArabicWord(nextWordWithTashkeel);
      if (cacheWordKey) {
        nextAnalysisCache[cacheWordKey] = analysis;
        cacheTouched = true;
      }
    } catch (err) {
      retryItems.push({
        cardId: card.id,
        word: displayWord,
        reason:
          err instanceof Error
            ? err.message
            : 'Failed to translate word — tap Retry to try again.',
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
      total: affectedCards.length,
      completed: affectedCards.length,
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
    scannedCount: safeCards.length,
    affectedCount: affectedCards.length,
    fixedCount: fixedWords.length,
    retryCount: retryItems.length,
    fixedWords,
    retryItems,
    supabaseAttempted,
    supabaseSynced,
    supabaseSyncedCount,
    supabaseError,
  };

  return { nextCards, summary };
}
