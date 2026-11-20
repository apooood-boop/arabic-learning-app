import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Compass,
  Crown,
  History,
  RotateCcw,
  Sparkles,
  Sprout,
  Trash2,
  Volume2,
} from 'lucide-react';
import { ProficiencyLevel, ReadingHistoryItem } from '../types/arabic';
import { applySmartPartialTashkeel, LEVEL_LABELS, stripTashkeel } from '../utils/arabic';

interface ReadingHistoryViewProps {
  history: ReadingHistoryItem[];
  onOpenLesson: (lessonId: string) => void;
  onClearHistory: () => void;
  onRemoveHistoryItem: (lessonId: string) => void;
  onGoToLessons: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

const LEVEL_STYLES: Record<
  ProficiencyLevel,
  {
    badgeClass: string;
    borderClass: string;
    gradientClass: string;
    Icon: typeof Sprout;
  }
> = {
  beginner: {
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    borderClass: 'hover:border-rose-400/70',
    gradientClass: 'from-rose-500 to-pink-600',
    Icon: Sprout,
  },
  intermediate: {
    badgeClass: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200',
    borderClass: 'hover:border-fuchsia-600/60',
    gradientClass: 'from-fuchsia-700 to-purple-800',
    Icon: Compass,
  },
  advanced: {
    badgeClass: 'bg-purple-50 text-purple-900 border-purple-200',
    borderClass: 'hover:border-purple-800/60',
    gradientClass: 'from-purple-900 to-indigo-950',
    Icon: Crown,
  },
};

export function ReadingHistoryView({
  history,
  onOpenLesson,
  onClearHistory,
  onRemoveHistoryItem,
  onGoToLessons,
}: ReadingHistoryViewProps) {
  const [filterLevel, setFilterLevel] = useState<'all' | ProficiencyLevel>('all');

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => b.lastReadAt - a.lastReadAt);
  }, [history]);

  const filteredHistory = useMemo(() => {
    if (filterLevel === 'all') return sortedHistory;
    return sortedHistory.filter((item) => item.level === filterLevel);
  }, [sortedHistory, filterLevel]);

  const stats = useMemo(() => {
    if (history.length === 0) return { count: 0, avgProgress: 0, completedCount: 0 };
    const totalProgress = history.reduce((sum, h) => sum + h.progressPercent, 0);
    const completedCount = history.filter((h) => h.progressPercent >= 100).length;
    return {
      count: history.length,
      avgProgress: Math.round(totalProgress / history.length),
      completedCount,
    };
  }, [history]);

  return (
    <section className="space-y-7">
      {/* Header Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#ECE8EF] pb-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#241734]">
              Reading History
            </h1>
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-3xl font-bold text-[#4C1D95] leading-normal"
            >
              سِجِلِّ القِرَاءَةِ
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Track reading engagement, word lookups, audio playback, and comprehension quiz scores.
          </p>
        </div>

        {history.length > 0 && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#ECE8EF] bg-white px-3.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-[#F7F4F9] hover:text-rose-700 transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset History</span>
            </button>
            <button
              type="button"
              onClick={onGoToLessons}
              className="inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-4.5 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#BE123C] shadow-xs transition-colors whitespace-nowrap cursor-pointer"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              <span>Browse Lessons</span>
            </button>
          </div>
        )}
      </div>

      {/* Summary KPI Cards */}
      {history.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-[#ECE8EF] bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">Lessons Engaged</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#241734]">
              {stats.count}
            </p>
          </div>
          <div className="rounded-2xl border border-[#ECE8EF] bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">Average Completion</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#E11D48]">
              {stats.avgProgress}%
            </p>
          </div>
          <div className="rounded-2xl border border-[#ECE8EF] bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">Fully Mastered (100%)</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#4C1D95]">
              {stats.completedCount}
            </p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {history.length === 0 ? (
        <div className="rounded-2xl border border-[#ECE8EF] bg-white px-6 py-16 text-center max-w-2xl mx-auto shadow-sm space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-[#E11D48]">
            <History className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-display text-xl font-bold text-[#241734]">
              No Reading History Yet
            </h2>
            <p
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-xl font-bold text-[#4C1D95]"
            >
              لا يوجد سجل قراءة حتى الآن
            </p>
            <p className="text-sm text-zinc-600 max-w-md mx-auto leading-relaxed pt-1">
              Start reading any lesson in the library. As you explore vocabulary, listen to audio,
              or test comprehension, your activity will be recorded here automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToLessons}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#E11D48] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#BE123C] shadow-sm transition-colors cursor-pointer"
          >
            <span>Start Reading Now</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Filter Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex items-center gap-1 rounded-xl border border-[#ECE8EF] bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setFilterLevel('all')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  filterLevel === 'all'
                    ? 'bg-[#4C1D95] text-white shadow-xs'
                    : 'text-zinc-600 hover:text-[#241734]'
                }`}
              >
                All ({history.length})
              </button>
              {(['beginner', 'intermediate', 'advanced'] as ProficiencyLevel[]).map((lvl) => {
                const count = history.filter((h) => h.level === lvl).length;
                return (
                  <button
                    key={lvl}
                    type="button"
                    disabled={count === 0}
                    onClick={() => setFilterLevel(lvl)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
                      filterLevel === lvl
                        ? 'bg-[#4C1D95] text-white shadow-xs'
                        : 'text-zinc-600 hover:text-[#241734]'
                    }`}
                  >
                    {LEVEL_LABELS[lvl].en} ({count})
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-zinc-500 font-mono">
              {filteredHistory.length} lesson{filteredHistory.length === 1 ? '' : 's'} shown
            </span>
          </div>

          {/* History List */}
          <div className="grid grid-cols-1 gap-4">
            {filteredHistory.map((item) => {
              const meta = LEVEL_STYLES[item.level];
              const LevelIcon = meta.Icon;
              const isMastered = item.progressPercent >= 100;

              return (
                <article
                  key={item.lessonId}
                  className="group rounded-2xl border border-[#ECE8EF] bg-white p-5 sm:p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-rose-300 flex flex-col md:flex-row md:items-center md:justify-between gap-5"
                >
                  {/* Left: Titles & Level */}
                  <div className="space-y-2.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}
                      >
                        <LevelIcon className="h-3 w-3" aria-hidden="true" />
                        <span>{LEVEL_LABELS[item.level].en}</span>
                      </span>

                      <span className="inline-flex items-center gap-1 text-xs text-zinc-500 font-mono">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        <span>Last read: {formatRelativeTime(item.lastReadAt)}</span>
                      </span>

                      {isMastered && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-purple-50 text-[#4C1D95] border border-purple-200 px-2 py-0.5 text-[11px] font-semibold">
                          <CheckCircle2 className="h-3 w-3 text-[#4C1D95]" aria-hidden="true" />
                          <span>Complete</span>
                        </span>
                      )}
                    </div>

                    {(() => {
                      const hasDistinctEn =
                        item.titleEn.trim().length > 0 &&
                        stripTashkeel(item.titleEn).trim().toLowerCase() !==
                          stripTashkeel(item.titleAr).trim().toLowerCase();
                      return (
                        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                          {hasDistinctEn && (
                            <h2 className="font-display text-lg font-bold text-[#241734] group-hover:text-[#E11D48] transition-colors">
                              {item.titleEn}
                            </h2>
                          )}
                          <h3
                            dir="rtl"
                            lang="ar"
                            className={`font-arabic-scheherazade text-2xl font-bold text-[#4C1D95] ${
                              hasDistinctEn ? 'text-right' : 'text-right w-full'
                            }`}
                          >
                            {applySmartPartialTashkeel(item.titleAr)}
                          </h3>
                        </div>
                      );
                    })()}

                    {/* Engagement details */}
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-zinc-600">
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                        <span>
                          <strong className="font-mono text-[#241734]">{item.wordsInteracted}</strong>
                          /{item.totalWords} words explored
                        </span>
                      </span>

                      {item.audioListened && (
                        <span className="inline-flex items-center gap-1 text-[#E11D48] font-medium">
                          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Audio listened</span>
                        </span>
                      )}

                      {item.quizScore && (
                        <span className="inline-flex items-center gap-1 text-[#581C87] font-medium">
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            Quiz: {item.quizScore.correct}/{item.quizScore.total} correct
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Progress bar & Action */}
                  <div className="flex flex-col sm:flex-row md:flex-col items-start md:items-end justify-between gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#ECE8EF]/70">
                    <div className="w-full sm:w-48 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500 font-medium">Progress</span>
                        <span className="font-mono font-bold text-[#E11D48] tabular-nums">
                          {item.progressPercent}%
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#F2EEF6]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#F43F5E] to-[#4C1D95] transition-all duration-300"
                          style={{ width: `${Math.min(100, item.progressPercent)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end">
                      <button
                        type="button"
                        onClick={() => onRemoveHistoryItem(item.lessonId)}
                        title="Remove from history"
                        aria-label={`Remove ${item.titleEn} from history`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onOpenLesson(item.lessonId)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#4C1D95] px-4 py-2 text-xs font-semibold text-white hover:bg-[#581C87] shadow-sm transition-colors cursor-pointer"
                      >
                        <span>Continue</span>
                        <ArrowRight className="h-3.5 w-3.5 text-rose-200" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
