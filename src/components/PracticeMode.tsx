import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Flame,
  HelpCircle,
  Layers,
  Loader2,
  NotebookPen,
  RotateCcw,
  RotateCw,
  Sparkles,
  Volume2,
  Zap,
} from 'lucide-react';
import { getLexiconSpeechText } from '../data/fallbackLexicon';
import { NoteContextTag, PracticeStatus, SrsRating, VocabCard } from '../types/arabic';
import { speakArabic, stopArabicSpeech, stripTashkeel, unlockArabicAudioContext } from '../utils/arabic';
import { Flashcard3D } from './Flashcard3D';
import { GameModeType, QuizMode, SpeedMatchGame } from './VocabGames';

export type PracticeScope = 'all' | 'hard' | 'needs_review';

interface PracticeModeProps {
  cards: VocabCard[];
  speechRate: number;
  initialScope?: PracticeScope;
  scopeRequestSeq?: number;
  onUpdateStatus: (id: string, status: PracticeStatus) => void;
  onToggleDifficult?: (id: string) => void;
  onEditCard?: (card: VocabCard) => void;
  onRateSrs: (id: string, rating: SrsRating) => void;
  onGoToLessons: () => void;
  onGoToVocabulary: () => void;
  onRecordReview: () => void;
  notesCount?: number;
  onOpenNotes?: (context?: NoteContextTag) => void;
  embeddedInVocab?: boolean;
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
  scope: PracticeScope
): string[] {
  const now = Date.now();
  if (scope === 'hard') {
    return cards
      .filter((c) => c.srsRating === 'hard')
      .map((c) => c.id);
  }

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
  initialScope = 'all',
  scopeRequestSeq = 0,
  onUpdateStatus,
  onToggleDifficult,
  onEditCard,
  onRateSrs,
  onGoToLessons,
  onGoToVocabulary,
  onRecordReview,
  notesCount = 0,
  onOpenNotes,
  embeddedInVocab = false,
}: PracticeModeProps) {
  const [gameMode, setGameMode] = useState<GameModeType>('classic');
  const [scope, setScope] = useState<PracticeScope>(initialScope);
  const [sessionQueueIds, setSessionQueueIds] = useState<string[]>(() =>
    buildPrioritizedQueueIds(cards, initialScope)
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionResults, setSessionResults] = useState<{
    hard: number;
    good: number;
    easy: number;
  }>({ hard: 0, good: 0, easy: 0 });
  const [isComplete, setIsComplete] = useState(false);
  const [wordAudioState, setWordAudioState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const requeuedInSessionRef = useRef<Set<string>>(new Set());
  const prevSeqRef = useRef(scopeRequestSeq);

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
      if (filtered.length === 0 && cards.length > 0 && scope !== 'hard') {
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
    (nextScope?: PracticeScope) => {
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

  useEffect(() => {
    if (prevSeqRef.current !== scopeRequestSeq) {
      prevSeqRef.current = scopeRequestSeq;
      setGameMode('classic');
      resetSession(initialScope);
    }
  }, [scopeRequestSeq, initialScope, resetSession]);

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
        unlockArabicAudioContext();
        if (wordAudioState === 'loading') {
          return;
        }
        if (wordAudioState !== 'idle') {
          stopArabicSpeech();
          setWordAudioState('idle');
        } else {
          speakArabic(currentCard.wordWithTashkeel, {
            rate: speechRate,
            mode: 'word',
            vocalizedText: currentCard.hasCustomEdits
              ? currentCard.wordWithTashkeel
              : currentCard.vocalizedWord ||
                getLexiconSpeechText(
                  currentCard.word,
                  currentCard.wordWithTashkeel,
                  currentCard.wordType,
                  currentCard.partOfSpeech
                ),
            meaningHint: currentCard.englishMeaning,
            wordType: currentCard.wordType,
            partOfSpeech: currentCard.partOfSpeech,
            onLoading: () => setWordAudioState('loading'),
            onStart: () => setWordAudioState('playing'),
            onEnd: () => setWordAudioState('idle'),
            onError: () => setWordAudioState('idle'),
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
  }, [gameMode, currentCard, isComplete, isFlipped, wordAudioState, speechRate, handleSrsRate]);

  if (cards.length === 0) {
    return (
      <section className="rounded-2xl border border-[#DCE5D3] bg-white px-6 py-16 text-center max-w-2xl mx-auto shadow-sm animate-fade-slide-up">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2E9] text-[#2D3B22]">
          <Layers className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-[#1F2718]">
          No Cards Ready for Practice
        </h1>
        <p className="mt-2 text-sm text-[#5A6552] max-w-md mx-auto">
          Save Arabic words from any lesson into My Vocabulary first, then return here to
          practice active recall with spaced repetition flashcards, quizzes, and speed matching.
        </p>
        <button
          type="button"
          onClick={onGoToLessons}
          className="mt-6 rounded-xl bg-[#2D3B22] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] transition-colors cursor-pointer"
        >
          Go to Lessons
        </button>
      </section>
    );
  }

  const now = Date.now();
  const hardCount = cards.filter((c) => c.srsRating === 'hard').length;
  const dueOrHardCount = cards.filter(
    (c) =>
      c.status === 'needs_review' ||
      c.srsRating === 'hard' ||
      (c.nextReviewAt !== undefined && c.nextReviewAt <= now)
  ).length;

  return (
    <section className="mx-auto max-w-3xl space-y-6 animate-fade-slide-up">
      {/* Top Controls + Game Mode Switcher */}
      {embeddedInVocab ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-[#1F2718]">
              {scope === 'hard'
                ? 'Focused Hard Cards Queue · البطاقات الصعبة'
                : 'Smart Spaced Repetition (SRS)'}
            </p>
            <p className="text-[11px] text-[#5A6552]">
              {scope === 'hard'
                ? 'Reviewing words you marked as Difficult / Hard while studying.'
                : 'Prioritizes Hard and due cards first for maximum retention.'}
            </p>
          </div>

          <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => resetSession('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                scope === 'all'
                  ? 'bg-[#2D3B22] text-white'
                  : 'text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              All Cards ({cards.length})
            </button>
            <button
              type="button"
              onClick={() => resetSession('hard')}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                scope === 'hard'
                  ? 'bg-[#C2410C] text-white'
                  : 'text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              <Flame
                className={`h-3 w-3 ${scope === 'hard' ? 'text-white' : 'text-[#C2410C]'}`}
                aria-hidden="true"
              />
              <span>Difficult / Hard ({hardCount})</span>
            </button>
            <button
              type="button"
              disabled={dueOrHardCount === 0}
              onClick={() => resetSession('needs_review')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45 whitespace-nowrap cursor-pointer ${
                scope === 'needs_review'
                  ? 'bg-[#D4A338] text-[#1F2718]'
                  : 'text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              Due / Review ({dueOrHardCount})
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 border-b border-[#DCE5D3] pb-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2.5">
                <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2718]">
                  Practice Arena
                </h1>
                <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]">
                  أَلْعَابُ التَّعَلُّمِ
                </span>
              </div>
              <p className="text-xs text-[#5A6552] mt-1">
                {scope === 'hard'
                  ? 'Focused review of words you marked as Difficult / Hard while studying.'
                  : 'Smart Spaced Repetition (SRS) prioritizes Hard cards first, paired with Quizzes and Speed Match.'}
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
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#FBF3DC]/70 shadow-2xs transition-colors cursor-pointer"
                >
                  <NotebookPen className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                  <span className="font-arabic-cairo">ملاحظاتي</span>
                  <span>· Notes</span>
                  {notesCount > 0 && (
                    <span className="font-mono text-[11px] tabular-nums text-[#9A6F14]">
                      ({notesCount})
                    </span>
                  )}
                </button>
              )}

              {(gameMode === 'classic' || gameMode === 'quiz') && (
                <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white p-1 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => resetSession('all')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      scope === 'all'
                        ? 'bg-[#2D3B22] text-white'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    All Cards ({cards.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => resetSession('hard')}
                    className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      scope === 'hard'
                        ? 'bg-[#C2410C] text-white'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    <Flame
                      className={`h-3 w-3 ${scope === 'hard' ? 'text-white' : 'text-[#C2410C]'}`}
                      aria-hidden="true"
                    />
                    <span>Difficult / Hard ({hardCount})</span>
                  </button>
                  <button
                    type="button"
                    disabled={dueOrHardCount === 0}
                    onClick={() => resetSession('needs_review')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45 whitespace-nowrap cursor-pointer ${
                      scope === 'needs_review'
                        ? 'bg-[#D4A338] text-[#1F2718]'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    Due / Review ({dueOrHardCount})
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Smooth Game Mode Tabs */}
          <div
            role="tablist"
            aria-label="Practice game modes"
            className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/80 p-1 self-start"
          >
            <button
              type="button"
              role="tab"
              aria-selected={gameMode === 'classic'}
              onClick={() => setGameMode('classic')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                gameMode === 'classic'
                  ? 'bg-white text-[#2D3B22] shadow-xs'
                  : 'text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              <Layers className="h-3.5 w-3.5 text-[#2D3B22]" aria-hidden="true" />
              <span>Spaced Repetition Cards</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={gameMode === 'quiz'}
              onClick={() => setGameMode('quiz')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                gameMode === 'quiz'
                  ? 'bg-white text-[#9A6F14] shadow-xs'
                  : 'text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              <HelpCircle className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
              <span>Quiz Mode</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={gameMode === 'match'}
              onClick={() => setGameMode('match')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                gameMode === 'match'
                  ? 'bg-white text-[#2D3B22] shadow-xs'
                  : 'text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              <Zap className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
              <span>Speed Match</span>
            </button>
          </div>
        </div>
      )}

      {gameMode === 'quiz' && (
        <QuizMode
          cards={cards}
          speechRate={speechRate}
          scope={scope}
          onUpdateStatus={onUpdateStatus}
          onRateSrs={onRateSrs}
          onRecordReview={onRecordReview}
          onSwitchToAll={() => resetSession('all')}
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
          {scope === 'hard' && deck.length === 0 && !isComplete ? (
            <div className="rounded-2xl border border-[#DCE5D3] bg-white px-6 py-12 sm:py-14 text-center max-w-2xl mx-auto shadow-sm space-y-5">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FBF3DC] text-[#9A6F14] border border-[#E8B948]/40">
                <Flame className="h-6 w-6 text-[#D4A338]" aria-hidden="true" />
              </div>
              <div className="space-y-2">
                <p
                  dir="rtl"
                  lang="ar"
                  className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]"
                >
                  لا تُوجَدُ كَلِمَاتٌ صَعْبَةٌ حَالِيًّا
                </p>
                <h2 className="font-display text-2xl font-bold text-[#1F2718]">
                  No Words Marked as Difficult Yet
                </h2>
                <p className="text-sm text-[#5A6552] max-w-md mx-auto leading-relaxed">
                  While studying in <span className="font-semibold text-[#1F2718]">My Vocabulary</span>, flip any flashcard and tap{' '}
                  <span className="font-semibold text-[#C2410C]">Mark Hard</span> — or choose{' '}
                  <span className="font-semibold text-[#C2410C]">صعبة / Hard</span> during SRS practice — to collect tricky words here for focused review.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => resetSession('all')}
                  className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 shadow-xs transition-all cursor-pointer"
                >
                  <Layers className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                  <span>Practice All Saved Words ({cards.length})</span>
                </button>
                <button
                  type="button"
                  onClick={onGoToVocabulary}
                  className="rounded-xl border border-[#DCE5D3] bg-white px-5 py-2.5 text-sm font-semibold text-[#1F2718] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                >
                  Open My Vocabulary
                </button>
              </div>
            </div>
          ) : isComplete ? (
            <div className="rounded-2xl border border-[#DCE5D3] bg-white/95 backdrop-blur-md p-8 sm:p-10 text-center space-y-6 shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2E9] text-[#2D3B22]">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-2xl font-bold text-[#1F2718]">
                  SRS Session Complete
                </h2>
                <p className="text-sm text-[#5A6552]">
                  You completed{' '}
                  <span className="font-mono font-semibold text-[#1F2718]">
                    {sessionResults.hard + sessionResults.good + sessionResults.easy}
                  </span>{' '}
                  recall evaluations. Cards rated Hard are queued first next time.
                </p>
              </div>

              <div className="mx-auto grid max-w-md grid-cols-3 gap-4 border-y border-[#DCE5D3] py-5">
                <div>
                  <p className="font-mono text-2xl font-bold tabular-nums text-[#C2410C]">
                    {sessionResults.hard}
                  </p>
                  <p className="text-xs text-[#5A6552] mt-0.5">Hard · Review Soon</p>
                </div>
                <div>
                  <p className="font-mono text-2xl font-bold tabular-nums text-[#9A6F14]">
                    {sessionResults.good}
                  </p>
                  <p className="text-xs text-[#5A6552] mt-0.5">Good · 2 Days</p>
                </div>
                <div>
                  <p className="font-mono text-2xl font-bold tabular-nums text-[#2D3B22]">
                    {sessionResults.easy}
                  </p>
                  <p className="text-xs text-[#5A6552] mt-0.5">Easy · 1 Week</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => resetSession()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                  <span>Start Next Round</span>
                </button>
                <button
                  type="button"
                  onClick={onGoToVocabulary}
                  className="rounded-xl border border-[#DCE5D3] bg-white px-5 py-2.5 text-sm font-semibold text-[#1F2718] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                >
                  Back to My Vocabulary
                </button>
              </div>
            </div>
          ) : currentCard ? (
            <div className="space-y-5">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-[#5A6552] font-mono tabular-nums">
                  <span>
                    Card {currentIndex + 1} of {deck.length}
                    {scope === 'hard'
                      ? ' · Difficult / Hard Focus'
                      : currentCard.srsRating === 'hard'
                        ? ' · Priority Review'
                        : ''}
                  </span>
                  <span>
                    {Math.round(((currentIndex + 1) / deck.length) * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF2E9]">
                  <div
                    className="h-full bg-gradient-to-r from-[#D4A338] to-[#2D3B22] transition-all duration-300"
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
                onToggleDifficult={onToggleDifficult}
                onEdit={onEditCard}
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
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#1F2718] hover:bg-[#EEF2E9] disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Previous</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          unlockArabicAudioContext();
                          if (wordAudioState === 'loading') {
                            return;
                          }
                          if (wordAudioState !== 'idle') {
                            stopArabicSpeech();
                            setWordAudioState('idle');
                          } else {
                            speakArabic(currentCard.wordWithTashkeel, {
                              rate: speechRate,
                              mode: 'word',
                              vocalizedText: currentCard.hasCustomEdits
                                ? currentCard.wordWithTashkeel
                                : currentCard.vocalizedWord ||
                                  getLexiconSpeechText(
                                    currentCard.word,
                                    currentCard.wordWithTashkeel,
                                    currentCard.wordType,
                                    currentCard.partOfSpeech
                                  ),
                              meaningHint: currentCard.englishMeaning,
                              wordType: currentCard.wordType,
                              partOfSpeech: currentCard.partOfSpeech,
                              onLoading: () => setWordAudioState('loading'),
                              onStart: () => setWordAudioState('playing'),
                              onEnd: () => setWordAudioState('idle'),
                              onError: () => setWordAudioState('idle'),
                            });
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                          wordAudioState !== 'idle'
                            ? 'border-[#2D3B22] bg-[#2D3B22] text-[#E8B948] ring-4 ring-[#DCE5D3]'
                            : 'border-[#DCE5D3] bg-white text-[#1F2718] hover:bg-[#FBF3DC]'
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
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsFlipped(true)}
                      className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-[#2D3B22] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] shadow-xs transition-colors cursor-pointer"
                    >
                      <RotateCw className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                      <span>Flip Card to Rate Recall</span>
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[#DCE5D3] bg-white p-4 shadow-xs space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#1F2718]">
                        How well did you recall this word?
                      </span>
                      <span className="font-mono text-[#6B7861]">Keys: 1 · 2 · 3</span>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => handleSrsRate('hard')}
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-orange-200 bg-[#FEF2E8] px-4 py-3 text-[#9A3412] hover:bg-orange-100/70 transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                          <Flame className="h-4 w-4 text-[#C2410C]" aria-hidden="true" />
                          <span>صعبة / Hard</span>
                        </span>
                        <span className="text-[11px] font-medium text-[#C2410C]">
                          Review Soon
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSrsRate('good')}
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[#E8D7A7] bg-[#FBF3DC] px-4 py-3 text-[#1F2718] hover:bg-[#F5E7BC] transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                          <Clock className="h-4 w-4 text-[#9A6F14]" aria-hidden="true" />
                          <span>جيدة / Good</span>
                        </span>
                        <span className="text-[11px] font-medium text-[#9A6F14]">
                          Review in 2 days
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSrsRate('easy')}
                        className="flex flex-col items-center justify-center gap-1 rounded-xl border border-[#2D3B22] bg-[#2D3B22] px-4 py-3 text-white hover:bg-[#3E522D] transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                          <Sparkles className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                          <span>سهلة / Easy</span>
                        </span>
                        <span className="text-[11px] font-medium text-[#EEF2E9]">
                          Review in a week
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-center text-xs text-[#5A6552]">
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
