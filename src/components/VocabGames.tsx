import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Flame,
  HelpCircle,
  RotateCcw,
  Shuffle,
  Trophy,
  Volume2,
  XCircle,
  Zap,
} from 'lucide-react';
import { enrichWordMeta, getLexiconSamplePool } from '../data/fallbackLexicon';
import { PracticeStatus, SrsRating, VocabCard } from '../types/arabic';
import { applySmartPartialTashkeel, speakArabic, stopArabicSpeech } from '../utils/arabic';

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
  scope?: 'all' | 'needs_review';
  onUpdateStatus: (id: string, status: PracticeStatus) => void;
  onRateSrs?: (id: string, rating: SrsRating) => void;
  onRecordReview?: () => void;
}

export function QuizMode({
  cards,
  speechRate,
  scope = 'all',
  onUpdateStatus,
  onRateSrs,
  onRecordReview,
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
  const [isPlayingWord, setIsPlayingWord] = useState(false);

  const startRound = useCallback(
    (onlyCardIds?: string[]) => {
      stopArabicSpeech();
      setIsPlayingWord(false);
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
    setIsPlayingWord(false);
    if (currentIndex + 1 >= questions.length) {
      setIsComplete(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setSelectedOptionId(null);
      setShowContextHint(false);
    }
  }, [currentIndex, questions.length]);

  const handleToggleSpeech = useCallback(() => {
    if (!currentQuestion) return;
    if (isPlayingWord) {
      stopArabicSpeech();
      setIsPlayingWord(false);
    } else {
      speakArabic(currentQuestion.card.wordWithTashkeel, {
        rate: speechRate,
        onStart: () => setIsPlayingWord(true),
        onEnd: () => setIsPlayingWord(false),
      });
    }
  }, [currentQuestion, isPlayingWord, speechRate]);

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
      <div className="mx-auto max-w-2xl rounded-2xl border border-[#ECE8EF] bg-white/95 p-8 text-center shadow-sm space-y-6 animate-game-pop">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-[#E11D48]">
          <Trophy className="h-6 w-6" aria-hidden="true" />
        </div>

        <div className="space-y-1.5">
          <p dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#4C1D95]">
            أَحْسَنْتَ! اِنْتَهَتِ الجَوْلَةُ
          </p>
          <h2 className="font-display text-2xl font-bold text-[#241734]">
            Quiz Mode Complete
          </h2>
          <p className="text-sm text-zinc-600">
            You recalled <span className="font-mono font-semibold text-[#241734]">{score}</span> of{' '}
            <span className="font-mono font-semibold text-[#241734]">{questions.length}</span>{' '}
            Arabic flashcards accurately.
          </p>
        </div>

        <div className="mx-auto grid max-w-md grid-cols-3 gap-4 border-y border-[#ECE8EF] py-5 font-mono tabular-nums">
          <div>
            <p className="text-2xl font-bold text-[#E11D48]">
              {score}/{questions.length}
            </p>
            <p className="font-sans text-xs text-zinc-500 mt-0.5">Score</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[#4C1D95]">{accuracy}%</p>
            <p className="font-sans text-xs text-zinc-500 mt-0.5">Retention</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-fuchsia-700">{bestStreak}</p>
            <p className="font-sans text-xs text-zinc-500 mt-0.5">Best Streak</p>
          </div>
        </div>

        {wrongCardIds.length > 0 && (
          <p className="text-xs text-rose-950 bg-rose-50/80 border border-rose-200/80 rounded-xl px-4 py-2.5">
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
              className="inline-flex items-center gap-2 rounded-xl bg-[#4C1D95] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#581C87] transition-colors cursor-pointer"
            >
              <RotateCcw className="h-4 w-4 text-rose-200" aria-hidden="true" />
              <span>Practice Missed Words ({wrongCardIds.length})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => startRound()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#BE123C] transition-colors cursor-pointer"
          >
            <Shuffle className="h-4 w-4" aria-hidden="true" />
            <span>New Random Quiz</span>
          </button>
        </div>
      </div>
    );
  }

  if (!currentQuestion) return null;

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ECE8EF]/90 bg-white px-5 py-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3.5 text-xs font-mono tabular-nums">
          <span className="font-semibold text-zinc-700">
            Card {currentIndex + 1}/{questions.length}
          </span>
          <span className="text-[#ECE8EF]" aria-hidden="true">|</span>
          <span className="text-[#E11D48] font-bold">
            Score: {score}/{answeredCount}
          </span>
          <span className="text-[#ECE8EF]" aria-hidden="true">|</span>
          <span className="text-[#4C1D95] font-semibold">
            Retention: {accuracy}%
          </span>
          <span className="text-[#ECE8EF]" aria-hidden="true">|</span>
          <span className="inline-flex items-center gap-1 text-fuchsia-700 font-semibold">
            <Flame className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{streak}</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => startRound()}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-[#241734] cursor-pointer"
        >
          <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
          <span>New Random Round</span>
        </button>
      </div>

      {/* Random Flashcard Question Card */}
      <div className="rounded-2xl border border-[#ECE8EF]/90 bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#E11D48]">
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Select the correct English meaning from 4 choices</span>
          </span>

          <div className="flex items-center gap-2 font-medium text-zinc-600" dir="rtl" lang="ar">
            {wordType && <span>نوع الكلمة: {wordType}</span>}
            {wordType && root && <span aria-hidden="true">·</span>}
            {root && <span>الجذر: {root}</span>}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center rounded-2xl bg-[#F7F4F9] border border-[#ECE8EF]/70 px-6 py-7 text-center space-y-3">
          <p
            dir="rtl"
            lang="ar"
            className="font-arabic-scheherazade text-5xl sm:text-6xl font-bold text-[#241734] leading-[1.8]"
          >
            {applySmartPartialTashkeel(currentQuestion.card.wordWithTashkeel)}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={handleToggleSpeech}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                isPlayingWord
                  ? 'border-[#E11D48] bg-[#E11D48] text-white ring-4 ring-rose-200'
                  : 'border-[#ECE8EF] bg-white text-zinc-700 hover:bg-rose-50 hover:text-[#E11D48] hover:border-rose-300'
              }`}
            >
              <Volume2
                className={`h-3.5 w-3.5 ${
                  isPlayingWord ? 'text-white animate-pulse' : 'text-[#E11D48]'
                }`}
                aria-hidden="true"
              />
              <span>{isPlayingWord ? 'Playing (L)' : 'Listen (L)'}</span>
            </button>

            {firstExample && !isAnswered && (
              <button
                type="button"
                onClick={() => setShowContextHint((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#ECE8EF] bg-white px-3.5 py-2 text-xs font-semibold text-[#4C1D95] hover:bg-purple-50 transition-colors cursor-pointer"
              >
                <BookOpen className="h-3.5 w-3.5 text-[#4C1D95]" aria-hidden="true" />
                <span>{showContextHint ? 'Hide Context Clue' : 'Show Context Clue'}</span>
              </button>
            )}

            {isAnswered && (
              <span className="font-mono text-xs text-zinc-500">
                {currentQuestion.card.transliteration}
              </span>
            )}
          </div>

          {firstExample && (showContextHint || isAnswered) && (
            <div className="mt-2 w-full max-w-lg border-t border-[#ECE8EF] pt-3 space-y-1">
              <p
                dir="rtl"
                lang="ar"
                className="font-arabic-scheherazade text-xl leading-[2.0] text-[#241734]"
              >
                {applySmartPartialTashkeel(firstExample.arabic)}
              </p>
              {isAnswered && (
                <p className="text-xs text-zinc-600">{firstExample.english}</p>
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
              'border-[#ECE8EF] bg-white text-[#241734] hover:border-rose-300 hover:bg-rose-50/40';
            let statusIcon: 'correct' | 'wrong' | null = null;

            if (isAnswered) {
              if (opt.isCorrect) {
                buttonStyle =
                  'border-[#4C1D95] bg-purple-50 text-[#4C1D95] ring-2 ring-[#4C1D95]/20 animate-game-pop';
                statusIcon = 'correct';
              } else if (isPicked && !opt.isCorrect) {
                buttonStyle =
                  'border-[#E11D48] bg-rose-50 text-rose-950 ring-2 ring-[#E11D48]/20 animate-game-shake';
                statusIcon = 'wrong';
              } else {
                buttonStyle = 'border-[#ECE8EF]/70 bg-[#F7F4F9] text-zinc-400';
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
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#F2EEF6] font-mono text-xs font-bold text-[#4C1D95]">
                    {letter}
                  </span>
                  <span className="text-sm font-semibold leading-snug">
                    {opt.english}
                  </span>
                </div>

                {statusIcon === 'correct' && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#4C1D95]" aria-hidden="true" />
                )}
                {statusIcon === 'wrong' && (
                  <XCircle className="h-4 w-4 shrink-0 text-[#E11D48]" aria-hidden="true" />
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
                ? 'border-purple-200 bg-purple-50/90 text-[#4C1D95]'
                : 'border-rose-200 bg-rose-50/80 text-rose-950'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              {selectedOption.isCorrect ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-[#4C1D95] shrink-0" aria-hidden="true" />
                  <span>Correct! · إِجَابَةٌ صَحِيحَةٌ</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-[#E11D48] shrink-0" aria-hidden="true" />
                  <span>
                    Incorrect — Meaning: &ldquo;{currentQuestion.card.englishMeaning}&rdquo;
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4C1D95] px-4 py-2 text-xs font-semibold text-white hover:bg-[#581C87] transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{currentIndex + 1 >= questions.length ? 'See Retention Results' : 'Next Random Card'}</span>
              <ArrowRight className="h-3.5 w-3.5 text-rose-200" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className="text-center text-xs text-zinc-500">
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
  wordWithTashkeel: string;
  englishMeaning: string;
  isUserCard: boolean;
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
        wordWithTashkeel: card.wordWithTashkeel,
        englishMeaning: card.englishMeaning,
        isUserCard: true,
      }));

    const usedMeanings = new Set(picked.map((p) => p.englishMeaning.trim().toLowerCase()));
    if (picked.length < 4) {
      for (const item of shuffleArray(distractorPool)) {
        const key = item.englishMeaning.trim().toLowerCase();
        if (!usedMeanings.has(key)) {
          usedMeanings.add(key);
          picked.push({
            pairId: `lex-${item.normalizedKey}`,
            wordWithTashkeel: item.wordWithTashkeel,
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
    if (!startedAt) setStartedAt(Date.now());
    speakArabic(pair.wordWithTashkeel, { rate: speechRate });

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ECE8EF]/90 bg-white px-5 py-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#4C1D95]">
            <Clock className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
            <span>{formattedSeconds}s</span>
          </span>
          <span className="text-[#ECE8EF]" aria-hidden="true">|</span>
          <span className="font-semibold text-[#E11D48]">
            Matched: {matchedIds.length}/{pairs.length}
          </span>
          <span className="text-[#ECE8EF]" aria-hidden="true">|</span>
          <span className="text-zinc-600">Mistakes: {mistakes}</span>
          {formattedBest && (
            <>
              <span className="text-[#ECE8EF]" aria-hidden="true">|</span>
              <span className="text-fuchsia-700 font-semibold">Best: {formattedBest}s</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={startNewRound}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-[#241734] cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>New Set</span>
        </button>
      </div>

      {isFinished ? (
        <div className="rounded-2xl border border-[#ECE8EF] bg-white p-8 text-center shadow-sm space-y-5 animate-game-pop">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-[#E11D48]">
            <Zap className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#4C1D95]">
              سُرْعَةٌ رَائِعَةٌ!
            </p>
            <h2 className="font-display text-2xl font-bold text-[#241734]">
              All Pairs Matched
            </h2>
            <p className="text-sm text-zinc-600">
              Completed {pairs.length} Arabic-English matches in{' '}
              <span className="font-mono font-bold text-[#E11D48]">{formattedSeconds}s</span> with{' '}
              <span className="font-mono font-bold text-[#241734]">{mistakes}</span>{' '}
              {mistakes === 1 ? 'mistake' : 'mistakes'}.
            </p>
          </div>
          <button
            type="button"
            onClick={startNewRound}
            className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#BE123C] transition-colors cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>Play Faster Round</span>
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#ECE8EF]/90 bg-white p-5 sm:p-6 shadow-sm space-y-4">
          <p className="text-xs text-zinc-500">
            Tap an Arabic word and its matching English translation. Timer starts on your first tap.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Arabic Column */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-zinc-500 px-1">Arabic Words</p>
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
                        ? 'border-purple-200 bg-purple-50/70 text-[#4C1D95] opacity-65 cursor-default'
                        : isWrong
                          ? 'border-[#E11D48] bg-rose-50 text-rose-950 animate-game-shake cursor-pointer'
                          : isSelected
                            ? 'border-[#E11D48] bg-rose-50 text-rose-950 ring-2 ring-[#E11D48]/20 cursor-pointer'
                            : 'border-[#ECE8EF] bg-[#F7F4F9] text-[#241734] hover:border-rose-300 hover:bg-white cursor-pointer'
                    }`}
                  >
                    <span className="font-arabic-scheherazade text-2xl font-bold leading-normal">
                      {applySmartPartialTashkeel(item.wordWithTashkeel)}
                    </span>
                    {isMatched ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#4C1D95]" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* English Column */}
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-zinc-500 px-1">English Meanings</p>
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
                        ? 'border-purple-200 bg-purple-50/70 text-[#4C1D95] opacity-65 cursor-default'
                        : isWrong
                          ? 'border-[#E11D48] bg-rose-50 text-rose-950 animate-game-shake cursor-pointer'
                          : isSelected
                            ? 'border-[#E11D48] bg-rose-50 text-rose-950 ring-2 ring-[#E11D48]/20 cursor-pointer'
                            : 'border-[#ECE8EF] bg-white text-[#241734] hover:border-rose-300 hover:bg-rose-50/30 cursor-pointer'
                    }`}
                  >
                    <span className="text-sm font-semibold leading-snug">
                      {item.englishMeaning}
                    </span>
                    {isMatched && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#4C1D95]" aria-hidden="true" />
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
