import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  HelpCircle,
  Layers,
  NotebookPen,
  Play,
  Search,
  Zap,
} from 'lucide-react';
import { NoteContextTag, PracticeStatus, VocabCard } from '../types/arabic';
import { stripTashkeel } from '../utils/arabic';
import { exportVocabularyAsCsv, exportVocabularyAsJson } from '../utils/exportVocab';
import { Flashcard3D } from './Flashcard3D';
import { GameModeType, QuizMode, SpeedMatchGame } from './VocabGames';

interface VocabularyViewProps {
  cards: VocabCard[];
  speechRate: number;
  onUpdateStatus: (id: string, status: PracticeStatus) => void;
  onDeleteCard: (id: string) => void;
  onGoToLessons: () => void;
  onStartPractice: () => void;
  onRecordReview: () => void;
  notesCount?: number;
  onOpenNotes?: (context?: NoteContextTag) => void;
}

export function VocabularyView({
  cards,
  speechRate,
  onUpdateStatus,
  onDeleteCard,
  onGoToLessons,
  onStartPractice,
  onRecordReview,
  notesCount = 0,
  onOpenNotes,
}: VocabularyViewProps) {
  const [gameMode, setGameMode] = useState<GameModeType>('classic');
  const [filter, setFilter] = useState<'all' | PracticeStatus>('all');
  const [query, setQuery] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportedFormat, setExportedFormat] = useState<'csv' | 'json' | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

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
  const reviewCount = cards.length - learnedCount;

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qStripped = stripTashkeel(q);
    return cards.filter((card) => {
      if (filter !== 'all' && card.status !== filter) return false;
      if (!q) return true;
      return (
        card.englishMeaning.toLowerCase().includes(q) ||
        card.transliteration.toLowerCase().includes(q) ||
        stripTashkeel(card.wordWithTashkeel).includes(qStripped) ||
        card.wordWithTashkeel.includes(q)
      );
    });
  }, [cards, filter, query]);

  return (
    <section className="space-y-7">
      {/* Header Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#ECE8EF] pb-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#241734]">
              My Vocabulary
            </h1>
            <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-3xl font-bold text-[#4C1D95] leading-normal">
              مُفْرَدَاتِي الجَدِيدَةُ
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 font-mono tabular-nums">
            <span>{cards.length} Total</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#4C1D95] font-medium">{learnedCount} Learned</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#E11D48] font-medium">{reviewCount} Needs Review</span>
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
              className="inline-flex items-center gap-2 rounded-xl border border-purple-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#4C1D95] hover:bg-purple-50 shadow-2xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <NotebookPen className="h-4 w-4 text-[#E11D48]" aria-hidden="true" />
              <span>ملاحظاتي · Notes</span>
              {notesCount > 0 && (
                <span className="font-mono text-xs tabular-nums text-[#E11D48]">
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
                  className="inline-flex items-center gap-2 rounded-xl border border-[#ECE8EF] bg-white px-4 py-2.5 text-sm font-semibold text-[#241734] hover:bg-[#F7F4F9] shadow-2xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {exportedFormat ? (
                    <>
                      <Check className="h-4 w-4 text-[#E11D48]" aria-hidden="true" />
                      <span className="text-[#E11D48]">
                        Exported {exportedFormat.toUpperCase()}
                      </span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 text-[#E11D48]" aria-hidden="true" />
                      <span>Export Vocabulary</span>
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                    </>
                  )}
                </button>

                {exportMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Export vocabulary format"
                    className="animate-popover-in absolute right-0 top-12 z-30 w-64 rounded-2xl border border-[#ECE8EF] bg-white p-2 shadow-xl"
                  >
                    <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Offline Study Export ({cards.length} words)
                    </p>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleExport('csv')}
                      className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-[#F7F4F9] transition-colors cursor-pointer"
                    >
                      <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-[#E11D48]" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-bold text-[#241734]">Export as CSV (.csv)</p>
                        <p className="text-[11px] text-zinc-500">
                          Spreadsheet &amp; Anki ready with Arabic context sentences
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleExport('json')}
                      className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-[#F7F4F9] transition-colors cursor-pointer"
                    >
                      <FileJson className="mt-0.5 h-4 w-4 shrink-0 text-[#4C1D95]" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-bold text-[#241734]">Export as JSON (.json)</p>
                        <p className="text-[11px] text-zinc-500">
                          Structured word entries &amp; context pairs
                        </p>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onStartPractice}
                className="inline-flex items-center gap-2 rounded-xl bg-[#4C1D95] px-4.5 py-2.5 text-sm font-semibold text-white hover:bg-[#581C87] shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="h-4 w-4 text-rose-200" aria-hidden="true" />
                <span>Focused Deck Mode</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Empty State */}
      {cards.length === 0 ? (
        <div className="rounded-2xl border border-[#ECE8EF] bg-white px-6 py-16 text-center max-w-2xl mx-auto shadow-2xs">
          <BookOpen className="mx-auto h-10 w-10 text-[#E11D48] mb-4" aria-hidden="true" />
          <h2 className="font-display text-xl font-bold text-[#241734]">
            Your vocabulary deck is empty
          </h2>
          <p className="mt-2 text-sm text-zinc-600 max-w-md mx-auto leading-relaxed">
            Open any Arabic reading lesson, tap or right-click a word, and choose{' '}
            <span className="font-semibold text-[#241734]">Add to My Vocabulary</span> to build
            contextual 3D flashcards and unlock Quiz &amp; Speed Match games.
          </p>
          <button
            type="button"
            onClick={onGoToLessons}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#BE123C] transition-colors cursor-pointer"
          >
            <span>Browse Arabic Lessons</span>
          </button>
        </div>
      ) : (
        <>
          {/* Interactive Game Mode Switcher (ألعاب التعلم) */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[#ECE8EF] bg-white px-4 py-3 shadow-2xs">
            <div className="flex items-baseline gap-2.5">
              <span className="text-sm font-bold text-[#241734]">Game Mode</span>
              <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-lg font-bold text-[#4C1D95]">
                أَلْعَابُ التَّعَلُّمِ
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Vocabulary learning game modes"
              className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-[#ECE8EF] bg-[#F7F4F9] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'classic'}
                onClick={() => setGameMode('classic')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'classic'
                    ? 'bg-white text-[#241734] shadow-xs'
                    : 'text-zinc-600 hover:text-[#241734]'
                }`}
              >
                <Layers className="h-3.5 w-3.5 text-[#4C1D95]" aria-hidden="true" />
                <span>Classic Cards</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={gameMode === 'quiz'}
                onClick={() => setGameMode('quiz')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  gameMode === 'quiz'
                    ? 'bg-white text-[#E11D48] shadow-xs'
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
                    ? 'bg-white text-fuchsia-800 shadow-xs'
                    : 'text-zinc-600 hover:text-[#241734]'
                }`}
              >
                <Zap className="h-3.5 w-3.5 text-fuchsia-700" aria-hidden="true" />
                <span>Speed Match</span>
              </button>
            </div>
          </div>

          {gameMode === 'classic' && (
            <>
              {/* Filter & Search Toolbar */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex items-center gap-1 rounded-xl border border-[#ECE8EF] bg-white p-1 self-start shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === 'all'
                        ? 'bg-[#4C1D95] text-white'
                        : 'text-zinc-600 hover:text-[#241734]'
                    }`}
                  >
                    All ({cards.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter('needs_review')}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === 'needs_review'
                        ? 'bg-[#E11D48] text-white'
                        : 'text-zinc-600 hover:text-[#241734]'
                    }`}
                  >
                    Needs Review ({reviewCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter('learned')}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === 'learned'
                        ? 'bg-[#4C1D95] text-white'
                        : 'text-zinc-600 hover:text-[#241734]'
                    }`}
                  >
                    Learned ({learnedCount})
                  </button>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Arabic or English..."
                    aria-label="Search saved vocabulary"
                    className="w-full rounded-xl border border-[#ECE8EF] bg-white py-2 pl-9 pr-3 text-sm text-[#241734] placeholder:text-zinc-400 focus:border-[#E11D48] focus:outline-none focus:ring-2 focus:ring-[#E11D48]/20"
                  />
                </div>
              </div>

              {/* Flashcards Grid */}
              {filteredCards.length === 0 ? (
                <div className="rounded-2xl border border-[#ECE8EF] bg-white p-10 text-center text-sm text-zinc-500">
                  No flashcards match your current search or filter.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {filteredCards.map((card) => (
                    <Flashcard3D
                      key={card.id}
                      card={card}
                      speechRate={speechRate}
                      onUpdateStatus={onUpdateStatus}
                      onDelete={onDeleteCard}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {gameMode === 'quiz' && (
            <QuizMode
              cards={cards}
              speechRate={speechRate}
              onUpdateStatus={onUpdateStatus}
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
        </>
      )}
    </section>
  );
}
