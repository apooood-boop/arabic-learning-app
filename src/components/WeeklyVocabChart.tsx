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
  embedded?: boolean;
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
    <div className="rounded-xl border border-[#DCE5D3] bg-white/95 backdrop-blur-md px-3 py-2 shadow-md text-[11px]">
      <p className="font-semibold text-[#1F2718] mb-1">{point.fullDate}</p>
      {chartMode === 'daily' ? (
        <div className="space-y-0.5 font-mono tabular-nums">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#5A6552] font-sans">Actions</span>
            <span className="font-bold text-[#9A6F14]">{point.activity}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#5A6552] font-sans">Saved / Reviewed</span>
            <span className="text-[#1F2718]">{point.added + point.reviewed}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5 font-mono tabular-nums">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#5A6552] font-sans">Total cards</span>
            <span className="font-bold text-[#2D3B22]">{point.cumulativeLearned}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#5A6552] font-sans">Added</span>
            <span className="text-[#1F2718]">+{point.added}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function WeeklyVocabChart({
  vocabCards,
  dailyLogs,
  embedded = false,
}: WeeklyVocabChartProps) {
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
        (c.lastReviewedAt ?? c.createdAt) >= sevenDaysAgo
    ).length;
    const totalLearned = vocabCards.filter((c) => c.status === 'learned').length;
    return Math.max(
      recentLearned,
      totalLearned > 0 && recentLearned === 0 ? totalLearned : recentLearned
    );
  }, [vocabCards]);

  const weeklyTotalActions = useMemo(
    () => chartData.reduce((sum, pt) => sum + pt.activity, 0),
    [chartData]
  );

  const wordsProgressPct = Math.min(100, Math.round((weeklyWordsLearned / WEEKLY_WORDS_GOAL) * 100));
  const actionsProgressPct = Math.min(100, Math.round((weeklyTotalActions / WEEKLY_ACTIONS_GOAL) * 100));

  const wrapperClass = embedded
    ? 'w-full'
    : 'mx-auto w-full max-w-lg rounded-2xl border border-[#DCE5D3] bg-white p-5 shadow-sm';

  return (
    <div aria-label="Weekly vocabulary learning progress" className={wrapperClass}>
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-3 pb-3.5 border-b border-[#EEF2E9]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#FBF3DC] text-[#9A6F14] border border-[#E8B948]/40">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-sm font-bold text-[#1F2718] truncate">
              Weekly Vocabulary Progress
            </h3>
            <p dir="rtl" lang="ar" className="font-arabic-cairo text-[11px] font-semibold text-[#5A6552]">
              التقدّم الأسبوعي في المفردات
            </p>
          </div>
        </div>

        <div className="inline-flex items-center gap-0.5 rounded-lg border border-[#DCE5D3] bg-[#EEF2E9] p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setChartMode('daily')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              chartMode === 'daily'
                ? 'bg-[#2D3B22] text-white shadow-xs'
                : 'text-[#5A6552] hover:text-[#1F2718]'
            }`}
          >
            Activity
          </button>
          <button
            type="button"
            onClick={() => setChartMode('cumulative')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              chartMode === 'cumulative'
                ? 'bg-[#2D3B22] text-white shadow-xs'
                : 'text-[#5A6552] hover:text-[#1F2718]'
            }`}
          >
            Growth
          </button>
        </div>
      </div>

      {/* Concise Weekly Goal Progress Bars */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#2D3B22]">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#3E522D]" aria-hidden="true" />
              <span>Words learned this week</span>
            </span>
            <span className="font-mono font-semibold tabular-nums text-[#2D3B22]">
              {weeklyWordsLearned}/{WEEKLY_WORDS_GOAL}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF2E9]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#3E522D] to-[#24301B] transition-all duration-500 ease-out"
              style={{ width: `${wordsProgressPct}%` }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#2D3B22]">
              <Flame className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
              <span>Study actions this week</span>
            </span>
            <span className="font-mono font-semibold tabular-nums text-[#9A6F14]">
              {weeklyTotalActions}/{WEEKLY_ACTIONS_GOAL}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF2E9]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#D4A338] to-[#E8B948] transition-all duration-500 ease-out"
              style={{ width: `${actionsProgressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Compact Non-Intrusive Sparkline Chart */}
      <div className="mt-4 pt-3 border-t border-[#EEF2E9]">
        <div className="h-[116px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 6, right: 8, left: -24, bottom: 0 }}
            >
              <defs>
                <linearGradient id="oliveGoldLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#D4A338" />
                  <stop offset="55%" stopColor="#3E522D" />
                  <stop offset="100%" stopColor="#24301B" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF2E9" />
              <XAxis
                dataKey="dayLabel"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#5A6552', fontSize: 10 }}
                dy={4}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#5A6552', fontSize: 10 }}
                domain={[0, (dataMax: number) => Math.max(4, dataMax + 1)]}
              />
              <Tooltip
                content={<CustomTooltip chartMode={chartMode} />}
                cursor={{ stroke: '#DCE5D3', strokeWidth: 1, strokeDasharray: '3 3' }}
              />
              <Line
                type="monotone"
                dataKey={chartMode === 'daily' ? 'activity' : 'cumulativeLearned'}
                stroke="url(#oliveGoldLine)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#FFFFFF', stroke: '#D4A338', strokeWidth: 1.75 }}
                activeDot={{ r: 5, fill: '#2D3B22', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                animationDuration={350}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
