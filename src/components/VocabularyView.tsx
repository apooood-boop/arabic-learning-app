import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  Flame,
  HelpCircle,
  Layers,
  LayoutGrid,
  Loader2,
  NotebookPen,
  Pencil,
  Play,
  RotateCw,
  Search,
  SquareStack,
  Trash2,
  Volume2,
  Zap,
} from 'lucide-react';
import { enrichWordMeta, getLexiconSpeechText } from '../data/fallbackLexicon';
import { NoteContextTag, PracticeStatus, SrsRating, VocabCard } from '../types/arabic';
import {
  applySmartPartialTashkeel,
  speakArabic,
  stopArabicSpeech,
  stripTashkeel,
  unlockArabicAudioContext,
} from '../utils/arabic';
import { exportVocabularyAsCsv, exportVocabularyAsJson } from '../utils/exportVocab';
import { EditVocabCardModal } from './EditVocabCardModal';
import { Flashcard3D } from './Flashcard3D';
import { PracticeMode, PracticeScope } from './PracticeMode';
import { QuizMode, SpeedMatchGame } from './VocabGames';

type VocabStudyMode = 'cards' | 'srs' | 'quiz' | 'match';
type CardsViewMode = 'grid' | 'focus';

interface VocabularyViewProps {
  cards: VocabCard[];
  speechRate: number;
  initialScope?: PracticeScope;
  scopeRequestSeq?: number;
  initialMode?: VocabStudyMode;
  onUpdateStatus: (id: string, status: PracticeStatus) => void;
  onToggleDifficult?: (id: string) => void;
  onRateSrs?: (id: string, rating: SrsRating) => void;
  onEditCard?: (updatedCard: VocabCard, previousCard: VocabCard) => void;
  onDeleteCard: (id: string) => void;
  onGoToLessons: () => void;
  onRecordReview: () => void;
  notesCount?: number;
  onOpenNotes?: (context?: NoteContextTag) => void;
}

export function VocabularyView({
  cards,
  speechRate,
  initialScope = 'all',
  scopeRequestSeq = 0,
  initialMode = 'cards',
  onUpdateStatus,
  onToggleDifficult,
  onRateSrs,
  onEditCard,
  onDeleteCard,
  onGoToLessons,
  onRecordReview,
  notesCount = 0,
  onOpenNotes,
}: VocabularyViewProps) {
  const [studyMode, setStudyMode] = useState<VocabStudyMode>(() =>
    initialScope === 'hard' && scopeRequestSeq > 0 ? 'srs' : initialMode
  );
  const [viewMode, setViewMode] = useState<CardsViewMode>('grid');
  const [filter, setFilter] = useState<'all' | 'hard' | PracticeStatus>(
    initialScope === 'hard' ? 'hard' : 'all'
  );
  const [query, setQuery] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportedFormat, setExportedFormat] = useState<'csv' | 'json' | null>(null);
  const [editingCard, setEditingCard] = useState<VocabCard | null>(null);

  // Compact Airy Grid: track expanded example drawer & audio loading/playing per card
  const [expandedGridCardId, setExpandedGridCardId] = useState<string | null>(null);
  const [gridAudioState, setGridAudioState] = useState<{
    cardId: string;
    phase: 'loading' | 'playing';
  } | null>(null);

  // Interactive Focus Card navigation state + slide animation direction
  const [focusIndex, setFocusIndex] = useState(0);
  const [focusFlipped, setFocusFlipped] = useState(false);
  const [slideDir, setSlideDir] = useState<'next' | 'prev'>('next');
  const [slideKey, setSlideKey] = useState(0);

  const exportMenuRef = useRef<HTMLDivElement>(null);
  const prevReqSeqRef = useRef(scopeRequestSeq);

  useEffect(() => {
    if (prevReqSeqRef.current !== scopeRequestSeq) {
      prevReqSeqRef.current = scopeRequestSeq;
      if (initialScope === 'hard') {
        setStudyMode('srs');
        setFilter('hard');
      } else {
        setStudyMode(initialMode);
      }
    }
  }, [scopeRequestSeq, initialScope, initialMode]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [exportMenuOpen]);

  const handleExport = (format: 'csv' | 'json') => {
    if (cards.length === 0) return;
    if (format === 'csv') {
      exportVocabularyAsCsv(cards);
    } else {
      exportVocabularyAsJson(cards);
    }
    setExportMenuOpen(false);
    setExportedFormat(format);
    window.setTimeout(() => setExportedFormat(null), 2200);
  };

  const learnedCount = useMemo(
    () => cards.filter((c) => c.status === 'learned').length,
    [cards]
  );
  const hardCount = useMemo(
    () => cards.filter((c) => c.srsRating === 'hard').length,
    [cards]
  );
  const reviewCount = cards.length - learnedCount;

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qStripped = stripTashkeel(q);
    return cards.filter((card) => {
      if (filter === 'hard' && card.srsRating !== 'hard') return false;
      if (filter !== 'all' && filter !== 'hard' && card.status !== filter) return false;
      if (!q) return true;
      return (
        card.englishMeaning.toLowerCase().includes(q) ||
        card.transliteration.toLowerCase().includes(q) ||
        stripTashkeel(card.wordWithTashkeel).includes(qStripped) ||
        card.wordWithTashkeel.includes(q)
      );
    });
  }, [cards, filter, query]);

  // Clamp focusIndex when filters change
  useEffect(() => {
    if (filteredCards.length === 0) {
      setFocusIndex(0);
    } else if (focusIndex >= filteredCards.length) {
      setFocusIndex(filteredCards.length - 1);
    }
    setFocusFlipped(false);
  }, [filteredCards.length, focusIndex]);

  const jumpToFocusCard = useCallback(
    (nextIdx: number) => {
      if (filteredCards.length === 0) return;
      const clamped =
        ((nextIdx % filteredCards.length) + filteredCards.length) % filteredCards.length;
      setSlideDir(clamped >= focusIndex ? 'next' : 'prev');
      setSlideKey((k) => k + 1);
      setFocusFlipped(false);
      setFocusIndex(clamped);
    },
    [filteredCards.length, focusIndex]
  );

  // Keyboard navigation in Focus Card view
  useEffect(() => {
    if (studyMode !== 'cards' || viewMode !== 'focus' || filteredCards.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        jumpToFocusCard(focusIndex + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        jumpToFocusCard(focusIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [studyMode, viewMode, filteredCards.length, focusIndex, jumpToFocusCard]);

  const handlePlayGridWord = (card: VocabCard) => {
    unlockArabicAudioContext();
    if (gridAudioState?.phase === 'loading') {
      return;
    }
    if (gridAudioState?.cardId === card.id) {
      stopArabicSpeech();
      setGridAudioState(null);
      return;
    }
    const { wordType } = enrichWordMeta(
      card.wordWithTashkeel,
      card.partOfSpeech,
      card.wordType,
      card.root
    );
    const vocalizedText = card.hasCustomEdits
      ? card.wordWithTashkeel
      : card.vocalizedWord ||
        getLexiconSpeechText(card.word, card.wordWithTashkeel, wordType, card.partOfSpeech);

    speakArabic(card.wordWithTashkeel, {
      rate: speechRate,
      mode: 'word',
      vocalizedText,
      meaningHint: card.englishMeaning,
      wordType,
      partOfSpeech: card.partOfSpeech,
      onLoading: () => setGridAudioState({ cardId: card.id, phase: 'loading' }),
      onStart: () => setGridAudioState({ cardId: card.id, phase: 'playing' }),
      onEnd: () =>
        setGridAudioState((curr) => (curr?.cardId === card.id ? null : curr)),
      onError: () => setGridAudioState(null),
    });
  };

  const handlePlayGridExample = (card: VocabCard, arabicSentence: string) => {
    unlockArabicAudioContext();
    if (gridAudioState?.phase === 'loading') {
      return;
    }
    const audioKey = `${card.id}::ex`;
    if (gridAudioState?.cardId === audioKey) {
      stopArabicSpeech();
      setGridAudioState(null);
      return;
    }
    speakArabic(arabicSentence, {
      rate: speechRate,
      mode: 'example',
      vocalizedText: arabicSentence,
      onLoading: () => setGridAudioState({ cardId: audioKey, phase: 'loading' }),
      onStart: () => setGridAudioState({ cardId: audioKey, phase: 'playing' }),
      onEnd: () =>
        setGridAudioState((curr) => (curr?.cardId === audioKey ? null : curr)),
      onError: () => setGridAudioState(null),
    });
  };

  const activeFocusCard = filteredCards[focusIndex] ?? null;

  return (
    <section className="space-y-8 animate-fade-slide-up">
      {/* Header Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#DCE5D3] pb-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2718]">
              My Vocabulary
            </h1>
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-3xl font-bold text-[#2D3B22] leading-normal"
            >
              مُفْرَدَاتِي الجَدِيدَةُ
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#5A6552] font-mono tabular-nums">
            <span>{cards.length} Total</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#2D3B22] font-semibold">{learnedCount} Learned</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#9A6F14] font-semibold">{reviewCount} Needs Review</span>
            {hardCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#C2410C] font-semibold">{hardCount} Hard</span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onOpenNotes && (
            <button
              type="button"
              onClick={() =>
                onOpenNotes({
                  type: 'vocab',
                  label: 'مفرداتي · My Vocabulary',
                })
              }
              className="inline-flex items-center gap-2 rounded-xl border border-[#DCE5D3] bg-white px-4 py-2.5 text-sm font-semibold text-[#2D3B22] hover:bg-[#FBF3DC]/70 shadow-2xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <NotebookPen className="h-4 w-4 text-[#D4A338]" aria-hidden="true" />
              <span className="font-arabic-cairo">ملاحظاتي</span>
              {notesCount > 0 && (
                <span className="font-mono text-xs tabular-nums text-[#9A6F14]">
                  ({notesCount})
                </span>
              )}
            </button>
          )}

          {cards.length > 0 && (
            <>
              <div className="relative" ref={exportMenuRef}>
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((prev) => !prev)}
                  aria-expanded={exportMenuOpen}
                  aria-haspopup="menu"
                  className="inline-flex items-center gap-2 rounded-xl border border-[#DCE5D3] bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2718] hover:bg-[#EEF2E9] shadow-2xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {exportedFormat ? (
                    <>
                      <Check className="h-4 w-4 text-[#2D3B22]" aria-hidden="true" />
                      <span className="text-[#2D3B22]">
                        Exported {exportedFormat.toUpperCase()}
                      </span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 text-[#9A6F14]" aria-hidden="true" />
                      <span>Export</span>
                      <ChevronDown className="h-3.5 w-3.5 text-[#5A6552]" aria-hidden="true" />
                    </>
                  )}
                </button>

                {exportMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Export vocabulary format"
                    className="animate-popover-in absolute right-0 top-12 z-30 w-64 rounded-2xl border border-[#DCE5D3] bg-white p-2 shadow-xl"
                  >
                    <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#5A6552]">
                      Offline Study Export ({cards.length} words)
                    </p>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleExport('csv')}
                      className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#FBF3DC] text-[#9A6F14]">
                        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-xs font-bold text-[#1F2718]">Export as CSV (.csv)</p>
                        <p className="text-[11px] text-[#5A6552]">
                          Spreadsheet &amp; Anki ready with Arabic context sentences
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleExport('json')}
                      className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#2D3B22]">
                        <FileJson className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-xs font-bold text-[#1F2718]">Export as JSON (.json)</p>
                        <p className="text-[11px] text-[#5A6552]">
                          Structured word entries &amp; context pairs
                        </p>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setStudyMode(studyMode === 'srs' ? 'cards' : 'srs')}
                className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-4.5 py-2.5 text-sm font-semibold text-white hover:brightness-110 shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98]"
              >
                <Play className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
                <span>{studyMode === 'srs' ? 'Browse Deck' : 'SRS Practice'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Empty State */}
      {cards.length === 0 ? (
        <div className="rounded-2xl border border-[#DCE5D3] bg-white px-6 py-16 text-center max-w-2xl mx-auto shadow-2xs">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF2E9] text-[#2D3B22]">
            <BookOpen className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="font-display text-xl font-bold text-[#1F2718]">
            Your vocabulary deck is empty
          </h2>
          <p className="mt-2 text-sm text-[#5A6552] max-w-md mx-auto leading-relaxed">
            Open any Arabic reading lesson, tap or right-click a word, and choose{' '}
            <span className="font-semibold text-[#1F2718]">Add to My Vocabulary</span> to build
            contextual flashcards, SRS decks, quizzes, and speed match games.
          </p>
          <button
            type="button"
            onClick={onGoToLessons}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] transition-colors cursor-pointer"
          >
            <span>Browse Arabic Lessons</span>
          </button>
        </div>
      ) : (
        <>
          {/* Unified Study & Mini-Game Switcher */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[#DCE5D3] bg-white px-4 py-3 shadow-2xs">
            <div className="flex items-baseline gap-2.5">
              <span className="text-sm font-bold text-[#1F2718]">Study &amp; Practice</span>
              <span
                dir="rtl"
                lang="ar"
                className="font-arabic-scheherazade text-lg font-bold text-[#2D3B22]"
              >
                المُرَاجَعَةُ وَالأَلْعَابُ
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Vocabulary study and game modes"
              className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/80 p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={studyMode === 'cards'}
                onClick={() => setStudyMode('cards')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  studyMode === 'cards'
                    ? 'bg-white text-[#2D3B22] shadow-xs'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
                }`}
              >
                <Layers className="h-3.5 w-3.5 text-[#2D3B22]" aria-hidden="true" />
                <span>Saved Cards</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={studyMode === 'srs'}
                onClick={() => setStudyMode('srs')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  studyMode === 'srs'
                    ? 'bg-white text-[#2D3B22] shadow-xs'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
                }`}
              >
                <SquareStack className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                <span>SRS Practice</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={studyMode === 'quiz'}
                onClick={() => setStudyMode('quiz')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  studyMode === 'quiz'
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
                aria-selected={studyMode === 'match'}
                onClick={() => setStudyMode('match')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  studyMode === 'match'
                    ? 'bg-white text-[#2D3B22] shadow-xs'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
                }`}
              >
                <Zap className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                <span>Speed Match</span>
              </button>
            </div>
          </div>

          {studyMode === 'cards' && (
            <div className="space-y-6">
              {/* Filter + Search + Two View Modes Switcher */}
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white p-1 self-start shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === 'all'
                        ? 'bg-[#2D3B22] text-white'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    All ({cards.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter('hard')}
                    className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === 'hard'
                        ? 'bg-[#C2410C] text-white'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    <Flame
                      className={`h-3 w-3 ${filter === 'hard' ? 'text-white' : 'text-[#C2410C]'}`}
                      aria-hidden="true"
                    />
                    <span>Hard ({hardCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter('needs_review')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === 'needs_review'
                        ? 'bg-[#D4A338] text-[#1F2718]'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    Needs Review ({reviewCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter('learned')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === 'learned'
                        ? 'bg-[#2D3B22] text-white'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    Learned ({learnedCount})
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* View Mode Switcher: Compact Airy Grid vs Interactive Focus Card */}
                  <div
                    role="group"
                    aria-label="Vocabulary card layout view mode"
                    className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/90 p-1 shadow-2xs"
                  >
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      aria-pressed={viewMode === 'grid'}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                        viewMode === 'grid'
                          ? 'bg-[#2D3B22] text-[#FEF08A] shadow-xs'
                          : 'text-[#5A6552] hover:text-[#1F2718]'
                      }`}
                    >
                      <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="font-arabic-cairo">شبكة مريحة</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('focus')}
                      aria-pressed={viewMode === 'focus'}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                        viewMode === 'focus'
                          ? 'bg-[#2D3B22] text-[#FEF08A] shadow-xs'
                          : 'text-[#5A6552] hover:text-[#1F2718]'
                      }`}
                    >
                      <SquareStack className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="font-arabic-cairo">بطاقة التركيز</span>
                    </button>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7861]"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search Arabic or English..."
                      aria-label="Search saved vocabulary"
                      className="w-full rounded-xl border border-[#DCE5D3] bg-white py-2 pl-9 pr-3 text-base sm:text-sm text-[#1F2718] placeholder:text-[#6B7861] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
                    />
                  </div>
                </div>
              </div>

              {filteredCards.length === 0 ? (
                <div className="rounded-2xl border border-[#DCE5D3] bg-white p-10 text-center text-sm text-[#5A6552]">
                  {filter === 'hard' && !query
                    ? 'No flashcards are marked as Difficult / Hard yet. Tap the flame icon on any card to mark it Hard.'
                    : 'No flashcards match your current search or filter.'}
                </div>
              ) : viewMode === 'grid' ? (
                /* VIEW MODE 1: شبكة مريحة (Compact Airy Grid) */
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 pt-1">
                  {filteredCards.map((card, idx) => {
                    const isAudioLoading =
                      gridAudioState?.cardId === card.id && gridAudioState.phase === 'loading';
                    const isAudioPlaying =
                      gridAudioState?.cardId === card.id && gridAudioState.phase === 'playing';
                    const isExpanded = expandedGridCardId === card.id;
                    const { wordType, root } = enrichWordMeta(
                      card.wordWithTashkeel,
                      card.partOfSpeech,
                      card.wordType,
                      card.root
                    );

                    return (
                      <article
                        key={card.id}
                        style={{ animationDelay: `${Math.min(idx, 8) * 35}ms` }}
                        className="animate-fade-slide-up group flex flex-col justify-between rounded-2xl border border-[#DCE5D3] bg-white p-5 shadow-2xs transition-all duration-200 hover:-translate-y-1 hover:border-[#3B4D2B]/55 hover:shadow-md"
                      >
                        {/* Top row: status text + quick actions */}
                        <div className="flex items-center justify-between gap-2 border-b border-[#EEF2E9] pb-3">
                          <div className="flex items-center gap-2 text-[11px] font-semibold">
                            <span
                              className={
                                card.status === 'learned' ? 'text-[#2D3B22]' : 'text-[#9A6F14]'
                              }
                            >
                              {card.status === 'learned' ? 'Learned' : 'Needs Review'}
                            </span>
                            {wordType && (
                              <>
                                <span aria-hidden="true" className="text-[#DCE5D3]">
                                  ·
                                </span>
                                <span className="font-arabic-cairo text-[#5A6552]">{wordType}</span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handlePlayGridWord(card)}
                              aria-label={`Pronounce ${card.wordWithTashkeel}`}
                              title="Pronounce word"
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-all cursor-pointer touch-manipulation ${
                                gridAudioState?.cardId === card.id
                                  ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FEF08A] ring-2 ring-[#DCE5D3]'
                                  : 'border-[#DCE5D3] bg-[#FBF3DC]/70 text-[#9A6F14] hover:bg-[#FBF3DC]'
                              }`}
                            >
                              {isAudioLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Volume2
                                  className={`h-3.5 w-3.5 ${isAudioPlaying ? 'animate-pulse' : ''}`}
                                  aria-hidden="true"
                                />
                              )}
                            </button>

                            {onToggleDifficult && (
                              <button
                                type="button"
                                onClick={() => onToggleDifficult(card.id)}
                                aria-pressed={card.srsRating === 'hard'}
                                title={
                                  card.srsRating === 'hard'
                                    ? 'Remove Difficult/Hard mark'
                                    : 'Mark as Difficult / Hard'
                                }
                                aria-label="Toggle difficult"
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors cursor-pointer touch-manipulation ${
                                  card.srsRating === 'hard'
                                    ? 'border-orange-300 bg-[#FEF2E8] text-[#C2410C]'
                                    : 'border-[#DCE5D3] bg-white text-[#6B7861] hover:border-orange-200 hover:text-[#C2410C]'
                                }`}
                              >
                                <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Center concise Arabic + English */}
                        <div className="py-4 text-center space-y-1.5">
                          <p
                            dir="rtl"
                            lang="ar"
                            className="font-arabic-scheherazade text-4xl font-bold text-[#1F2718] leading-[1.75]"
                          >
                            {card.hasCustomEdits
                              ? card.wordWithTashkeel
                              : applySmartPartialTashkeel(card.wordWithTashkeel)}
                          </p>
                          <p className="font-mono text-[11px] text-[#5A6552]">
                            {card.transliteration}
                            {root ? ` · ${root}` : ''}
                          </p>
                          <p className="text-sm font-bold text-[#2D3B22] pt-1">
                            {card.englishMeaning}
                          </p>
                        </div>

                        {/* Expandable concise example snippet */}
                        {isExpanded && card.examples[0] && (
                          <div className="mb-3 rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] p-3 space-y-1 animate-fade-slide-up">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => handlePlayGridExample(card, card.examples[0].arabic)}
                                aria-label="Pronounce example sentence"
                                className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                                  gridAudioState?.cardId === `${card.id}::ex`
                                    ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FEF08A]'
                                    : 'border-[#DCE5D3] bg-white text-[#9A6F14] hover:bg-[#FBF3DC]'
                                }`}
                              >
                                {gridAudioState?.cardId === `${card.id}::ex` &&
                                gridAudioState.phase === 'loading' ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Volume2
                                    className={`h-3.5 w-3.5 ${
                                      gridAudioState?.cardId === `${card.id}::ex`
                                        ? 'animate-pulse'
                                        : ''
                                    }`}
                                    aria-hidden="true"
                                  />
                                )}
                              </button>
                              <p
                                dir="rtl"
                                lang="ar"
                                className="font-arabic-scheherazade flex-1 text-lg text-[#1F2718] leading-[1.9] text-right"
                              >
                                {card.hasCustomEdits
                                  ? card.examples[0].arabic
                                  : applySmartPartialTashkeel(card.examples[0].arabic)}
                              </p>
                            </div>
                            <p className="text-xs text-[#5A6552] leading-relaxed">
                              {card.examples[0].english}
                            </p>
                          </div>
                        )}

                        {/* Footer actions */}
                        <div className="flex items-center justify-between gap-2 border-t border-[#EEF2E9] pt-3 text-xs">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateStatus(
                                  card.id,
                                  card.status === 'learned' ? 'needs_review' : 'learned'
                                )
                              }
                              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                                card.status === 'learned'
                                  ? 'bg-[#EEF2E9] text-[#2D3B22] hover:bg-[#DCE5D3]'
                                  : 'bg-[#2D3B22] text-white hover:bg-[#3E522D]'
                              }`}
                            >
                              <Check className="h-3 w-3" aria-hidden="true" />
                              <span>{card.status === 'learned' ? 'Learned' : 'Mark Learned'}</span>
                            </button>

                            {card.examples.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedGridCardId(isExpanded ? null : card.id)
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-[#DCE5D3] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#5A6552] hover:text-[#1F2718] cursor-pointer"
                              >
                                <RotateCw className="h-3 w-3 text-[#D4A338]" aria-hidden="true" />
                                <span>{isExpanded ? 'Hide' : 'Context'}</span>
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            {onEditCard && (
                              <button
                                type="button"
                                onClick={() => setEditingCard(card)}
                                title="Edit Arabic word & diacritics"
                                aria-label={`تعديل / Edit ${card.wordWithTashkeel}`}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[#5A6552] hover:bg-[#EEF2E9] hover:text-[#2D3B22] transition-colors cursor-pointer"
                              >
                                <Pencil className="h-3 w-3 text-[#9A6F14]" aria-hidden="true" />
                                <span className="font-arabic-cairo">تعديل</span>
                                <span aria-hidden="true" className="text-[#DCE5D3]">/</span>
                                <span>Edit</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setViewMode('focus');
                                jumpToFocusCard(idx);
                              }}
                              title="Open in Interactive Focus Card view"
                              className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[#9A6F14] hover:bg-[#FBF3DC] cursor-pointer"
                            >
                              Focus
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteCard(card.id)}
                              aria-label={`Remove ${card.wordWithTashkeel}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#6B7861] hover:bg-[#FEF2E8] hover:text-[#C2410C] cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                /* VIEW MODE 2: بطاقة التركيز (Interactive Focus Card with Smooth Slide Transitions + Quick-Jump Strip) */
                <div className="mx-auto max-w-2xl space-y-5 py-2">
                  {/* Top progress & Prev/Next header */}
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => jumpToFocusCard(focusIndex - 1)}
                      disabled={filteredCards.length <= 1}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2 text-xs font-semibold text-[#1F2718] hover:bg-[#EEF2E9] disabled:opacity-45 transition-all active:scale-95 cursor-pointer"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Previous</span>
                    </button>

                    <div className="text-center">
                      <span className="font-mono text-xs font-bold tabular-nums text-[#2D3B22]">
                        Card {focusIndex + 1} of {filteredCards.length}
                      </span>
                      <span className="mx-2 text-[#DCE5D3]" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-arabic-cairo text-xs font-semibold text-[#9A6F14]">
                        بطاقة التركيز
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => jumpToFocusCard(focusIndex + 1)}
                      disabled={filteredCards.length <= 1}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#2D3B22] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3E522D] disabled:opacity-45 transition-all active:scale-95 cursor-pointer"
                    >
                      <span>Next</span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Animated Focus 3D Card */}
                  {activeFocusCard && (
                    <div
                      key={`${activeFocusCard.id}-${slideKey}`}
                      className={slideDir === 'next' ? 'animate-card-next' : 'animate-card-prev'}
                    >
                      <Flashcard3D
                        card={activeFocusCard}
                        speechRate={speechRate}
                        large
                        controlledFlipped={focusFlipped}
                        onFlipChange={setFocusFlipped}
                        onUpdateStatus={onUpdateStatus}
                        onToggleDifficult={onToggleDifficult}
                        onEdit={onEditCard ? (c) => setEditingCard(c) : undefined}
                        onDelete={onDeleteCard}
                      />
                    </div>
                  )}

                  {/* Quick-Jump Strip */}
                  {filteredCards.length > 1 && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between text-[11px] text-[#5A6552]">
                        <span>Quick jump across saved words</span>
                        <span className="font-mono">← / → navigate · Space flip</span>
                      </div>
                      <div
                        dir="rtl"
                        className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar touch-pan-x"
                      >
                        {filteredCards.map((c, i) => {
                          const isCurrent = i === focusIndex;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => jumpToFocusCard(i)}
                              className={`font-arabic-scheherazade rounded-xl border px-3.5 py-1.5 text-lg font-bold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                                isCurrent
                                  ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FEF08A] shadow-xs scale-[1.03]'
                                  : 'border-[#DCE5D3] bg-white text-[#1F2718] hover:border-[#D4A338] hover:bg-[#FBF3DC]/60'
                              }`}
                            >
                              {c.hasCustomEdits
                                ? c.wordWithTashkeel
                                : applySmartPartialTashkeel(c.wordWithTashkeel)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {studyMode === 'srs' && (
            <PracticeMode
              cards={cards}
              speechRate={speechRate}
              initialScope={initialScope}
              scopeRequestSeq={scopeRequestSeq}
              onUpdateStatus={onUpdateStatus}
              onToggleDifficult={onToggleDifficult}
              onEditCard={onEditCard ? (c) => setEditingCard(c) : undefined}
              onRateSrs={onRateSrs ?? (() => {})}
              onGoToLessons={onGoToLessons}
              onGoToVocabulary={() => setStudyMode('cards')}
              onRecordReview={onRecordReview}
              notesCount={notesCount}
              onOpenNotes={onOpenNotes}
              embeddedInVocab
            />
          )}

          {studyMode === 'quiz' && (
            <QuizMode
              cards={cards}
              speechRate={speechRate}
              onUpdateStatus={onUpdateStatus}
              onRateSrs={onRateSrs}
              onRecordReview={onRecordReview}
            />
          )}

          {studyMode === 'match' && (
            <SpeedMatchGame
              cards={cards}
              speechRate={speechRate}
              onRecordMatchComplete={onRecordReview}
            />
          )}
        </>
      )}

      {editingCard && onEditCard && (
        <EditVocabCardModal
          card={editingCard}
          speechRate={speechRate}
          onClose={() => setEditingCard(null)}
          onSave={(updatedCard, previousCard) => {
            onEditCard(updatedCard, previousCard);
            setEditingCard(null);
          }}
        />
      )}
    </section>
  );
}
