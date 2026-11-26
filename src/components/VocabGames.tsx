import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Flame,
  HelpCircle,
  Loader2,
  Pencil,
  RotateCcw,
  Shuffle,
  Sparkles,
  Tag,
  Trophy,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import { enrichWordMeta, getLexiconSamplePool, getLexiconSpeechText } from '../data/fallbackLexicon';
import { PracticeStatus, SrsRating, VocabCard, WordAnalysis } from '../types/arabic';
import {
  applySmartPartialTashkeel,
  cleanWordEdgePunctuation,
  normalizeArabicWord,
  normalizeStandaloneArabicKey,
  speakArabic,
  stopArabicSpeech,
  stripTashkeel,
  unlockArabicAudioContext,
} from '../utils/arabic';
import { cardHasTag, collectDeckTags, normalizeVocabTags } from '../utils/vocabTags';

export type GameModeType = 'classic' | 'quiz' | 'match';
export type QuizExerciseFormat = 'mixed' | 'multiple_choice' | 'fill_blank';
type QuizRoundSize = 5 | 10 | 'all';

interface QuizOption {
  id: string;
  english: string;
  isCorrect: boolean;
}

interface FillBlankWordOption {
  id: string;
  arabic: string;
  isCorrect: boolean;
}

interface FillBlankPrompt {
  hasContextSentence: boolean;
  sentenceWithBlankAr?: string;
  fullSentenceAr?: string;
  sentenceEn?: string;
  expectedArabic: string;
  acceptedNormalized: string[];
  wordBankOptions: FillBlankWordOption[];
}

interface MultipleChoiceQuestion {
  kind: 'multiple_choice';
  id: string;
  card: VocabCard;
  options: QuizOption[];
}

interface FillBlankQuestion {
  kind: 'fill_blank';
  id: string;
  card: VocabCard;
  fillBlank: FillBlankPrompt;
}

type QuizQuestion = MultipleChoiceQuestion | FillBlankQuestion;

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizeArabicForQuizAnswer(input: string): string {
  return normalizeArabicWord(input)
    .replace(/\u0640/g, '')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripDefinitePrefix(normalized: string): string {
  return normalized.startsWith('ال') && normalized.length > 3 ? normalized.slice(2) : normalized;
}

function doesTokenMatchTarget(tokenCore: string, cardTargets: string[]): boolean {
  const tokenNorm = normalizeArabicForQuizAnswer(tokenCore);
  if (!tokenNorm) return false;
  const tokenBare = stripDefinitePrefix(tokenNorm);
  const tokenNoSinglePrefix =
    tokenNorm.length > 3 && /^[وفبكل]/.test(tokenNorm)
      ? stripDefinitePrefix(tokenNorm.slice(1))
      : tokenBare;

  for (const target of cardTargets) {
    const targetNorm = normalizeArabicForQuizAnswer(target);
    if (!targetNorm) continue;
    const targetBare = stripDefinitePrefix(targetNorm);
    if (
      tokenNorm === targetNorm ||
      tokenBare === targetBare ||
      tokenNoSinglePrefix === targetBare
    ) {
      return true;
    }
  }
  return false;
}

function isFillBlankAnswerCorrect(userInput: string, prompt: FillBlankPrompt): boolean {
  const cleanUser = normalizeArabicForQuizAnswer(userInput);
  if (!cleanUser) return false;
  const userBare = stripDefinitePrefix(cleanUser);

  for (const accepted of prompt.acceptedNormalized) {
    if (!accepted) continue;
    const acceptedBare = stripDefinitePrefix(accepted);
    if (cleanUser === accepted || (userBare.length >= 2 && userBare === acceptedBare)) {
      return true;
    }
  }
  return false;
}

function buildFillBlankPrompt(
  card: VocabCard,
  allCards: VocabCard[],
  distractorPool: ReturnType<typeof getLexiconSamplePool>
): FillBlankPrompt {
  const targetCandidates = [
    card.wordWithTashkeel,
    card.word,
    card.vocalizedWord || '',
  ].filter(Boolean);

  let matchedSentenceWithBlank: string | undefined;
  let matchedFullSentence: string | undefined;
  let matchedSentenceEn: string | undefined;
  let matchedTokenArabic: string | undefined;

  for (const ex of card.examples || []) {
    const arabicSentence = (ex.arabic || '').trim();
    if (!arabicSentence) continue;
    const tokens = arabicSentence.split(/\s+/);
    let replaced = false;
    const nextTokens = tokens.map((tok) => {
      if (replaced) return tok;
      const { leading, core, trailing, isArabicWord } = cleanWordEdgePunctuation(tok);
      if (isArabicWord && core && doesTokenMatchTarget(core, targetCandidates)) {
        replaced = true;
        matchedTokenArabic = core;
        return `${leading}______${trailing}`;
      }
      return tok;
    });

    if (replaced) {
      matchedSentenceWithBlank = nextTokens.join(' ');
      matchedFullSentence = arabicSentence;
      matchedSentenceEn = (ex.english || '').trim() || undefined;
      break;
    }
  }

  const expectedArabic = card.hasCustomEdits
    ? matchedTokenArabic || card.wordWithTashkeel
    : applySmartPartialTashkeel(matchedTokenArabic || card.wordWithTashkeel);

  const acceptedSet = new Set<string>();
  for (const candidate of [
    matchedTokenArabic || '',
    card.wordWithTashkeel,
    card.word,
    card.vocalizedWord || '',
    normalizeStandaloneArabicKey(card.wordWithTashkeel),
  ]) {
    const norm = normalizeArabicForQuizAnswer(candidate);
    if (norm) acceptedSet.add(norm);
  }

  // Build a 4-choice Arabic word bank for optional tap-to-fill support
  const usedArabicKeys = new Set<string>([
    normalizeArabicForQuizAnswer(expectedArabic),
    normalizeArabicForQuizAnswer(card.wordWithTashkeel),
  ]);
  const bankDistractors: FillBlankWordOption[] = [];

  for (const other of shuffleArray(allCards)) {
    if (other.id === card.id) continue;
    const norm = normalizeArabicForQuizAnswer(other.wordWithTashkeel);
    if (norm && !usedArabicKeys.has(norm)) {
      usedArabicKeys.add(norm);
      bankDistractors.push({
        id: `wb-${other.id}`,
        arabic: other.hasCustomEdits
          ? other.wordWithTashkeel
          : applySmartPartialTashkeel(other.wordWithTashkeel),
        isCorrect: false,
      });
    }
    if (bankDistractors.length >= 3) break;
  }

  if (bankDistractors.length < 3) {
    for (const item of shuffleArray(distractorPool)) {
      const norm = normalizeArabicForQuizAnswer(item.wordWithTashkeel);
      if (norm && !usedArabicKeys.has(norm)) {
        usedArabicKeys.add(norm);
        bankDistractors.push({
          id: `wb-lex-${item.normalizedKey}`,
          arabic: applySmartPartialTashkeel(item.wordWithTashkeel),
          isCorrect: false,
        });
      }
      if (bankDistractors.length >= 3) break;
    }
  }

  const wordBankOptions = shuffleArray<FillBlankWordOption>([
    {
      id: `wb-correct-${card.id}`,
      arabic: expectedArabic,
      isCorrect: true,
    },
    ...bankDistractors,
  ]);

  return {
    hasContextSentence: Boolean(matchedSentenceWithBlank),
    sentenceWithBlankAr: matchedSentenceWithBlank,
    fullSentenceAr: matchedFullSentence,
    sentenceEn: matchedSentenceEn,
    expectedArabic,
    acceptedNormalized: Array.from(acceptedSet),
    wordBankOptions,
  };
}

function buildRandomQuizQuestions(
  targetCards: VocabCard[],
  allCards: VocabCard[],
  distractorPool: ReturnType<typeof getLexiconSamplePool>,
  format: QuizExerciseFormat,
  roundSize: QuizRoundSize
): QuizQuestion[] {
  const shuffled = shuffleArray(targetCards);
  const deck = roundSize === 'all' ? shuffled : shuffled.slice(0, roundSize);

  return deck.map((card, index) => {
    let questionKind: 'multiple_choice' | 'fill_blank';
    if (format === 'multiple_choice') {
      questionKind = 'multiple_choice';
    } else if (format === 'fill_blank') {
      questionKind = 'fill_blank';
    } else {
      // In Mixed mode, alternate randomly while ensuring both formats appear when >= 2 cards
      if (deck.length >= 2 && index < 2) {
        questionKind = index % 2 === 0 ? 'multiple_choice' : 'fill_blank';
      } else {
        const hasContext = (card.examples || []).some((e) => e.arabic?.trim());
        questionKind = Math.random() < (hasContext ? 0.52 : 0.42) ? 'fill_blank' : 'multiple_choice';
      }
    }

    if (questionKind === 'fill_blank') {
      return {
        kind: 'fill_blank',
        id: `q-fb-${card.id}-${index}`,
        card,
        fillBlank: buildFillBlankPrompt(card, allCards, distractorPool),
      };
    }

    const usedMeanings = new Set<string>([card.englishMeaning.trim().toLowerCase()]);
    const distractors: QuizOption[] = [];

    // Prefer distractors from user's other saved flashcards first
    for (const other of shuffleArray(allCards)) {
      if (other.id === card.id) continue;
      const meaningKey = other.englishMeaning.trim().toLowerCase();
      if (!usedMeanings.has(meaningKey)) {
        usedMeanings.add(meaningKey);
        distractors.push({
          id: `opt-${other.id}`,
          english: other.englishMeaning,
          isCorrect: false,
        });
      }
      if (distractors.length >= 3) break;
    }

    // Top up remaining options from built-in lexicon pool if user has < 4 cards
    if (distractors.length < 3) {
      for (const item of shuffleArray(distractorPool)) {
        const meaningKey = item.englishMeaning.trim().toLowerCase();
        if (!usedMeanings.has(meaningKey)) {
          usedMeanings.add(meaningKey);
          distractors.push({
            id: `lex-${item.normalizedKey}`,
            english: item.englishMeaning,
            isCorrect: false,
          });
        }
        if (distractors.length >= 3) break;
      }
    }

    const options = shuffleArray([
      {
        id: `correct-${card.id}`,
        english: card.englishMeaning,
        isCorrect: true,
      },
      ...distractors,
    ]);

    return {
      kind: 'multiple_choice',
      id: `q-mc-${card.id}-${index}`,
      card,
      options,
    };
  });
}

export interface QuizModeProps {
  cards: VocabCard[];
  speechRate: number;
  scope?: 'all' | 'hard' | 'needs_review';
  initialTagFilter?: string;
  onUpdateStatus: (id: string, status: PracticeStatus) => void;
  onRateSrs?: (id: string, rating: SrsRating) => void;
  onRecordReview?: () => void;
  onSwitchToAll?: () => void;
}

export function QuizMode({
  cards,
  speechRate,
  scope = 'all',
  initialTagFilter = 'all',
  onUpdateStatus,
  onRateSrs,
  onRecordReview,
  onSwitchToAll,
}: QuizModeProps) {
  const distractorPool = useMemo(() => getLexiconSamplePool(), []);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const [exerciseFormat, setExerciseFormat] = useState<QuizExerciseFormat>('mixed');
  const [roundSize, setRoundSize] = useState<QuizRoundSize>('all');
  const [quizTagFilter, setQuizTagFilter] = useState<string>(initialTagFilter);

  const deckTags = useMemo(() => collectDeckTags(cards), [cards]);

  useEffect(() => {
    setQuizTagFilter(initialTagFilter);
  }, [initialTagFilter]);

  useEffect(() => {
    if (quizTagFilter === 'all' || quizTagFilter === '__untagged__') return;
    const exists = deckTags.some((t) => t.tag.toLowerCase() === quizTagFilter.toLowerCase());
    if (!exists) setQuizTagFilter('all');
  }, [deckTags, quizTagFilter]);

  const getScopedCards = useCallback(
    (sourceCards: VocabCard[], onlyIds?: string[], activeTag = quizTagFilter) => {
      let pool = sourceCards;
      if (activeTag === '__untagged__') {
        pool = pool.filter((c) => normalizeVocabTags(c.tags).length === 0);
      } else if (activeTag !== 'all') {
        pool = pool.filter((c) => cardHasTag(c, activeTag));
      }

      if (onlyIds && onlyIds.length > 0) {
        const subset = pool.filter((c) => onlyIds.includes(c.id));
        if (subset.length > 0) return subset;
        const fallbackSubset = sourceCards.filter((c) => onlyIds.includes(c.id));
        if (fallbackSubset.length > 0) return fallbackSubset;
      }

      if (scope === 'hard') {
        return pool.filter((c) => c.srsRating === 'hard');
      }
      if (scope === 'needs_review') {
        const now = Date.now();
        const due = pool.filter(
          (c) =>
            c.status === 'needs_review' ||
            c.srsRating === 'hard' ||
            (c.nextReviewAt !== undefined && c.nextReviewAt <= now)
        );
        if (due.length > 0) return due;
      }
      return pool;
    },
    [quizTagFilter, scope]
  );

  const [questions, setQuestions] = useState<QuizQuestion[]>(() =>
    buildRandomQuizQuestions(
      getScopedCards(cards),
      cards,
      distractorPool,
      'mixed',
      'all'
    )
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [fillAnswerInput, setFillAnswerInput] = useState('');
  const [fillResult, setFillResult] = useState<'correct' | 'wrong' | null>(null);
  const [showLetterHint, setShowLetterHint] = useState(false);
  const [showWordBank, setShowWordBank] = useState(false);
  const [showContextHint, setShowContextHint] = useState(false);
  const [score, setScore] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [wrongCardIds, setWrongCardIds] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [wordAudioState, setWordAudioState] = useState<'idle' | 'loading' | 'playing'>('idle');

  const fillInputRef = useRef<HTMLInputElement | null>(null);

  const startRound = useCallback(
    (
      onlyCardIds?: string[],
      nextFormat: QuizExerciseFormat = exerciseFormat,
      nextSize: QuizRoundSize = roundSize,
      nextTag: string = quizTagFilter
    ) => {
      stopArabicSpeech();
      setWordAudioState('idle');
      const latestCards = cardsRef.current;
      const target = getScopedCards(latestCards, onlyCardIds, nextTag);
      setQuestions(
        buildRandomQuizQuestions(
          target,
          latestCards,
          distractorPool,
          nextFormat,
          onlyCardIds ? 'all' : nextSize
        )
      );
      setCurrentIndex(0);
      setSelectedOptionId(null);
      setFillAnswerInput('');
      setFillResult(null);
      setShowLetterHint(false);
      setShowWordBank(false);
      setShowContextHint(false);
      setScore(0);
      setAnsweredCount(0);
      setStreak(0);
      setBestStreak(0);
      setWrongCardIds([]);
      setIsComplete(false);
    },
    [distractorPool, exerciseFormat, getScopedCards, quizTagFilter, roundSize]
  );

  // Rebuild round when scope, tag, format, round size, or deck cardinality changes
  const cardIdSignature = useMemo(() => cards.map((c) => c.id).sort().join('|'), [cards]);
  const prevSignatureRef = useRef({
    scope,
    cardIdSignature,
    exerciseFormat,
    roundSize,
    quizTagFilter,
  });

  useEffect(() => {
    const prev = prevSignatureRef.current;
    if (
      prev.scope !== scope ||
      prev.cardIdSignature !== cardIdSignature ||
      prev.exerciseFormat !== exerciseFormat ||
      prev.roundSize !== roundSize ||
      prev.quizTagFilter !== quizTagFilter
    ) {
      prevSignatureRef.current = {
        scope,
        cardIdSignature,
        exerciseFormat,
        roundSize,
        quizTagFilter,
      };
      startRound(undefined, exerciseFormat, roundSize, quizTagFilter);
    }
  }, [scope, cardIdSignature, exerciseFormat, roundSize, quizTagFilter, startRound]);

  useEffect(() => {
    return () => {
      stopArabicSpeech();
    };
  }, []);

  const currentQuestion = questions[currentIndex] ?? null;

  useEffect(() => {
    if (currentQuestion?.kind === 'fill_blank' && fillResult === null && !isComplete) {
      const id = window.setTimeout(() => {
        fillInputRef.current?.focus();
      }, 60);
      return () => window.clearTimeout(id);
    }
  }, [currentIndex, currentQuestion?.kind, fillResult, isComplete]);

  const recordOutcome = useCallback(
    (card: VocabCard, isCorrect: boolean) => {
      setAnsweredCount((c) => c + 1);

      if (isCorrect) {
        setScore((s) => s + 1);
        setStreak((prev) => {
          const next = prev + 1;
          setBestStreak((b) => Math.max(b, next));
          return next;
        });
        if (onRateSrs) {
          onRateSrs(card.id, card.srsRating === 'easy' ? 'easy' : 'good');
        } else {
          onUpdateStatus(card.id, 'learned');
          onRecordReview?.();
        }
      } else {
        setStreak(0);
        setWrongCardIds((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
        if (onRateSrs) {
          onRateSrs(card.id, 'hard');
        } else {
          onUpdateStatus(card.id, 'needs_review');
        }
      }
    },
    [onRateSrs, onRecordReview, onUpdateStatus]
  );

  const handleSelectOption = useCallback(
    (option: QuizOption) => {
      if (
        !currentQuestion ||
        currentQuestion.kind !== 'multiple_choice' ||
        selectedOptionId
      ) {
        return;
      }
      setSelectedOptionId(option.id);
      recordOutcome(currentQuestion.card, option.isCorrect);
    },
    [currentQuestion, recordOutcome, selectedOptionId]
  );

  const handleSubmitFillBlank = useCallback(
    (overrideText?: string) => {
      if (
        !currentQuestion ||
        currentQuestion.kind !== 'fill_blank' ||
        fillResult !== null
      ) {
        return;
      }
      const valueToCheck = (overrideText ?? fillAnswerInput).trim();
      if (!valueToCheck) return;
      if (overrideText !== undefined) {
        setFillAnswerInput(overrideText);
      }
      const isCorrect = isFillBlankAnswerCorrect(valueToCheck, currentQuestion.fillBlank);
      setFillResult(isCorrect ? 'correct' : 'wrong');
      recordOutcome(currentQuestion.card, isCorrect);
    },
    [currentQuestion, fillAnswerInput, fillResult, recordOutcome]
  );

  const handleRevealFillAnswer = useCallback(() => {
    if (
      !currentQuestion ||
      currentQuestion.kind !== 'fill_blank' ||
      fillResult !== null
    ) {
      return;
    }
    setFillResult('wrong');
    recordOutcome(currentQuestion.card, false);
  }, [currentQuestion, fillResult, recordOutcome]);

  const handleNext = useCallback(() => {
    stopArabicSpeech();
    setWordAudioState('idle');
    if (currentIndex + 1 >= questions.length) {
      setIsComplete(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedOptionId(null);
      setFillAnswerInput('');
      setFillResult(null);
      setShowLetterHint(false);
      setShowWordBank(false);
      setShowContextHint(false);
    }
  }, [currentIndex, questions.length]);

  const handleToggleSpeech = useCallback(() => {
    unlockArabicAudioContext();
    if (!currentQuestion || wordAudioState === 'loading') return;
    if (wordAudioState !== 'idle') {
      stopArabicSpeech();
      setWordAudioState('idle');
    } else {
      const c = currentQuestion.card;
      speakArabic(c.wordWithTashkeel, {
        rate: speechRate,
        mode: 'word',
        vocalizedText: c.hasCustomEdits
          ? c.wordWithTashkeel
          : c.vocalizedWord ||
            getLexiconSpeechText(c.word, c.wordWithTashkeel, c.wordType, c.partOfSpeech),
        meaningHint: c.englishMeaning,
        wordType: c.wordType,
        partOfSpeech: c.partOfSpeech,
        onLoading: () => setWordAudioState('loading'),
        onStart: () => setWordAudioState('playing'),
        onEnd: () => setWordAudioState('idle'),
        onError: () => setWordAudioState('idle'),
      });
    }
  }, [currentQuestion, wordAudioState, speechRate]);

  const isQuestionAnswered =
    currentQuestion?.kind === 'multiple_choice'
      ? selectedOptionId !== null
      : currentQuestion?.kind === 'fill_blank'
        ? fillResult !== null
        : false;

  // Keyboard shortcuts:
  // - Multiple Choice: 1-4 / A-D select answer, Enter/ArrowRight advance, L pronounces
  // - Fill in the Blank: Enter submits answer (handled cleanly even inside input), Enter/ArrowRight advances after answered
  useEffect(() => {
    if (!currentQuestion || isComplete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      if (currentQuestion.kind === 'fill_blank') {
        if (isQuestionAnswered && (e.key === 'Enter' || (!inInput && e.key === 'ArrowRight'))) {
          e.preventDefault();
          handleNext();
        }
        return;
      }

      if (inInput) return;

      const lower = e.key.toLowerCase();
      if (lower === 'l') {
        e.preventDefault();
        handleToggleSpeech();
        return;
      }
      if (!selectedOptionId) {
        const keyMap: Record<string, number> = {
          '1': 0,
          '2': 1,
          '3': 2,
          '4': 3,
          a: 0,
          b: 1,
          c: 2,
          d: 3,
        };
        const idx = keyMap[lower];
        if (idx !== undefined && currentQuestion.options[idx]) {
          e.preventDefault();
          handleSelectOption(currentQuestion.options[idx]);
        }
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    currentQuestion,
    isComplete,
    isQuestionAnswered,
    selectedOptionId,
    handleSelectOption,
    handleNext,
    handleToggleSpeech,
  ]);

  if (cards.length === 0) return null;

  const accuracy = answeredCount > 0 ? Math.round((score / answeredCount) * 100) : 100;
  const totalQuestions = questions.length;
  const completedQuestions = Math.min(answeredCount, totalQuestions);
  const progressPercent =
    totalQuestions > 0 ? Math.round((completedQuestions / totalQuestions) * 100) : 0;

  if (isComplete) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-[#DCE5D3] bg-white/95 p-8 text-center shadow-sm space-y-6 animate-game-pop">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FBF3DC] text-[#9A6F14]">
          <Trophy className="h-6 w-6 text-[#D4A338]" aria-hidden="true" />
        </div>

        <div className="space-y-1.5">
          <p dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]">
            أَحْسَنْتَ! اِنْتَهَتِ الجَوْلَةُ
          </p>
          <h2 className="font-display text-2xl font-bold text-[#1F2718]">
            Quiz Mode Complete
          </h2>
          <p className="text-sm text-[#5A6552]">
            You recalled <span className="font-mono font-semibold text-[#1F2718]">{score}</span> of{' '}
            <span className="font-mono font-semibold text-[#1F2718]">{totalQuestions}</span>{' '}
            Arabic flashcards accurately.
          </p>
        </div>

        <div className="mx-auto max-w-md space-y-1.5 text-left">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-[#5A6552]">Session Progress</span>
            <span className="font-mono tabular-nums font-semibold text-[#2D3B22]">
              {totalQuestions}/{totalQuestions} completed (100%)
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`Quiz session progress: ${totalQuestions} of ${totalQuestions} questions completed`}
            aria-valuenow={totalQuestions}
            aria-valuemin={0}
            aria-valuemax={totalQuestions}
            className="h-2.5 w-full overflow-hidden rounded-full border border-[#DCE5D3] bg-[#EEF2E9]"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#2D3B22] via-[#3B4D2B] to-[#D4A338]"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div className="mx-auto grid max-w-md grid-cols-3 gap-4 border-y border-[#DCE5D3] py-5 font-mono tabular-nums">
          <div>
            <p className="text-2xl font-bold text-[#9A6F14]">
              {score}/{questions.length}
            </p>
            <p className="font-sans text-xs text-[#5A6552] mt-0.5">Score</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#2D3B22]">{accuracy}%</p>
            <p className="font-sans text-xs text-[#5A6552] mt-0.5">Retention</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#3E522D]">{bestStreak}</p>
            <p className="font-sans text-xs text-[#5A6552] mt-0.5">Best Streak</p>
          </div>
        </div>

        {wrongCardIds.length > 0 && (
          <p className="text-xs text-amber-950 bg-[#FEF2E8] border border-orange-200 rounded-xl px-4 py-2.5">
            {wrongCardIds.length}{' '}
            {wrongCardIds.length === 1 ? 'word was' : 'words were'} scheduled as{' '}
            <span className="font-semibold">Hard · Needs Review</span> for priority practice.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          {wrongCardIds.length > 0 && (
            <button
              type="button"
              onClick={() => startRound(wrongCardIds)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] transition-colors cursor-pointer"
            >
              <RotateCcw className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
              <span>Practice Missed Words ({wrongCardIds.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => startRound()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#D4A338] px-5 py-2.5 text-sm font-bold text-[#1F2718] hover:bg-[#E8B948] transition-colors cursor-pointer"
          >
            <Shuffle className="h-4 w-4" aria-hidden="true" />
            <span>New Random Quiz</span>
          </button>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    if (quizTagFilter !== 'all') {
      return (
        <div className="mx-auto max-w-2xl rounded-2xl border border-[#DCE5D3] bg-white p-8 text-center shadow-sm space-y-4">
          <p className="text-sm font-semibold text-[#1F2718]">
            No flashcards match the selected quiz tag filter.
          </p>
          <button
            type="button"
            onClick={() => setQuizTagFilter('all')}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3B4D2B] cursor-pointer"
          >
            <span>Quiz All Tags ({cards.length})</span>
          </button>
        </div>
      );
    }
    if (scope === 'hard') {
      return (
        <div className="mx-auto max-w-2xl rounded-2xl border border-[#DCE5D3] bg-white p-8 sm:p-10 text-center shadow-sm space-y-5">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FBF3DC] text-[#9A6F14] border border-[#E8B948]/40">
            <Flame className="h-6 w-6 text-[#D4A338]" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <p dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]">
              لا تُوجَدُ كَلِمَاتٌ صَعْبَةٌ حَالِيًّا
            </p>
            <h2 className="font-display text-xl font-bold text-[#1F2718]">
              No Words Marked as Difficult Yet
            </h2>
            <p className="text-sm text-[#5A6552] max-w-md mx-auto leading-relaxed">
              Mark tricky words with <span className="font-semibold text-[#1F2718]">Mark Hard</span> in My Vocabulary or select <span className="font-semibold text-[#1F2718]">صعبة / Hard</span> during practice to quiz yourself on them here.
            </p>
          </div>
          {onSwitchToAll && (
            <button
              type="button"
              onClick={onSwitchToAll}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] transition-colors cursor-pointer"
            >
              <span>Practice All Saved Words ({cards.length})</span>
            </button>
          )}
        </div>
      );
    }
    return null;
  }

  const selectedOption =
    currentQuestion.kind === 'multiple_choice'
      ? currentQuestion.options.find((o) => o.id === selectedOptionId) ?? null
      : null;

  const { wordType, root } = enrichWordMeta(
    currentQuestion.card.wordWithTashkeel,
    currentQuestion.card.partOfSpeech,
    currentQuestion.card.wordType,
    currentQuestion.card.root
  );
  const firstExample = currentQuestion.card.examples[0];
  const cardTags = normalizeVocabTags(currentQuestion.card.tags);
  const strippedTarget = stripTashkeel(currentQuestion.card.wordWithTashkeel).trim();
  const firstLetterHint = strippedTarget ? strippedTarget[0] : '';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Quiz Exercise Format + Random Size + Tag Controls */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] px-4 py-3 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Quiz exercise type"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white p-1"
        >
          <button
            type="button"
            onClick={() => setExerciseFormat('mixed')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              exerciseFormat === 'mixed'
                ? 'bg-[#2D3B22] text-[#FACC15]'
                : 'text-[#5A6552] hover:text-[#1F2718]'
            }`}
          >
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span>Mixed</span>
          </button>
          <button
            type="button"
            onClick={() => setExerciseFormat('multiple_choice')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              exerciseFormat === 'multiple_choice'
                ? 'bg-[#2D3B22] text-[#FACC15]'
                : 'text-[#5A6552] hover:text-[#1F2718]'
            }`}
          >
            <HelpCircle className="h-3 w-3" aria-hidden="true" />
            <span>Multiple Choice</span>
          </button>
          <button
            type="button"
            onClick={() => setExerciseFormat('fill_blank')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              exerciseFormat === 'fill_blank'
                ? 'bg-[#2D3B22] text-[#FACC15]'
                : 'text-[#5A6552] hover:text-[#1F2718]'
            }`}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            <span>Fill in the Blank</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(deckTags.length > 0 || quizTagFilter === '__untagged__') && (() => {
            const untaggedCount = cards.filter((c) => normalizeVocabTags(c.tags).length === 0).length;
            return (
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-2.5 py-1.5 text-xs">
                <Tag className="h-3 w-3 text-[#9A6F14]" aria-hidden="true" />
                <select
                  aria-label="Filter quiz cards by tag"
                  value={quizTagFilter}
                  onChange={(e) => setQuizTagFilter(e.target.value)}
                  className="bg-transparent font-semibold text-[#1F2718] focus:outline-none cursor-pointer"
                >
                  <option value="all">All Tags</option>
                  {deckTags.map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag} ({t.count})
                    </option>
                  ))}
                  {(untaggedCount > 0 || quizTagFilter === '__untagged__') && (
                    <option value="__untagged__">Untagged ({untaggedCount})</option>
                  )}
                </select>
              </div>
            );
          })()}

          {cards.length > 5 && (
            <div className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white p-1 text-[11px] font-semibold">
              {([5, 10, 'all'] as QuizRoundSize[]).map((sz) => (
                <button
                  key={String(sz)}
                  type="button"
                  onClick={() => setRoundSize(sz)}
                  className={`rounded-lg px-2 py-1 transition-colors cursor-pointer ${
                    roundSize === sz
                      ? 'bg-[#EEF2E9] text-[#2D3B22] font-bold'
                      : 'text-[#5A6552] hover:text-[#1F2718]'
                  }`}
                >
                  {sz === 'all' ? 'All' : `${sz} Qs`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Retention Progress & Score Bar */}
      <div className="rounded-2xl border border-[#DCE5D3] bg-white px-5 py-3.5 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3.5 text-xs font-mono tabular-nums">
            <span className="font-semibold text-[#1F2718]">
              Card {currentIndex + 1}/{totalQuestions}
            </span>
            <span className="text-[#DCE5D3]" aria-hidden="true">|</span>
            <span className="text-[#9A6F14] font-bold">
              Score: {score}/{answeredCount}
            </span>
            <span className="text-[#DCE5D3]" aria-hidden="true">|</span>
            <span className="text-[#2D3B22] font-semibold">
              Retention: {accuracy}%
            </span>
            <span className="text-[#DCE5D3]" aria-hidden="true">|</span>
            <span className="inline-flex items-center gap-1 text-[#9A6F14] font-semibold">
              <Flame className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
              <span>{streak}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => startRound()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5A6552] hover:text-[#1F2718] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Random Round</span>
          </button>
        </div>

        {/* Session Completion Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-[#5A6552]">
              Session Progress
            </span>
            <span className="font-mono tabular-nums font-semibold text-[#2D3B22]">
              {completedQuestions}/{totalQuestions} completed ({progressPercent}%)
            </span>
          </div>
          <div
            role="progressbar"
            aria-label={`Quiz session progress: ${completedQuestions} of ${totalQuestions} questions completed`}
            aria-valuenow={completedQuestions}
            aria-valuemin={0}
            aria-valuemax={totalQuestions}
            className="h-2.5 w-full overflow-hidden rounded-full border border-[#DCE5D3] bg-[#EEF2E9]"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#2D3B22] via-[#3B4D2B] to-[#D4A338] transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Random Flashcard Question Card */}
      <div className="rounded-2xl border border-[#DCE5D3] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A6552]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#9A6F14]">
            {currentQuestion.kind === 'multiple_choice' ? (
              <>
                <HelpCircle className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                <span>Multiple Choice · Select the correct English meaning</span>
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5 text-[#2D3B22]" aria-hidden="true" />
                <span className="text-[#2D3B22]">
                  {currentQuestion.fillBlank.hasContextSentence
                    ? 'Fill in the Blank · Complete the Arabic sentence'
                    : 'Fill in the Blank · Recall the Arabic word'}
                </span>
              </>
            )}
          </span>

          <div className="flex flex-wrap items-center gap-2 font-arabic-cairo font-medium text-[#3F4A37]" dir="rtl" lang="ar">
            {wordType && <span>نوع الكلمة: {wordType}</span>}
            {wordType && root && <span aria-hidden="true">·</span>}
            {root && <span>الجذر: {root}</span>}
          </div>
        </div>

        {cardTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 -mt-3">
            {cardTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md border border-[#FACC15]/50 bg-[#FEF9C3]/60 px-2 py-0.5 text-[11px] font-semibold text-[#2D3B22]"
              >
                <Tag className="h-2.5 w-2.5 text-[#9A6F14]" aria-hidden="true" />
                <span>{tag}</span>
              </span>
            ))}
          </div>
        )}

        {currentQuestion.kind === 'multiple_choice' ? (
          <>
            <div className="flex flex-col items-center justify-center rounded-2xl bg-[#EEF2E9]/70 border border-[#DCE5D3] px-6 py-7 text-center space-y-3">
              <p
                dir="rtl"
                lang="ar"
                className="font-arabic-scheherazade text-5xl sm:text-6xl font-bold text-[#1F2718] leading-[1.8]"
              >
                {currentQuestion.card.hasCustomEdits
                  ? currentQuestion.card.wordWithTashkeel
                  : applySmartPartialTashkeel(currentQuestion.card.wordWithTashkeel)}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    wordAudioState !== 'idle'
                      ? 'border-[#2D3B22] bg-[#2D3B22] text-[#E8B948] ring-4 ring-[#DCE5D3]'
                      : 'border-[#DCE5D3] bg-white text-[#1F2718] hover:bg-[#FBF3DC] hover:text-[#9A6F14] hover:border-[#D4A338]'
                  }`}
                >
                  {wordAudioState === 'loading' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 text-[#E8B948] animate-spin" aria-hidden="true" />
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <Volume2
                        className={`h-3.5 w-3.5 ${
                          wordAudioState === 'playing' ? 'text-[#E8B948] animate-pulse' : 'text-[#9A6F14]'
                        }`}
                        aria-hidden="true"
                      />
                      <span>{wordAudioState === 'playing' ? 'Playing (L)' : 'Listen (L)'}</span>
                    </>
                  )}
                </button>

                {firstExample && !isQuestionAnswered && (
                  <button
                    type="button"
                    onClick={() => setShowContextHint((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-[#2D3B22]" aria-hidden="true" />
                    <span>{showContextHint ? 'Hide Context Clue' : 'Show Context Clue'}</span>
                  </button>
                )}

                {isQuestionAnswered && (
                  <span className="font-mono text-xs text-[#5A6552]">
                    {currentQuestion.card.transliteration}
                  </span>
                )}
              </div>

              {firstExample && (showContextHint || isQuestionAnswered) && (
                <div className="mt-2 w-full max-w-lg border-t border-[#DCE5D3] pt-3 space-y-1">
                  <p
                    dir="rtl"
                    lang="ar"
                    className="font-arabic-scheherazade text-xl leading-[2.0] text-[#1F2718]"
                  >
                    {applySmartPartialTashkeel(firstExample.arabic)}
                  </p>
                  {isQuestionAnswered && (
                    <p className="text-xs text-[#5A6552]">{firstExample.english}</p>
                  )}
                </div>
              )}
            </div>

            {/* 4 Multiple-Choice Options */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {currentQuestion.options.map((opt, idx) => {
                const isPicked = selectedOptionId === opt.id;
                const letter = ['A', 'B', 'C', 'D'][idx] ?? '';

                let buttonStyle =
                  'border-[#DCE5D3] bg-white text-[#1F2718] hover:border-[#D4A338] hover:bg-[#FAFBF8]';
                let statusIcon: 'correct' | 'wrong' | null = null;

                if (isQuestionAnswered) {
                  if (opt.isCorrect) {
                    buttonStyle =
                      'border-[#2D3B22] bg-[#EEF2E9] text-[#2D3B22] ring-2 ring-[#2D3B22]/20 animate-game-pop';
                    statusIcon = 'correct';
                  } else if (isPicked && !opt.isCorrect) {
                    buttonStyle =
                      'border-[#C2410C] bg-[#FEF2E8] text-[#9A3412] ring-2 ring-[#C2410C]/20 animate-game-shake';
                    statusIcon = 'wrong';
                  } else {
                    buttonStyle = 'border-[#DCE5D3]/70 bg-[#FAFBF8] text-[#6B7861]';
                  }
                }

                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isQuestionAnswered}
                    onClick={() => handleSelectOption(opt)}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-150 ${
                      !isQuestionAnswered ? 'cursor-pointer' : 'cursor-default'
                    } ${buttonStyle}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#EEF2E9] font-mono text-xs font-bold text-[#2D3B22]">
                        {letter}
                      </span>
                      <span className="text-sm font-semibold leading-snug">
                        {opt.english}
                      </span>
                    </div>

                    {statusIcon === 'correct' && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2D3B22]" aria-hidden="true" />
                    )}
                    {statusIcon === 'wrong' && (
                      <XCircle className="h-4 w-4 shrink-0 text-[#C2410C]" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          /* FILL-IN-THE-BLANK EXERCISE */
          <div className="space-y-5">
            <div className="rounded-2xl bg-[#EEF2E9]/70 border border-[#DCE5D3] px-5 py-6 text-center space-y-3">
              {currentQuestion.fillBlank.hasContextSentence &&
              currentQuestion.fillBlank.sentenceWithBlankAr ? (
                <>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#5A6552]">
                    Complete the Arabic sentence
                  </p>
                  <p
                    dir="rtl"
                    lang="ar"
                    className="font-arabic-scheherazade text-2xl sm:text-3xl font-bold text-[#1F2718] leading-[2.0]"
                  >
                    {isQuestionAnswered && currentQuestion.fillBlank.fullSentenceAr
                      ? applySmartPartialTashkeel(currentQuestion.fillBlank.fullSentenceAr)
                      : currentQuestion.fillBlank.sentenceWithBlankAr}
                  </p>
                  {currentQuestion.fillBlank.sentenceEn && (
                    <p className="text-sm text-[#4A5543] font-medium">
                      &ldquo;{currentQuestion.fillBlank.sentenceEn}&rdquo;
                    </p>
                  )}
                  <p className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5CE8F] bg-[#FBF3DC] px-3 py-1 text-xs font-bold text-[#2D3B22]">
                    <span>Missing word meaning:</span>
                    <span className="text-[#9A6F14]">{currentQuestion.card.englishMeaning}</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#5A6552]">
                    Type the Arabic word matching this meaning
                  </p>
                  <p className="font-display text-2xl sm:text-3xl font-bold text-[#1F2718]">
                    {currentQuestion.card.englishMeaning}
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[#3B4D2B]/40 bg-white px-5 py-2 font-arabic-scheherazade text-2xl text-[#5A6552]">
                    <span>______</span>
                    <span className="font-sans text-xs font-semibold text-[#9A6F14]">
                      ({currentQuestion.card.partOfSpeech})
                    </span>
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleToggleSpeech}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    wordAudioState !== 'idle'
                      ? 'border-[#2D3B22] bg-[#2D3B22] text-[#E8B948] ring-4 ring-[#DCE5D3]'
                      : 'border-[#DCE5D3] bg-white text-[#1F2718] hover:bg-[#FBF3DC] hover:text-[#9A6F14]'
                  }`}
                >
                  {wordAudioState === 'loading' ? (
                    <Loader2 className="h-3.5 w-3.5 text-[#E8B948] animate-spin" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5 text-[#9A6F14]" aria-hidden="true" />
                  )}
                  <span>{wordAudioState === 'playing' ? 'Playing Audio Clue' : 'Audio Clue'}</span>
                </button>

                {!isQuestionAnswered && firstLetterHint && (
                  <button
                    type="button"
                    onClick={() => setShowLetterHint((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3 py-1.5 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                    <span>
                      {showLetterHint
                        ? `Starts with "${firstLetterHint}" · ${strippedTarget.length} letters`
                        : 'Letter Hint · تلميح'}
                    </span>
                  </button>
                )}

                {!isQuestionAnswered && (
                  <button
                    type="button"
                    onClick={() => setShowWordBank((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                      showWordBank
                        ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FACC15]'
                        : 'border-[#DCE5D3] bg-white text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    <span>{showWordBank ? 'Hide Word Bank' : 'Word Bank'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Answer Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!isQuestionAnswered) {
                  handleSubmitFillBlank();
                } else {
                  handleNext();
                }
              }}
              className="space-y-3"
            >
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
                <input
                  ref={fillInputRef}
                  type="text"
                  dir="rtl"
                  lang="ar"
                  disabled={isQuestionAnswered}
                  value={fillAnswerInput}
                  onChange={(e) => setFillAnswerInput(e.target.value)}
                  placeholder="اكتب الكلمة العربية هنا..."
                  aria-label="Type the missing Arabic word"
                  className={`font-arabic-scheherazade flex-1 rounded-xl border px-4 py-3 text-2xl font-bold text-right transition-colors focus:outline-none focus:ring-2 ${
                    fillResult === 'correct'
                      ? 'border-[#2D3B22] bg-[#EEF2E9] text-[#2D3B22] focus:ring-[#2D3B22]/20'
                      : fillResult === 'wrong'
                        ? 'border-[#C2410C] bg-[#FEF2E8] text-[#9A3412] focus:ring-[#C2410C]/20'
                        : 'border-[#DCE5D3] bg-white text-[#1F2718] placeholder:text-[#9CA894] focus:border-[#2D3B22] focus:ring-[#2D3B22]/20'
                  }`}
                />

                {!isQuestionAnswered && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="submit"
                      disabled={!fillAnswerInput.trim()}
                      className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-xl bg-[#2D3B22] px-5 py-3 text-sm font-bold text-white hover:bg-[#3B4D2B] disabled:opacity-45 transition-colors cursor-pointer"
                    >
                      <Check className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
                      <span>Check</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRevealFillAnswer}
                      className="rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-3 text-xs font-semibold text-[#5A6552] hover:bg-[#FEF2E8] hover:text-[#9A3412] transition-colors cursor-pointer"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>

              {showWordBank && !isQuestionAnswered && (
                <div className="rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] p-3 space-y-2 animate-fade-slide-up">
                  <p className="text-[11px] font-semibold text-[#5A6552]">
                    Tap a word to fill in the blank:
                  </p>
                  <div dir="rtl" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {currentQuestion.fillBlank.wordBankOptions.map((wb) => (
                      <button
                        key={wb.id}
                        type="button"
                        onClick={() => handleSubmitFillBlank(wb.arabic)}
                        className="font-arabic-scheherazade rounded-xl border border-[#DCE5D3] bg-white px-3 py-2 text-xl font-bold text-[#1F2718] hover:border-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                      >
                        {wb.arabic}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>
          </div>
        )}

        {/* Instant Feedback & Next Action */}
        {isQuestionAnswered && (
          <div
            className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border px-4 py-3 animate-game-pop ${
              (currentQuestion.kind === 'multiple_choice' && selectedOption?.isCorrect) ||
              (currentQuestion.kind === 'fill_blank' && fillResult === 'correct')
                ? 'border-[#DCE5D3] bg-[#EEF2E9] text-[#2D3B22]'
                : 'border-orange-200 bg-[#FEF2E8] text-[#9A3412]'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              {(currentQuestion.kind === 'multiple_choice' && selectedOption?.isCorrect) ||
              (currentQuestion.kind === 'fill_blank' && fillResult === 'correct') ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-[#2D3B22] shrink-0" aria-hidden="true" />
                  <span>
                    Correct! · إِجَابَةٌ صَحِيحَةٌ
                    {currentQuestion.kind === 'fill_blank' && (
                      <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-base mr-1.5 ml-1.5">
                        ({currentQuestion.fillBlank.expectedArabic})
                      </span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-[#C2410C] shrink-0" aria-hidden="true" />
                  <span>
                    {currentQuestion.kind === 'multiple_choice' ? (
                      <>Incorrect — Meaning: &ldquo;{currentQuestion.card.englishMeaning}&rdquo;</>
                    ) : (
                      <>
                        Answer:{' '}
                        <span
                          dir="rtl"
                          lang="ar"
                          className="font-arabic-scheherazade text-lg font-bold text-[#1F2718] mx-1"
                        >
                          {currentQuestion.fillBlank.expectedArabic}
                        </span>
                        ({currentQuestion.card.transliteration || currentQuestion.card.englishMeaning})
                      </>
                    )}
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2D3B22] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3E522D] transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{currentIndex + 1 >= questions.length ? 'See Retention Results' : 'Next Random Card'}</span>
              <ArrowRight className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
            </button>
          </div>
        )}

        {!isQuestionAnswered && (
          <p className="text-center text-xs text-[#5A6552]">
            {currentQuestion.kind === 'multiple_choice' ? (
              <>
                Shortcuts: <span className="font-mono">1–4</span> or{' '}
                <span className="font-mono">A–D</span> choose ·{' '}
                <span className="font-mono">L</span> pronounce
              </>
            ) : (
              <>
                Type without diacritics or with tashkeel, press{' '}
                <span className="font-mono">Enter</span> to check, or open{' '}
                <span className="font-semibold">Word Bank</span>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export const QuizChallengeGame = QuizMode;

interface MatchPairItem {
  pairId: string;
  word: string;
  wordWithTashkeel: string;
  vocalizedWord?: string;
  wordType?: WordAnalysis['wordType'];
  partOfSpeech?: string;
  englishMeaning: string;
  isUserCard: boolean;
  hasCustomEdits?: boolean;
}

interface SpeedMatchGameProps {
  cards: VocabCard[];
  speechRate: number;
  onRecordMatchComplete?: () => void;
}

export function SpeedMatchGame({
  cards,
  speechRate,
  onRecordMatchComplete,
}: SpeedMatchGameProps) {
  const [roundSeed, setRoundSeed] = useState(0);
  const [selectedArId, setSelectedArId] = useState<string | null>(null);
  const [selectedEnId, setSelectedEnId] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [mismatchPair, setMismatchPair] = useState<{ arId: string; enId: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [bestTimeMs, setBestTimeMs] = useState<number | null>(null);
  const [isFinished, setIsFinished] = useState(false);

  const distractorPool = useMemo(() => getLexiconSamplePool(), []);

  const { pairs, shuffledArabic, shuffledEnglish } = useMemo(() => {
    const picked: MatchPairItem[] = shuffleArray(cards)
      .slice(0, 6)
      .map((card) => ({
        pairId: card.id,
        word: card.word,
        wordWithTashkeel: card.wordWithTashkeel,
        vocalizedWord: card.vocalizedWord,
        wordType: card.wordType,
        partOfSpeech: card.partOfSpeech,
        englishMeaning: card.englishMeaning,
        isUserCard: true,
        hasCustomEdits: card.hasCustomEdits,
      }));

    const usedMeanings = new Set(picked.map((p) => p.englishMeaning.trim().toLowerCase()));
    if (picked.length < 4) {
      for (const item of shuffleArray(distractorPool)) {
        const key = item.englishMeaning.trim().toLowerCase();
        if (!usedMeanings.has(key)) {
          usedMeanings.add(key);
          picked.push({
            pairId: `lex-${item.normalizedKey}`,
            word: item.wordWithTashkeel,
            wordWithTashkeel: item.wordWithTashkeel,
            vocalizedWord: item.vocalizedWord,
            wordType: item.wordType,
            partOfSpeech: item.partOfSpeech,
            englishMeaning: item.englishMeaning,
            isUserCard: false,
          });
        }
        if (picked.length >= 4) break;
      }
    }

    return {
      pairs: picked,
      shuffledArabic: shuffleArray(picked),
      shuffledEnglish: shuffleArray(picked),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, distractorPool, roundSeed]);

  useEffect(() => {
    if (!startedAt || isFinished) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);
    return () => window.clearInterval(timer);
  }, [startedAt, isFinished]);

  const startNewRound = () => {
    setRoundSeed((s) => s + 1);
    setSelectedArId(null);
    setSelectedEnId(null);
    setMatchedIds([]);
    setMismatchPair(null);
    setMistakes(0);
    setElapsedMs(0);
    setStartedAt(null);
    setIsFinished(false);
  };

  const evaluateMatch = (arId: string, enId: string) => {
    if (arId === enId) {
      const nextMatched = [...matchedIds, arId];
      setMatchedIds(nextMatched);
      setSelectedArId(null);
      setSelectedEnId(null);

      if (nextMatched.length >= pairs.length) {
        const finalMs = startedAt ? Date.now() - startedAt : elapsedMs;
        setElapsedMs(finalMs);
        setIsFinished(true);
        setBestTimeMs((prev) => (prev === null ? finalMs : Math.min(prev, finalMs)));
        onRecordMatchComplete?.();
      }
    } else {
      setMistakes((m) => m + 1);
      setMismatchPair({ arId, enId });
      window.setTimeout(() => {
        setMismatchPair(null);
        setSelectedArId(null);
        setSelectedEnId(null);
      }, 380);
    }
  };

  const handlePickArabic = (pair: MatchPairItem) => {
    if (matchedIds.includes(pair.pairId) || mismatchPair || isFinished) return;
    unlockArabicAudioContext();
    if (!startedAt) setStartedAt(Date.now());
    speakArabic(pair.wordWithTashkeel, {
      rate: speechRate,
      mode: 'word',
      vocalizedText: pair.hasCustomEdits
        ? pair.wordWithTashkeel
        : pair.vocalizedWord ||
          getLexiconSpeechText(
            pair.word,
            pair.wordWithTashkeel,
            pair.wordType,
            pair.partOfSpeech
          ),
      meaningHint: pair.englishMeaning,
      wordType: pair.wordType,
      partOfSpeech: pair.partOfSpeech,
    });

    if (selectedEnId) {
      setSelectedArId(pair.pairId);
      evaluateMatch(pair.pairId, selectedEnId);
    } else {
      setSelectedArId((prev) => (prev === pair.pairId ? null : pair.pairId));
    }
  };

  const handlePickEnglish = (pair: MatchPairItem) => {
    if (matchedIds.includes(pair.pairId) || mismatchPair || isFinished) return;
    if (!startedAt) setStartedAt(Date.now());

    if (selectedArId) {
      setSelectedEnId(pair.pairId);
      evaluateMatch(selectedArId, pair.pairId);
    } else {
      setSelectedEnId((prev) => (prev === pair.pairId ? null : pair.pairId));
    }
  };

  if (cards.length === 0) return null;

  const formattedSeconds = (elapsedMs / 1000).toFixed(1);
  const formattedBest = bestTimeMs !== null ? (bestTimeMs / 1000).toFixed(1) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Top Status & Soft Timer */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#DCE5D3] bg-white px-5 py-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#2D3B22]">
            <Clock className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
            <span>{formattedSeconds}s</span>
          </span>
          <span className="text-[#DCE5D3]" aria-hidden="true">|</span>
          <span className="font-semibold text-[#9A6F14]">
            Matched: {matchedIds.length}/{pairs.length}
          </span>
          <span className="text-[#DCE5D3]" aria-hidden="true">|</span>
          <span className="text-[#5A6552]">Mistakes: {mistakes}</span>
          {formattedBest && (
            <>
              <span className="text-[#DCE5D3]" aria-hidden="true">|</span>
              <span className="text-[#2D3B22] font-semibold">Best: {formattedBest}s</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={startNewRound}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5A6552] hover:text-[#1F2718] cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>New Set</span>
        </button>
      </div>

      {isFinished ? (
        <div className="rounded-2xl border border-[#DCE5D3] bg-white p-8 text-center shadow-sm space-y-5 animate-game-pop">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FBF3DC] text-[#9A6F14]">
            <Zap className="h-6 w-6 text-[#D4A338]" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]">
              سُرْعَةٌ رَائِعَةٌ!
            </p>
            <h2 className="font-display text-2xl font-bold text-[#1F2718]">
              All Pairs Matched
            </h2>
            <p className="text-sm text-[#5A6552]">
              Completed {pairs.length} Arabic-English matches in{' '}
              <span className="font-mono font-bold text-[#9A6F14]">{formattedSeconds}s</span> with{' '}
              <span className="font-mono font-bold text-[#1F2718]">{mistakes}</span>{' '}
              {mistakes === 1 ? 'mistake' : 'mistakes'}.
            </p>
          </div>
          <button
            type="button"
            onClick={startNewRound}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] transition-colors cursor-pointer"
          >
            <RotateCcw className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
            <span>Play Faster Round</span>
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#DCE5D3] bg-white p-5 sm:p-6 shadow-sm space-y-4">
          <p className="text-xs text-[#5A6552]">
            Tap an Arabic word and its matching English translation. Timer starts on your first tap.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Arabic Column */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-[#5A6552] px-1">Arabic Words</p>
              {shuffledArabic.map((item) => {
                const isMatched = matchedIds.includes(item.pairId);
                const isSelected = selectedArId === item.pairId;
                const isWrong = mismatchPair?.arId === item.pairId;

                return (
                  <button
                    key={`ar-${item.pairId}`}
                    type="button"
                    disabled={isMatched}
                    onClick={() => handlePickArabic(item)}
                    dir="rtl"
                    lang="ar"
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-all duration-150 ${
                      isMatched
                        ? 'border-[#DCE5D3] bg-[#EEF2E9] text-[#2D3B22] opacity-70 cursor-default'
                        : isWrong
                          ? 'border-[#C2410C] bg-[#FEF2E8] text-[#9A3412] animate-game-shake cursor-pointer'
                          : isSelected
                            ? 'border-[#D4A338] bg-[#FBF3DC] text-[#1F2718] ring-2 ring-[#D4A338]/30 cursor-pointer'
                            : 'border-[#DCE5D3] bg-[#FAFBF8] text-[#1F2718] hover:border-[#D4A338] hover:bg-white cursor-pointer'
                    }`}
                  >
                    <span className="font-arabic-scheherazade text-2xl font-bold leading-normal">
                      {item.hasCustomEdits
                        ? item.wordWithTashkeel
                        : applySmartPartialTashkeel(item.wordWithTashkeel)}
                    </span>
                    {isMatched ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2D3B22]" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 shrink-0 text-[#6B7861]" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* English Column */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-[#5A6552] px-1">English Meanings</p>
              {shuffledEnglish.map((item) => {
                const isMatched = matchedIds.includes(item.pairId);
                const isSelected = selectedEnId === item.pairId;
                const isWrong = mismatchPair?.enId === item.pairId;

                return (
                  <button
                    key={`en-${item.pairId}`}
                    type="button"
                    disabled={isMatched}
                    onClick={() => handlePickEnglish(item)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-150 ${
                      isMatched
                        ? 'border-[#DCE5D3] bg-[#EEF2E9] text-[#2D3B22] opacity-70 cursor-default'
                        : isWrong
                          ? 'border-[#C2410C] bg-[#FEF2E8] text-[#9A3412] animate-game-shake cursor-pointer'
                          : isSelected
                            ? 'border-[#D4A338] bg-[#FBF3DC] text-[#1F2718] ring-2 ring-[#D4A338]/30 cursor-pointer'
                            : 'border-[#DCE5D3] bg-white text-[#1F2718] hover:border-[#D4A338] hover:bg-[#FAFBF8] cursor-pointer'
                    }`}
                  >
                    <span className="text-sm font-semibold leading-snug">
                      {item.englishMeaning}
                    </span>
                    {isMatched && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2D3B22]" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
