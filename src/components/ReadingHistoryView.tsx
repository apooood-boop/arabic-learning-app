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
    badgeClass: 'bg-[#EEF2E9] text-[#2D3B22] border-[#DCE5D3]',
    borderClass: 'hover:border-[#3E522D]/60',
    gradientClass: 'from-[#3E522D] to-[#2D3B22]',
    Icon: Sprout,
  },
  intermediate: {
    badgeClass: 'bg-[#FBF3DC] text-[#9A6F14] border-[#E8D7A7]',
    borderClass: 'hover:border-[#D4A338]/70',
    gradientClass: 'from-[#D4A338] to-[#9A6F14]',
    Icon: Compass,
  },
  advanced: {
    badgeClass: 'bg-[#24301B] text-[#E8B948] border-[#3E522D]',
    borderClass: 'hover:border-[#24301B]/70',
    gradientClass: 'from-[#24301B] to-[#3E522D]',
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
    <section className="space-y-7 animate-fade-slide-up">
      {/* Header Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#DCE5D3] pb-5">
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2718]">
              Reading History
            </h1>
            <span
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-3xl font-bold text-[#2D3B22] leading-normal"
            >
              سِجِلِّ القِرَاءَةِ
            </span>
          </div>
          <p className="text-xs text-[#5A6552]">
            Track reading engagement, word lookups, audio playback, and comprehension quiz scores.
          </p>
        </div>

        {history.length > 0 && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2 text-xs font-semibold text-[#5A6552] hover:bg-[#FEF2E8] hover:text-[#C2410C] transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset History</span>
            </button>
            <button
              type="button"
              onClick={onGoToLessons}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-4.5 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#3E522D] shadow-xs transition-colors whitespace-nowrap cursor-pointer"
            >
              <BookOpen className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
              <span>Browse Lessons</span>
            </button>
          </div>
        )}
      </div>

      {/* Summary KPI Cards */}
      {history.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-[#DCE5D3] bg-white p-4 shadow-sm flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[#5A6552]">Lessons Engaged</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#1F2718]">
                {stats.count}
              </p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF2E9] text-[#2D3B22]">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
          <div className="rounded-2xl border border-[#DCE5D3] bg-white p-4 shadow-sm flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[#5A6552]">Average Completion</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#9A6F14]">
                {stats.avgProgress}%
              </p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FBF3DC] text-[#9A6F14]">
              <Clock className="h-5 w-5 text-[#D4A338]" aria-hidden="true" />
            </span>
          </div>
          <div className="rounded-2xl border border-[#DCE5D3] bg-white p-4 shadow-sm flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[#5A6552]">Fully Mastered (100%)</p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#2D3B22]">
                {stats.completedCount}
              </p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF2E9] text-[#2D3B22]">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {history.length === 0 ? (
        <div className="rounded-2xl border border-[#DCE5D3] bg-white px-6 py-16 text-center max-w-2xl mx-auto shadow-sm space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FBF3DC] text-[#9A6F14]">
            <History className="h-6 w-6 text-[#D4A338]" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-display text-xl font-bold text-[#1F2718]">
              No Reading History Yet
            </h2>
            <p
              dir="rtl"
              lang="ar"
              className="font-arabic-scheherazade text-xl font-bold text-[#2D3B22]"
            >
              لا يوجد سجل قراءة حتى الآن
            </p>
            <p className="text-sm text-[#5A6552] max-w-md mx-auto leading-relaxed pt-1">
              Start reading any lesson in the library. As you explore vocabulary, listen to audio,
              or test comprehension, your activity will be recorded here automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToLessons}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#2D3B22] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3E522D] shadow-sm transition-colors cursor-pointer"
          >
            <span>Start Reading Now</span>
            <ArrowRight className="h-4 w-4 text-[#E8B948]" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5D3] bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setFilterLevel('all')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  filterLevel === 'all'
                    ? 'bg-[#2D3B22] text-white shadow-xs'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
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
                        ? 'bg-[#2D3B22] text-white shadow-xs'
                        : 'text-[#5A6552] hover:text-[#1F2718]'
                    }`}
                  >
                    {LEVEL_LABELS[lvl].en} ({count})
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-[#5A6552] font-mono">
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
                  className="group rounded-2xl border border-[#DCE5D3] bg-white p-5 sm:p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-[#D4A338] flex flex-col md:flex-row md:items-center md:justify-between gap-5"
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

                      <span className="inline-flex items-center gap-1 text-xs text-[#5A6552] font-mono">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        <span>Last read: {formatRelativeTime(item.lastReadAt)}</span>
                      </span>

                      {isMastered && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-[#EEF2E9] text-[#2D3B22] border border-[#DCE5D3] px-2 py-0.5 text-[11px] font-semibold">
                          <CheckCircle2 className="h-3 w-3 text-[#2D3B22]" aria-hidden="true" />
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
                            <h2 className="font-display text-lg font-bold text-[#1F2718] group-hover:text-[#9A6F14] transition-colors">
                              {item.titleEn}
                            </h2>
                          )}
                          <h3
                            dir="rtl"
                            lang="ar"
                            className={`font-arabic-scheherazade text-2xl font-bold text-[#2D3B22] ${
                              hasDistinctEn ? 'text-right' : 'text-right w-full'
                            }`}
                          >
                            {applySmartPartialTashkeel(item.titleAr)}
                          </h3>
                        </div>
                      );
                    })()}

                    {/* Engagement details */}
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-[#5A6552]">
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="h-3.5 w-3.5 text-[#6B7861]" aria-hidden="true" />
                        <span>
                          <strong className="font-mono text-[#1F2718]">{item.wordsInteracted}</strong>
                          /{item.totalWords} words explored
                        </span>
                      </span>

                      {item.audioListened && (
                        <span className="inline-flex items-center gap-1 text-[#9A6F14] font-medium">
                          <Volume2 className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                          <span>Audio listened</span>
                        </span>
                      )}

                      {item.quizScore && (
                        <span className="inline-flex items-center gap-1 text-[#2D3B22] font-medium">
                          <Sparkles className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                          <span>
                            Quiz: {item.quizScore.correct}/{item.quizScore.total} correct
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Progress bar & Action */}
                  <div className="flex flex-col sm:flex-row md:flex-col items-start md:items-end justify-between gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#DCE5D3]/80">
                    <div className="w-full sm:w-48 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[#5A6552] font-medium">Progress</span>
                        <span className="font-mono font-bold text-[#9A6F14] tabular-nums">
                          {item.progressPercent}%
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF2E9]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#D4A338] to-[#2D3B22] transition-all duration-300"
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
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7861] hover:text-[#C2410C] hover:bg-[#FEF2E8] transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onOpenLesson(item.lessonId)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#2D3B22] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3E522D] shadow-sm transition-colors cursor-pointer"
                      >
                        <span>Continue</span>
                        <ArrowRight className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
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
