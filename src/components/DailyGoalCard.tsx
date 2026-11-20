import { useMemo, useState } from 'react';
import { CheckCircle2, Minus, Plus, SlidersHorizontal, Target } from 'lucide-react';
import { VocabCard } from '../types/arabic';
import { DailyStudyLog } from './WeeklyVocabChart';

interface DailyGoalCardProps {
  dailyGoal: number;
  onChangeDailyGoal: (nextGoal: number) => void;
  vocabCards: VocabCard[];
  todayLog?: DailyStudyLog;
  todayKey: string;
}

const GOAL_PRESETS = [3, 5, 10, 15];

function toLocalDateKey(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function DailyGoalCard({
  dailyGoal,
  onChangeDailyGoal,
  vocabCards,
  todayLog,
  todayKey,
}: DailyGoalCardProps) {
  const [isEditing, setIsEditing] = useState(false);

  const safeGoal = Math.max(1, Math.min(50, dailyGoal));

  const wordsToday = useMemo(() => {
    const touchedIds = new Set<string>();
    for (const card of vocabCards) {
      if (toLocalDateKey(card.createdAt) === todayKey) {
        touchedIds.add(card.id);
      } else if (
        card.lastReviewedAt &&
        card.status === 'learned' &&
        toLocalDateKey(card.lastReviewedAt) === todayKey
      ) {
        touchedIds.add(card.id);
      }
    }
    return Math.max(touchedIds.size, todayLog?.added ?? 0);
  }, [vocabCards, todayLog, todayKey]);

  const ratio = Math.min(1, wordsToday / safeGoal);
  const percentage = Math.round(ratio * 100);
  const remaining = Math.max(0, safeGoal - wordsToday);
  const isGoalReached = wordsToday >= safeGoal;

  // SVG Circular Progress Ring geometry
  const size = 104;
  const strokeWidth = 9;
  const center = size / 2;
  const radius = center - strokeWidth / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - ratio);

  return (
    <section
      aria-label="My Daily Goal"
      className="rounded-2xl border border-[#ECE8EF] bg-white p-5 shadow-sm flex flex-col justify-between gap-4"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              isGoalReached
                ? 'bg-[#E11D48] text-white shadow-xs'
                : 'bg-rose-50 text-[#E11D48] border border-rose-200/70'
            }`}
          >
            <Target className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-sm font-bold text-[#241734]">
                My Daily Goal
              </h2>
              <span
                dir="rtl"
                lang="ar"
                className="font-arabic-scheherazade text-lg font-bold text-[#4C1D95] leading-none"
              >
                هدفي اليومي
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              Target: <span className="font-mono font-semibold text-[#241734]">{safeGoal}</span>{' '}
              {safeGoal === 1 ? 'word' : 'words'} / day
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsEditing((prev) => !prev)}
          aria-expanded={isEditing}
          className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
            isEditing
              ? 'border-rose-300 bg-rose-50 text-rose-900'
              : 'border-[#ECE8EF] bg-white text-zinc-700 hover:bg-[#F7F4F9]'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isEditing ? 'Done' : 'Set Goal'}</span>
        </button>
      </div>

      {/* Circular Progress Ring + Status */}
      <div className="flex items-center gap-5">
        <div className="relative flex h-[104px] w-[104px] shrink-0 items-center justify-center">
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="-rotate-90"
            role="progressbar"
            aria-valuenow={wordsToday}
            aria-valuemin={0}
            aria-valuemax={safeGoal}
            aria-label={`Daily word goal progress: ${wordsToday} of ${safeGoal} words`}
          >
            <defs>
              <linearGradient id="dailyGoalRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F43F5E" />
                <stop offset="100%" stopColor="#4C1D95" />
              </linearGradient>
            </defs>

            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="#ECE8EF"
              strokeWidth={strokeWidth}
            />

            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke="url(#dailyGoalRingGrad)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-[stroke-dashoffset] duration-500 ease-out"
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-mono text-lg font-bold tabular-nums text-[#241734] leading-none">
              {wordsToday}/{safeGoal}
            </span>
            <span
              className={`mt-1 font-mono text-[11px] font-semibold tabular-nums ${
                isGoalReached ? 'text-[#E11D48]' : 'text-zinc-500'
              }`}
            >
              {percentage}%
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          {isGoalReached ? (
            <div className="space-y-1">
              <p className="inline-flex items-center gap-1.5 text-sm font-bold text-[#E11D48]">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#E11D48]" aria-hidden="true" />
                <span>Daily goal achieved!</span>
              </p>
              <p
                dir="rtl"
                lang="ar"
                className="font-arabic-scheherazade text-lg text-[#4C1D95] leading-snug text-right sm:text-left font-bold"
              >
                أحسنتَ! أنجزتَ هدفكَ اليوميَّ.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#241734]">
                <span className="font-mono font-bold text-[#E11D48]">{remaining}</span>{' '}
                {remaining === 1 ? 'word' : 'words'} left today
              </p>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Save or master words from any reading passage to fill your daily ring.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Expandable / Quick Target Customizer */}
      {isEditing && (
        <div className="border-t border-[#ECE8EF] pt-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-700">
              Daily word target
            </span>
            <div className="inline-flex items-center gap-1 rounded-xl border border-[#ECE8EF] bg-[#F7F4F9] p-0.5">
              <button
                type="button"
                onClick={() => onChangeDailyGoal(Math.max(1, safeGoal - 1))}
                aria-label="Decrease daily word target"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-700 hover:bg-white cursor-pointer"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="w-8 text-center font-mono text-xs font-bold tabular-nums text-[#241734]">
                {safeGoal}
              </span>
              <button
                type="button"
                onClick={() => onChangeDailyGoal(Math.min(50, safeGoal + 1))}
                aria-label="Increase daily word target"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-700 hover:bg-white cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {GOAL_PRESETS.map((preset) => {
              const selected = safeGoal === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChangeDailyGoal(preset)}
                  className={`rounded-xl border py-1.5 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                    selected
                      ? 'border-[#4C1D95] bg-[#4C1D95] text-white shadow-xs'
                      : 'border-[#ECE8EF] bg-white text-zinc-700 hover:border-rose-400 hover:bg-rose-50/40'
                  }`}
                >
                  {preset}/day
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
