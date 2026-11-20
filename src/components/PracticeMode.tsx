import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Flame,
  HelpCircle,
  Layers,
  NotebookPen,
  RotateCcw,
  RotateCw,
  Sparkles,
  Volume2,
  Zap,
} from 'lucide-react';
import { NoteContextTag, PracticeStatus, SrsRating, VocabCard } from '../types/arabic';
import { speakArabic, stopArabicSpeech, stripTashkeel } from '../utils/arabic';
import { Flashcard3D } from './Flashcard3D';
import { GameModeType, QuizMode, SpeedMatchGame } from './VocabGames';

interface PracticeModeProps {
  cards: VocabCard[];
  speechRate: number;
  onUpdateStatus: (id: string, status: PracticeStatus) => void;
  onRateSrs: (id: string, rating: SrsRating) => void;
  onGoToLessons: () => void;
  onGoToVocabulary: () => void;
  onRecordReview: () => void;
  notesCount?: number;
  onOpenNotes?: (context?: NoteContextTag) => void;
}

function getSrsPriorityScore(card: VocabCard, now: number): number {
  const isDue = !card.nextReviewAt || card.nextReviewAt <= now;
  if (card.srsRating === 'hard') return 0; // Always prioritize Hard cards first
  if (card.status === 'needs_review' && isDue) return 1;
  if (isDue) return 2;
  if (card.srsRating === 'good') return 3;
  if (card.srsRating === 'easy') return 4;
  return 2;
}

function buildPrioritizedQueueIds(
  cards: VocabCard[],
  scope: 'all' | 'needs_review'
): string[] {
  const now = Date.now();
  const baseList =
    scope === 'needs_review'
      ? cards.filter(
          (c) =>
            c.status === 'needs_review' ||
            c.srsRating === 'hard' ||
            (c.nextReviewAt !== undefined && c.nextReviewAt <= now)
        )
      : cards;

  const source = baseList.length > 0 ? baseList : cards;
  return [...source]
    .sort((a, b) => {
      const scoreDiff = getSrsPriorityScore(a, now) - getSrsPriorityScore(b, now);
      if (scoreDiff !== 0) return scoreDiff;
      const aDue = a.nextReviewAt ?? 0;
      const bDue = b.nextReviewAt ?? 0;
      return aDue - bDue;
    })
    .map((c) => c.id);
}

export function PracticeMode({
  cards,
  speechRate,
  onUpdateStatus,
  onRateSrs,
  onGoToLessons,
  onGoToVocabulary,
  onRecordReview,
  notesCount = 0,
  onOpenNotes,
}: PracticeModeProps) {
  const [gameMode, setGameMode] = useState<GameModeType>('classic');
  const [scope, setScope] = useState<'all' | 'needs_review'>('all');
  const [sessionQueueIds, setSessionQueueIds] = useState<string[]>(() =>
    buildPrioritizedQueueIds(cards, 'all')
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionResults, setSessionResults] = useState<{
    hard: number;
    good: number;
    easy: number;
  }>({ hard: 0, good: 0, easy: 0 });
  const [isComplete, setIsComplete] = useState(false);
  const [isPlayingWord, setIsPlayingWord] = useState(false);
  const requeuedInSessionRef = useRef<Set<string>>(new Set());

  const cardById = useMemo(() => {
    const map = new Map<string, VocabCard>();
    for (const c of cards) map.set(c.id, c);
    return map;
  }, [cards]);

  // Keep queue synchronized if cards are added or deleted externally
  useEffect(() => {
    const validIds = new Set(cards.map((c) => c.id));
    setSessionQueueIds((prev) => {
      const filtered = prev.filter((id) => validIds.has(id));
      if (filtered.length === 0 && cards.length > 0) {
        return buildPrioritizedQueueIds(cards, scope);
      }
      return filtered;
    });
  }, [cards, scope]);

  const deck = useMemo(
    () =>
      sessionQueueIds
        .map((id) => cardById.get(id))
        .filter((c): c is VocabCard => Boolean(c)),
    [sessionQueueIds, cardById]
  );

  const currentCard = deck[currentIndex] ?? null;

  const resetSession = useCallback(
    (nextScope?: 'all' | 'needs_review') => {
      const targetScope = nextScope ?? scope;
      if (nextScope) setScope(nextScope);
      requeuedInSessionRef.current = new Set();
      setSessionQueueIds(buildPrioritizedQueueIds(cards, targetScope));
      setCurrentIndex(0);
      setIsFlipped(false);
      setSessionResults({ hard: 0, good: 0, easy: 0 });
      setIsComplete(false);
    },
    [cards, scope]
  );

  const handleSrsRate = useCallback(
    (rating: SrsRating) => {
      if (!currentCard) return;
      onRateSrs(currentCard.id, rating);

      setSessionResults((prev) => ({
        ...prev,
        [rating]: prev[rating] + 1,
      }));

      // If marked Hard and not yet re-queued in this session, re-insert 2-3 slots ahead
      let nextDeckLength = deck.length;
      if (rating === 'hard' && !requeuedInSessionRef.current.has(currentCard.id)) {
        requeuedInSessionRef.current.add(currentCard.id);
        const insertAt = Math.min(sessionQueueIds.length, currentIndex + 3);
        const updated = [...sessionQueueIds];
        updated.splice(insertAt, 0, currentCard.id);
        setSessionQueueIds(updated);
        nextDeckLength = updated.length;
      }

      if (currentIndex + 1 >= nextDeckLength) {
        setIsComplete(true);
      } else {
        setIsFlipped(false);
        setCurrentIndex((prev) => prev + 1);
      }
    },
    [currentCard, currentIndex, deck.length, onRateSrs, sessionQueueIds]
  );

  useEffect(() => {
    if (gameMode !== 'classic' || !currentCard || isComplete) return;
    const handleKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsFlipped((prev) => !prev);
      } else if (e.key === 'l' || e.key === 'L') {
        if (isPlayingWord) {
          stopArabicSpeech();
          setIsPlayingWord(false);
        } else {
          speakArabic(currentCard.wordWithTashkeel, {
            rate: speechRate,
            onStart: () => setIsPlayingWord(true),
            onEnd: () => setIsPlayingWord(false),
          });
        }
      } else if (isFlipped && e.key === '1') {
        handleSrsRate('hard');
      } else if (isFlipped && e.key === '2') {
        handleSrsRate('good');
      } else if (isFlipped && e.key === '3') {
        handleSrsRate('easy');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [gameMode, currentCard, isComplete, isFlipped, isPlayingWord, speechRate, handleSrsRate]);

  if (cards.length === 0) {
    return (
      <section className="rounded-xl border border-[#ECE8EF] bg-white px-6 py-16 text-center max-w-2xl mx-auto shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-[#241734]">
          No Cards Ready for Practice
        </h1>
        <p className="mt-2 text-sm text-zinc-600 max-w-md mx-auto">
          Save Arabic words from any lesson into My Vocabulary first, then return here to
          practice active recall with spaced repetition flashcards, quizzes, and speed matching.
        </p>
        <button
          type="button"
          onClick={onGoToLessons}
          className="mt-6 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#BE123C] transition-colors cursor-pointer"
        >
          Go to Lessons
        </button>
      </section>
    );
  }

  const now = Date.now();
  const dueOrHardCount = cards.filter(
    (c) =>
      c.status === 'needs_review' ||
      c.srsRating === 'hard' ||
      (c.nextReviewAt !== undefined && c.nextReviewAt <= now)
  ).length;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      {/* Top Controls + Game Mode Switcher */}
      <div className="flex flex-col gap-4 border-b border-[#ECE8EF]/80 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2.5">
              <h1 className="font-display text-3xl font-bold tracking-tight text-[#241734]">
                Practice Arena
              </h1>
              <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#4C1D95]">
                أَلْعَابُ التَّعَلُّمِ
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              Smart Spaced Repetition (SRS) prioritizes Hard cards first, paired with Quizzes and Speed Match.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenNotes && (
              <button
                type="button"
                onClick={() =>
                  onOpenNotes({
                    type: 'vocab',
                    label:
                      gameMode === 'classic' && currentCard
                        ? `كلمة: ${stripTashkeel(currentCard.wordWithTashkeel)}`
                        : 'التدريب · Practice Arena',
                    refId: gameMode === 'classic' && currentCard ? currentCard.id : undefined,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-white px-3.5 py-2 text-xs font-semibold text-[#4C1D95] hover:bg-purple-50 shadow-2xs transition-colors cursor-pointer"
              >
                <NotebookPen className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
                <span>ملاحظاتي · Notes</span>
                {notesCount > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-[#E11D48]">
                    ({notesCount})
                  </span>
                )}
              </button>
            )}

            {(gameMode === 'classic' || gameMode === 'quiz') && (
              <div className="inline-flex items-center gap-1 rounded-xl border border-[#ECE8EF] bg-white p-1 shadow-2xs">
                <button
                  type="button"
                  onClick={() => resetSession('all')}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    scope === 'all'
                      ? 'bg-[#4C1D95] text-white'
                      : 'text-zinc-600 hover:text-[#241734]'
                  }`}
                >
                  All Cards ({cards.length})
                </button>
                <button
                  type="button"
                  disabled={dueOrHardCount === 0}
                  onClick={() => resetSession('needs_review')}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45 whitespace-nowrap cursor-pointer ${
                    scope === 'needs_review'
                      ? 'bg-[#E11D48] text-white'
                      : 'text-zinc-600 hover:text-[#241734]'
                  }`}
                >
                  Due / Hard ({dueOrHardCount})
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Smooth Game Mode Tabs */}
        <div
          role="tablist"
          aria-label="Practice game modes"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#ECE8EF] bg-white/80 p-1 self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={gameMode === 'classic'}
            onClick={() => setGameMode('classic')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              gameMode === 'classic'
                ? 'bg-[#F7F4F9] text-[#241734] shadow-xs'
                : 'text-zinc-600 hover:text-[#241734]'
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-[#4C1D95]" aria-hidden="true" />
            <span>Spaced Repetition Cards</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={gameMode === 'quiz'}
            onClick={() => setGameMode('quiz')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              gameMode === 'quiz'
                ? 'bg-[#F7F4F9] text-[#E11D48] shadow-xs'
                : 'text-zinc-600 hover:text-[#241734]'
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
            <span>Quiz Mode</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={gameMode === 'match'}
            onClick={() => setGameMode('match')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
              gameMode === 'match'
                ? 'bg-[#F7F4F9] text-fuchsia-800 shadow-xs'
                : 'text-zinc-600 hover:text-[#241734]'
            }`}
          >
            <Zap className="h-3.5 w-3.5 text-fuchsia-700" aria-hidden="true" />
            <span>Speed Match</span>
          </button>
        </div>
      </div>

      {gameMode === 'quiz' && (
        <QuizMode
          cards={cards}
          speechRate={speechRate}
          scope={scope}
          onUpdateStatus={onUpdateStatus}
          onRateSrs={onRateSrs}
          onRecordReview={onRecordReview}
        />
      )}

      {gameMode === 'match' && (
        <SpeedMatchGame
          cards={cards}
          speechRate={speechRate}
          onRecordMatchComplete={onRecordReview}
        />
      )}

      {gameMode === 'classic' && (
        <>
          {isComplete ? (
            <div className="rounded-2xl border border-[#ECE8EF] bg-white/95 backdrop-blur-md p-8 sm:p-10 text-center space-y-6 shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-[#E11D48]">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-2xl font-bold text-[#241734]">
                  SRS Session Complete
                </h2>
                <p className="text-sm text-zinc-600">
                  You completed{' '}
                  <span className="font-mono font-semibold text-[#241734]">
                    {sessionResults.hard + sessionResults.good + sessionResults.easy}
                  </span>{' '}
                  recall evaluations. Cards rated Hard are queued first next time.
                </p>
              </div>

              <div className="mx-auto grid max-w-md grid-cols-3 gap-4 border-y border-[#ECE8EF] py-5">
                <div>
                  <p className="font-mono text-2xl font-bold tabular-nums text-[#E11D48]">
                    {sessionResults.hard}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">Hard · Review Soon</p>
                </div>
                <div>
                  <p className="font-mono text-2xl font-bold tabular-nums text-fuchsia-700">
                    {sessionResults.good}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">Good · 2 Days</p>
                </div>
                <div>
                  <p className="font-mono text-2xl font-bold tabular-nums text-[#4C1D95]">
                    {sessionResults.easy}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">Easy · 1 Week</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => resetSession()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#BE123C] transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span>Start Next Round</span>
                </button>
                <button
                  type="button"
                  onClick={onGoToVocabulary}
                  className="rounded-xl border border-[#ECE8EF] bg-white px-5 py-2.5 text-sm font-semibold text-[#241734] hover:bg-[#F7F4F9] transition-colors cursor-pointer"
                >
                  Back to My Vocabulary
                </button>
              </div>
            </div>
          ) : currentCard ? (
            <div className="space-y-5">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-500 font-mono tabular-nums">
                  <span>
                    Card {currentIndex + 1} of {deck.length}
                    {currentCard.srsRating === 'hard' && ' · Priority Review'}
                  </span>
                  <span>
                    {Math.round(((currentIndex + 1) / deck.length) * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#F2EEF6]">
                  <div
                    className="h-full bg-gradient-to-r from-[#F43F5E] to-[#4C1D95] transition-all duration-300"
                    style={{ width: `${((currentIndex + 1) / deck.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Center 3D Flashcard */}
              <Flashcard3D
                card={currentCard}
                speechRate={speechRate}
                large
                controlledFlipped={isFlipped}
                onFlipChange={setIsFlipped}
              />

              {/* Spaced Repetition Grading Controls */}
              <div className="space-y-3 pt-2">
                {!isFlipped ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={currentIndex === 0}
                        onClick={() => {
                          setIsFlipped(false);
                          setCurrentIndex((prev) => Math.max(0, prev - 1));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#ECE8EF] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#241734] hover:bg-[#F7F4F9] disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Previous</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isPlayingWord) {
                            stopArabicSpeech();
                            setIsPlayingWord(false);
                          } else {
                            speakArabic(currentCard.wordWithTashkeel, {
                              rate: speechRate,
                              onStart: () => setIsPlayingWord(true),
                              onEnd: () => setIsPlayingWord(false),
                            });
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                          isPlayingWord
                            ? 'border-[#E11D48] bg-[#E11D48] text-white ring-4 ring-rose-200'
                            : 'border-[#ECE8EF] bg-white text-[#241734] hover:bg-[#F7F4F9]'
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
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsFlipped(true)}
                      className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-[#4C1D95] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#581C87] shadow-xs transition-colors cursor-pointer"
                    >
                      <RotateCw className="h-4 w-4 text-rose-200" aria-hidden="true" />
                      <span>Flip Card to Rate Recall</span>
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[#ECE8EF] bg-white p-4 shadow-xs space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-700">
                        How well did you recall this word?
                      </span>
                      <span className="font-mono text-zinc-400">Keys: 1 · 2 · 3</span>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => handleSrsRate('hard')}
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50/90 px-4 py-3 text-rose-900 hover:bg-rose-100 transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                          <Flame className="h-4 w-4 text-[#E11D48]" aria-hidden="true" />
                          <span>صعبة / Hard</span>
                        </span>
                        <span className="text-[11px] font-medium text-[#E11D48]">
                          Review Soon
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSrsRate('good')}
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-fuchsia-200 bg-fuchsia-50/90 px-4 py-3 text-fuchsia-950 hover:bg-fuchsia-100 transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                          <Clock className="h-4 w-4 text-fuchsia-700" aria-hidden="true" />
                          <span>جيدة / Good</span>
                        </span>
                        <span className="text-[11px] font-medium text-fuchsia-800">
                          Review in 2 days
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSrsRate('easy')}
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[#4C1D95] bg-[#4C1D95] px-4 py-3 text-white hover:bg-[#581C87] transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                          <Sparkles className="h-4 w-4 text-rose-200" aria-hidden="true" />
                          <span>سهلة / Easy</span>
                        </span>
                        <span className="text-[11px] font-medium text-purple-100">
                          Review in a week
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-center text-xs text-zinc-500">
                Shortcuts: <span className="font-mono">Space</span> flip ·{' '}
                <span className="font-mono">L</span> pronounce
                {isFlipped && (
                  <>
                    {' '}
                    · <span className="font-mono">1</span> Hard ·{' '}
                    <span className="font-mono">2</span> Good ·{' '}
                    <span className="font-mono">3</span> Easy
                  </>
                )}
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
