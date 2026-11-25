import {
  buildDailyCurriculumDraftLesson,
  buildExistingTopicSet,
  CURRICULUM_LEVELS,
  DAILY_CURRICULUM_QUOTA_PER_LEVEL,
  isTopicDuplicate,
  registerSeenTopic,
  selectFallbackSeedsForLevel,
} from '../data/dailyCurriculumBank';
import { SAMPLE_LESSONS } from '../data/lessons';
import { AuthUser, Lesson, ProficiencyLevel } from '../types/arabic';
import { getClientGeminiApiKey } from './geminiAuth';
import { isSupabaseConfigured } from './supabaseClient';
import { upsertLessonsBatchToCloud } from './supabaseSync';

const DAILY_CURRICULUM_LAST_RUN_KEY = 'qalam_daily_curriculum_last_run_v1';

function getLocalDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface DailyCurriculumRunResult {
  ok: boolean;
  date: string;
  skipped: boolean;
  addedLessons: Lesson[];
  source: 'gemini' | 'curated-fallback' | 'skipped';
  modelUsed?: string;
  notice?: string;
}

export function getMissingCurriculumCountsForDate(
  lessons: Lesson[],
  dateKey: string
): Record<ProficiencyLevel, number> {
  const countsByLevel: Record<ProficiencyLevel, number> = {
    beginner: 0,
    intermediate: 0,
    advanced: 0,
  };

  for (const lesson of lessons) {
    if (lesson.isDailyCurriculum && lesson.curriculumDate === dateKey) {
      countsByLevel[lesson.level] = (countsByLevel[lesson.level] || 0) + 1;
    }
  }

  return {
    beginner: Math.max(0, DAILY_CURRICULUM_QUOTA_PER_LEVEL - countsByLevel.beginner),
    intermediate: Math.max(0, DAILY_CURRICULUM_QUOTA_PER_LEVEL - countsByLevel.intermediate),
    advanced: Math.max(0, DAILY_CURRICULUM_QUOTA_PER_LEVEL - countsByLevel.advanced),
  };
}

export function hasReachedDailyCurriculumQuota(
  lessons: Lesson[],
  dateKey: string
): boolean {
  const missing = getMissingCurriculumCountsForDate(lessons, dateKey);
  return CURRICULUM_LEVELS.every((lvl) => missing[lvl] === 0);
}

export function getLastAutoCurriculumRunDate(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(DAILY_CURRICULUM_LAST_RUN_KEY);
  } catch {
    return null;
  }
}

export function markDailyCurriculumRanForDate(dateKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DAILY_CURRICULUM_LAST_RUN_KEY, dateKey);
  } catch {
    // Ignore storage errors
  }
}

function collectExistingTopicStrings(lessons: Lesson[]): string[] {
  const topics: string[] = [];
  for (const lesson of [...SAMPLE_LESSONS, ...lessons]) {
    if (lesson.topicKey) topics.push(lesson.topicKey);
    if (lesson.titleEn) topics.push(lesson.titleEn);
    if (lesson.titleAr) topics.push(lesson.titleAr);
  }
  return topics;
}

function normalizeDraftLessons(lessons: Lesson[]): Lesson[] {
  return lessons.map((lesson) => ({
    ...lesson,
    isCustom: true,
    status: 'draft',
    isPublic: false,
    isDailyCurriculum: true,
    authorName: lesson.authorName || 'Qalam Curriculum Agent',
    authorId: 'system-curriculum-agent',
    authorRole: 'admin',
  }));
}

let inFlightDailyRun: Promise<DailyCurriculumRunResult> | null = null;

export async function runDailyCurriculumAgent(options: {
  existingLessons: Lesson[];
  currentUser: AuthUser | null;
  force?: boolean;
  dateKey?: string;
}): Promise<DailyCurriculumRunResult> {
  const dateKey = options.dateKey || getLocalDateKey();
  const missingCounts = getMissingCurriculumCountsForDate(options.existingLessons, dateKey);
  const totalNeeded =
    missingCounts.beginner + missingCounts.intermediate + missingCounts.advanced;

  if (totalNeeded === 0) {
    markDailyCurriculumRanForDate(dateKey);
    const dailyTotal = DAILY_CURRICULUM_QUOTA_PER_LEVEL * CURRICULUM_LEVELS.length;
    return {
      ok: true,
      date: dateKey,
      skipped: true,
      addedLessons: [],
      source: 'skipped',
      notice: `All ${dailyTotal} curated lessons for ${dateKey} (${DAILY_CURRICULUM_QUOTA_PER_LEVEL} per level) are already generated.`,
    };
  }

  if (!options.force && getLastAutoCurriculumRunDate() === dateKey) {
    return {
      ok: true,
      date: dateKey,
      skipped: true,
      addedLessons: [],
      source: 'skipped',
    };
  }

  if (inFlightDailyRun) {
    return inFlightDailyRun;
  }

  inFlightDailyRun = (async (): Promise<DailyCurriculumRunResult> => {
    const existingTopics = collectExistingTopicStrings(options.existingLessons);
    const seenTopics = buildExistingTopicSet(existingTopics);
    const apiKey = getClientGeminiApiKey() || undefined;

    let generatedDrafts: Lesson[] = [];
    let source: 'gemini' | 'curated-fallback' = 'curated-fallback';
    let modelUsed: string | undefined;
    let notice: string | undefined;

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(new DOMException('Curriculum request timed out', 'TimeoutError')),
        45000
      );

      let response: Response;
      try {
        response = await fetch('/api/curriculum/daily', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: dateKey,
            missingCounts,
            existingTopics,
            apiKey,
          }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (response.ok) {
        const data = (await response.json()) as {
          ok?: boolean;
          lessons?: Lesson[];
          source?: 'gemini' | 'curated-fallback';
          modelUsed?: string;
          notice?: string;
        };

        if (Array.isArray(data.lessons) && data.lessons.length > 0) {
          const accepted: Lesson[] = [];
          const acceptedCounts: Record<ProficiencyLevel, number> = {
            beginner: 0,
            intermediate: 0,
            advanced: 0,
          };

          for (const rawLesson of data.lessons) {
            const lvl = rawLesson.level;
            if (!CURRICULUM_LEVELS.includes(lvl)) continue;
            if (acceptedCounts[lvl] >= missingCounts[lvl]) continue;
            if (isTopicDuplicate(rawLesson, seenTopics)) continue;

            registerSeenTopic(rawLesson, seenTopics);
            acceptedCounts[lvl] += 1;
            accepted.push(rawLesson);
          }

          generatedDrafts = normalizeDraftLessons(accepted);
          source = data.source || 'gemini';
          modelUsed = data.modelUsed;
          notice = data.notice;
        }
      } else {
        notice = `Curriculum endpoint returned HTTP ${response.status}; using curated curriculum bank.`;
      }
    } catch (err) {
      console.warn('[Qalam Curriculum Agent] Daily curriculum endpoint error, using local curated bank:', err);
      notice = 'Live AI curriculum service busy; drafted lessons from curated Arabic bank.';
    }

    // Fill any remaining missing slots cleanly without duplicates
    for (const level of CURRICULUM_LEVELS) {
      const currentlyFilled = generatedDrafts.filter((l) => l.level === level).length;
      const remaining = Math.max(0, missingCounts[level] - currentlyFilled);
      if (remaining > 0) {
        const seeds = selectFallbackSeedsForLevel(level, remaining, seenTopics, dateKey);
        seeds.forEach((seed, idx) => {
          generatedDrafts.push(
            buildDailyCurriculumDraftLesson(seed, dateKey, currentlyFilled + idx + 1)
          );
        });
      }
    }

    generatedDrafts = normalizeDraftLessons(generatedDrafts);

    if (generatedDrafts.length > 0 && isSupabaseConfigured()) {
      await upsertLessonsBatchToCloud(options.currentUser, generatedDrafts);
    }

    markDailyCurriculumRanForDate(dateKey);

    return {
      ok: true,
      date: dateKey,
      skipped: false,
      addedLessons: generatedDrafts,
      source,
      modelUsed,
      notice,
    };
  })();

  try {
    return await inFlightDailyRun;
  } finally {
    inFlightDailyRun = null;
  }
}
