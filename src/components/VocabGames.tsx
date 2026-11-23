import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Flame,
  HelpCircle,
  Loader2,
  RotateCcw,
  Shuffle,
  Trophy,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import { enrichWordMeta, getLexiconSamplePool, getLexiconSpeechText } from '../data/fallbackLexicon';
import { PracticeStatus, SrsRating, VocabCard, WordAnalysis } from '../types/arabic';
import { applySmartPartialTashkeel, speakArabic, stopArabicSpeech, unlockArabicAudioContext } from '../utils/arabic';

export type GameModeType = 'classic' | 'quiz' | 'match';

interface QuizOption {
  id: string;
  english: string;
  isCorrect: boolean;
}

interface QuizQuestion {
  card: VocabCard;
  options: QuizOption[];
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildRandomQuizQuestions(
  targetCards: VocabCard[],
  allCards: VocabCard[],
  distractorPool: ReturnType<typeof getLexiconSamplePool>
): QuizQuestion[] {
  const deck = shuffleArray(targetCards);
  return deck.map((card) => {
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

    return { card, options };
  });
}

export interface QuizModeProps {
  cards: VocabCard[];
  speechRate: number;
  scope?: 'all' | 'hard' | 'needs_review';
  onUpdateStatus: (id: string, status: PracticeStatus) => void;
  onRateSrs?: (id: string, rating: SrsRating) => void;
  onRecordReview?: () => void;
  onSwitchToAll?: () => void;
}

export function QuizMode({
  cards,
  speechRate,
  scope = 'all',
  onUpdateStatus,
  onRateSrs,
  onRecordReview,
  onSwitchToAll,
}: QuizModeProps) {
  const distractorPool = useMemo(() => getLexiconSamplePool(), []);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const getScopedCards = useCallback(
    (sourceCards: VocabCard[], onlyIds?: string[]) => {
      if (onlyIds && onlyIds.length > 0) {
        const subset = sourceCards.filter((c) => onlyIds.includes(c.id));
        if (subset.length > 0) return subset;
      }
      if (scope === 'hard') {
        return sourceCards.filter((c) => c.srsRating === 'hard');
      }
      if (scope === 'needs_review') {
        const now = Date.now();
        const due = sourceCards.filter(
          (c) =>
            c.status === 'needs_review' ||
            c.srsRating === 'hard' ||
            (c.nextReviewAt !== undefined && c.nextReviewAt <= now)
        );
        if (due.length > 0) return due;
      }
      return sourceCards;
    },
    [scope]
  );

  const [questions, setQuestions] = useState<QuizQuestion[]>(() =>
    buildRandomQuizQuestions(getScopedCards(cards), cards, distractorPool)
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [showContextHint, setShowContextHint] = useState(false);
  const [score, setScore] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [wrongCardIds, setWrongCardIds] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [wordAudioState, setWordAudioState] = useState<'idle' | 'loading' | 'playing'>('idle');

  const startRound = useCallback(
    (onlyCardIds?: string[]) => {
      stopArabicSpeech();
      setWordAudioState('idle');
      const latestCards = cardsRef.current;
      const target = getScopedCards(latestCards, onlyCardIds);
      setQuestions(buildRandomQuizQuestions(target, latestCards, distractorPool));
      setCurrentIndex(0);
      setSelectedOptionId(null);
      setShowContextHint(false);
      setScore(0);
      setAnsweredCount(0);
      setStreak(0);
      setBestStreak(0);
      setWrongCardIds([]);
      setIsComplete(false);
    },
    [distractorPool, getScopedCards]
  );

  // Rebuild round when scope switches or deck cardinality changes (never mid-round on SRS rating)
  const cardIdSignature = useMemo(() => cards.map((c) => c.id).sort().join('|'), [cards]);
  const prevSignatureRef = useRef({ scope, cardIdSignature });

  useEffect(() => {
    if (
      prevSignatureRef.current.scope !== scope ||
      prevSignatureRef.current.cardIdSignature !== cardIdSignature
    ) {
      prevSignatureRef.current = { scope, cardIdSignature };
      startRound();
    }
  }, [scope, cardIdSignature, startRound]);

  useEffect(() => {
    return () => {
      stopArabicSpeech();
    };
  }, []);

  const currentQuestion = questions[currentIndex] ?? null;

  const handleSelectOption = useCallback(
    (option: QuizOption) => {
      if (selectedOptionId || !currentQuestion) return;
      setSelectedOptionId(option.id);
      setAnsweredCount((c) => c + 1);

      if (option.isCorrect) {
        setScore((s) => s + 1);
        setStreak((prev) => {
          const next = prev + 1;
          setBestStreak((b) => Math.max(b, next));
          return next;
        });
        if (onRateSrs) {
          onRateSrs(
            currentQuestion.card.id,
            currentQuestion.card.srsRating === 'easy' ? 'easy' : 'good'
          );
        } else {
          onUpdateStatus(currentQuestion.card.id, 'learned');
          onRecordReview?.();
        }
      } else {
        setStreak(0);
        setWrongCardIds((prev) =>
          prev.includes(currentQuestion.card.id) ? prev : [...prev, currentQuestion.card.id]
        );
        if (onRateSrs) {
          onRateSrs(currentQuestion.card.id, 'hard');
        } else {
          onUpdateStatus(currentQuestion.card.id, 'needs_review');
        }
      }
    },
    [selectedOptionId, currentQuestion, onRateSrs, onUpdateStatus, onRecordReview]
  );

  const handleNext = useCallback(() => {
    stopArabicSpeech();
    setWordAudioState('idle');
    if (currentIndex + 1 >= questions.length) {
      setIsComplete(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedOptionId(null);
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
        vocalizedText:
          c.vocalizedWord ||
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

  // Keyboard shortcuts: 1-4 or A-D select answer, Enter/ArrowRight advance, L pronounces
  useEffect(() => {
    if (!currentQuestion || isComplete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
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
  }, [currentQuestion, isComplete, selectedOptionId, handleSelectOption, handleNext, handleToggleSpeech]);

  if (cards.length === 0) return null;

  const accuracy =
    answeredCount > 0 ? Math.round((score / answeredCount) * 100) : 100;

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
            <span className="font-mono font-semibold text-[#1F2718]">{questions.length}</span>{' '}
            Arabic flashcards accurately.
          </p>
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

  const selectedOption = currentQuestion.options.find((o) => o.id === selectedOptionId) ?? null;
  const isAnswered = selectedOption !== null;
  const { wordType, root } = enrichWordMeta(
    currentQuestion.card.wordWithTashkeel,
    currentQuestion.card.partOfSpeech,
    currentQuestion.card.wordType,
    currentQuestion.card.root
  );
  const firstExample = currentQuestion.card.examples[0];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Retention Progress & Score Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#DCE5D3] bg-white px-5 py-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3.5 text-xs font-mono tabular-nums">
          <span className="font-semibold text-[#1F2718]">
            Card {currentIndex + 1}/{questions.length}
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
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5A6552] hover:text-[#1F2718] cursor-pointer"
        >
          <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
          <span>New Random Round</span>
        </button>
      </div>

      {/* Random Flashcard Question Card */}
      <div className="rounded-2xl border border-[#DCE5D3] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A6552]">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#9A6F14]">
            <HelpCircle className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
            <span>Select the correct English meaning from 4 choices</span>
          </span>

          <div className="flex items-center gap-2 font-arabic-cairo font-medium text-[#3F4A37]" dir="rtl" lang="ar">
            {wordType && <span>نوع الكلمة: {wordType}</span>}
            {wordType && root && <span aria-hidden="true">·</span>}
            {root && <span>الجذر: {root}</span>}
          </div>
        </div>

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

            {firstExample && !isAnswered && (
              <button
                type="button"
                onClick={() => setShowContextHint((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
              >
                <BookOpen className="h-3.5 w-3.5 text-[#2D3B22]" aria-hidden="true" />
                <span>{showContextHint ? 'Hide Context Clue' : 'Show Context Clue'}</span>
              </button>
            )}

            {isAnswered && (
              <span className="font-mono text-xs text-[#5A6552]">
                {currentQuestion.card.transliteration}
              </span>
            )}
          </div>

          {firstExample && (showContextHint || isAnswered) && (
            <div className="mt-2 w-full max-w-lg border-t border-[#DCE5D3] pt-3 space-y-1">
              <p
                dir="rtl"
                lang="ar"
                className="font-arabic-scheherazade text-xl leading-[2.0] text-[#1F2718]"
              >
                {applySmartPartialTashkeel(firstExample.arabic)}
              </p>
              {isAnswered && (
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

            if (isAnswered) {
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
                disabled={isAnswered}
                onClick={() => handleSelectOption(opt)}
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-150 ${
                  !isAnswered ? 'cursor-pointer' : 'cursor-default'
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

        {/* Instant Feedback & Next Action */}
        {isAnswered && selectedOption ? (
          <div
            className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border px-4 py-3 animate-game-pop ${
              selectedOption.isCorrect
                ? 'border-[#DCE5D3] bg-[#EEF2E9] text-[#2D3B22]'
                : 'border-orange-200 bg-[#FEF2E8] text-[#9A3412]'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              {selectedOption.isCorrect ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-[#2D3B22] shrink-0" aria-hidden="true" />
                  <span>Correct! · إِجَابَةٌ صَحِيحَةٌ</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-[#C2410C] shrink-0" aria-hidden="true" />
                  <span>
                    Incorrect — Meaning: &ldquo;{currentQuestion.card.englishMeaning}&rdquo;
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
        ) : (
          <p className="text-center text-xs text-[#5A6552]">
            Shortcuts: <span className="font-mono">1–4</span> or{' '}
            <span className="font-mono">A–D</span> choose ·{' '}
            <span className="font-mono">L</span> pronounce
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
