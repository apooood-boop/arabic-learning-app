import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CheckCircle2, Flame, TrendingUp } from 'lucide-react';
import { VocabCard } from '../types/arabic';

export interface DailyStudyLog {
  added: number;
  reviewed: number;
  translated: number;
}

interface WeeklyVocabChartProps {
  vocabCards: VocabCard[];
  dailyLogs: Record<string, DailyStudyLog>;
}

interface ChartPoint {
  dateKey: string;
  dayLabel: string;
  fullDate: string;
  activity: number;
  cumulativeLearned: number;
  added: number;
  reviewed: number;
  translated: number;
}

const WEEKLY_WORDS_GOAL = 20;
const WEEKLY_ACTIONS_GOAL = 35;

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  chartMode: 'daily' | 'cumulative';
}

function CustomTooltip({ active, payload, chartMode }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-xl border border-[#ECE8EF]/90 bg-white/95 backdrop-blur-md px-3 py-2 shadow-md text-[11px]">
      <p className="font-semibold text-[#241734] mb-1">{point.fullDate}</p>
      {chartMode === 'daily' ? (
        <div className="space-y-0.5 font-mono tabular-nums">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 font-sans">Actions</span>
            <span className="font-bold text-[#E11D48]">{point.activity}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 font-sans">Saved / Reviewed</span>
            <span className="text-zinc-800">{point.added + point.reviewed}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5 font-mono tabular-nums">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 font-sans">Total cards</span>
            <span className="font-bold text-[#4C1D95]">{point.cumulativeLearned}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500 font-sans">Added</span>
            <span className="text-zinc-800">+{point.added}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function WeeklyVocabChart({ vocabCards, dailyLogs }: WeeklyVocabChartProps) {
  const [chartMode, setChartMode] = useState<'daily' | 'cumulative'>('daily');

  const chartData = useMemo<ChartPoint[]>(() => {
    const today = new Date();
    const days: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      days.push(d);
    }

    const cardsAddedByDay = new Map<string, number>();
    const cardsReviewedByDay = new Map<string, number>();

    for (const card of vocabCards) {
      const createdKey = toLocalDateKey(new Date(card.createdAt));
      cardsAddedByDay.set(createdKey, (cardsAddedByDay.get(createdKey) ?? 0) + 1);
      if (card.lastReviewedAt) {
        const revKey = toLocalDateKey(new Date(card.lastReviewedAt));
        cardsReviewedByDay.set(revKey, (cardsReviewedByDay.get(revKey) ?? 0) + 1);
      }
    }

    const firstWindowKey = toLocalDateKey(days[0]);
    let runningTotal = vocabCards.filter(
      (c) => toLocalDateKey(new Date(c.createdAt)) < firstWindowKey
    ).length;

    return days.map((d) => {
      const key = toLocalDateKey(d);
      const log = dailyLogs[key];
      const added = Math.max(log?.added ?? 0, cardsAddedByDay.get(key) ?? 0);
      const reviewed = Math.max(log?.reviewed ?? 0, cardsReviewedByDay.get(key) ?? 0);
      const translated = log?.translated ?? 0;
      const activity = added + reviewed + translated;
      runningTotal += added;

      return {
        dateKey: key,
        dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }),
        fullDate: d.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        activity,
        cumulativeLearned: runningTotal,
        added,
        reviewed,
        translated,
      };
    });
  }, [vocabCards, dailyLogs]);

  const weeklyWordsLearned = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentLearned = vocabCards.filter(
      (c) =>
        c.status === 'learned' &&
        ((c.lastReviewedAt ?? c.createdAt) >= sevenDaysAgo)
    ).length;
    const totalLearned = vocabCards.filter((c) => c.status === 'learned').length;
    return Math.max(recentLearned, totalLearned > 0 && recentLearned === 0 ? totalLearned : recentLearned);
  }, [vocabCards]);

  const weeklyTotalActions = useMemo(
    () => chartData.reduce((sum, pt) => sum + pt.activity, 0),
    [chartData]
  );

  const wordsProgressPct = Math.min(100, Math.round((weeklyWordsLearned / WEEKLY_WORDS_GOAL) * 100));
  const actionsProgressPct = Math.min(100, Math.round((weeklyTotalActions / WEEKLY_ACTIONS_GOAL) * 100));

  return (
    <section
      aria-label="Weekly vocabulary learning progress"
      className="mx-auto w-full max-w-lg rounded-2xl border border-[#ECE8EF] bg-white p-5 shadow-sm"
    >
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-3 pb-3.5 border-b border-[#ECE8EF]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-[#E11D48] border border-rose-200/70">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <h2 className="font-display text-sm font-bold text-[#241734] truncate">
            Weekly Vocabulary Progress
          </h2>
        </div>

        <div className="inline-flex items-center gap-0.5 rounded-lg border border-[#ECE8EF] bg-[#F7F4F9] p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setChartMode('daily')}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              chartMode === 'daily'
                ? 'bg-[#4C1D95] text-white shadow-xs'
                : 'text-zinc-600 hover:text-[#241734]'
            }`}
          >
            Activity
          </button>
          <button
            type="button"
            onClick={() => setChartMode('cumulative')}
            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              chartMode === 'cumulative'
                ? 'bg-[#4C1D95] text-white shadow-xs'
                : 'text-zinc-600 hover:text-[#241734]'
            }`}
          >
            Growth
          </button>
        </div>
      </div>

      {/* Concise Weekly Goal Progress Bars */}
      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
              <span>Words learned this week</span>
            </span>
            <span className="font-mono font-semibold tabular-nums text-[#E11D48]">
              {weeklyWordsLearned}/{WEEKLY_WORDS_GOAL}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#F2EEF6]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#F43F5E] to-[#E11D48] transition-all duration-300"
              style={{ width: `${wordsProgressPct}%` }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
              <Flame className="h-3.5 w-3.5 text-[#4C1D95]" aria-hidden="true" />
              <span>Study actions this week</span>
            </span>
            <span className="font-mono font-semibold tabular-nums text-[#4C1D95]">
              {weeklyTotalActions}/{WEEKLY_ACTIONS_GOAL}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#F2EEF6]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-600 to-[#4C1D95] transition-all duration-300"
              style={{ width: `${actionsProgressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Compact Non-Intrusive Sparkline Chart */}
      <div className="mt-4 pt-3 border-t border-[#ECE8EF]">
        <div className="h-[104px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 6, right: 8, left: -24, bottom: 0 }}
            >
              <defs>
                <linearGradient id="plumPeachLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#F43F5E" />
                  <stop offset="55%" stopColor="#E11D48" />
                  <stop offset="100%" stopColor="#4C1D95" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ECE8EF" />
              <XAxis
                dataKey="dayLabel"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6B5F7A', fontSize: 10 }}
                dy={4}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#6B5F7A', fontSize: 10 }}
                domain={[0, (dataMax: number) => Math.max(4, dataMax + 1)]}
              />
              <Tooltip
                content={<CustomTooltip chartMode={chartMode} />}
                cursor={{ stroke: '#D8D0DF', strokeWidth: 1, strokeDasharray: '3 3' }}
              />
              <Line
                type="monotone"
                dataKey={chartMode === 'daily' ? 'activity' : 'cumulativeLearned'}
                stroke="url(#plumPeachLine)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#FFFFFF', stroke: '#E11D48', strokeWidth: 1.75 }}
                activeDot={{ r: 5, fill: '#4C1D95', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                animationDuration={350}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
