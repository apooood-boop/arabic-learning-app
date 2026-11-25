import {
  buildDailyCurriculumDraftLesson,
  buildDailyCurriculumPrompt,
  buildExistingTopicSet,
  CURRICULUM_LEVELS,
  CurriculumLessonSeed,
  DAILY_CURRICULUM_QUOTA_PER_LEVEL,
  isTopicDuplicate,
  registerSeenTopic,
  selectFallbackSeedsForLevel,
} from './src/data/dailyCurriculumBank';
import type { Lesson, ProficiencyLevel } from './src/types/arabic';

interface WorkerAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv {
  GEMINI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  ASSETS?: WorkerAssetsBinding;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-goog-api-key',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

function getTrimmedKey(raw?: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed && trimmed !== 'MY_GEMINI_API_KEY' ? trimmed : '';
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDateKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const WORKER_TEXT_MODEL_FALLBACK_ORDER = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
];

async function generateDailyCurriculumDraftsOnWorker(params: {
  env: WorkerEnv;
  dateKey: string;
  missingCounts: Record<ProficiencyLevel, number>;
  existingTopics: string[];
  clientApiKey?: string;
}): Promise<{
  date: string;
  lessons: Lesson[];
  source: 'gemini' | 'curated-fallback';
  modelUsed?: string;
  notice?: string;
}> {
  const { env, dateKey, missingCounts, existingTopics, clientApiKey } = params;
  const seenTopics = buildExistingTopicSet(existingTopics);
  const apiKey =
    getTrimmedKey(clientApiKey) ||
    getTrimmedKey(env.GEMINI_API_KEY) ||
    getTrimmedKey(env.VITE_GEMINI_API_KEY);

  const generatedLessons: Lesson[] = [];
  const filledCounts: Record<ProficiencyLevel, number> = {
    beginner: 0,
    intermediate: 0,
    advanced: 0,
  };

  let source: 'gemini' | 'curated-fallback' = 'curated-fallback';
  let modelUsed: string | undefined;
  let notice: string | undefined;

  if (apiKey) {
    const prompt = buildDailyCurriculumPrompt(dateKey, missingCounts, existingTopics);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey.startsWith('ya29.')) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      headers['x-goog-api-key'] = apiKey;
    }

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    };

    for (const modelName of WORKER_TEXT_MODEL_FALLBACK_ORDER) {
      const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
      let succeeded = false;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          await waitMs(700 * attempt);
        }
        try {
          const upstream = await fetch(upstreamUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          const text = await upstream.text().catch(() => '');

          if (!upstream.ok) {
            if (upstream.status === 404) break;
            if (
              upstream.status === 503 ||
              upstream.status === 429 ||
              /"status"\s*:\s*"UNAVAILABLE"/i.test(text)
            ) {
              continue;
            }
            break;
          }

          const outer = JSON.parse(text) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const innerText = outer?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleanedJson = innerText
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
          const parsed = JSON.parse(cleanedJson) as {
            lessons?: Array<Partial<CurriculumLessonSeed>>;
          };

          if (Array.isArray(parsed?.lessons)) {
            for (const rawItem of parsed.lessons) {
              const lvl = rawItem.level;
              if (!lvl || !CURRICULUM_LEVELS.includes(lvl)) continue;
              if (filledCounts[lvl] >= missingCounts[lvl]) continue;
              if (!rawItem.titleAr || !rawItem.titleEn || !rawItem.textAr) continue;

              const seed: CurriculumLessonSeed = {
                level: lvl,
                topicKey: String(rawItem.topicKey || rawItem.titleEn),
                titleAr: String(rawItem.titleAr),
                titleEn: String(rawItem.titleEn),
                description: String(
                  rawItem.description || `Curated ${lvl} Arabic reading passage.`
                ),
                textAr: String(rawItem.textAr),
              };
              if (isTopicDuplicate(seed, seenTopics)) continue;

              registerSeenTopic(seed, seenTopics);
              filledCounts[lvl] += 1;
              generatedLessons.push(
                buildDailyCurriculumDraftLesson(seed, dateKey, filledCounts[lvl])
              );
            }
            source = 'gemini';
            modelUsed = modelName;
            succeeded = true;
            break;
          }
        } catch {
          // Retry or fall back cleanly
        }
      }

      if (succeeded) break;
    }
  } else {
    notice = 'Gemini key not configured on Worker; drafted from curated Arabic bank.';
  }

  for (const level of CURRICULUM_LEVELS) {
    const remaining = Math.max(0, missingCounts[level] - filledCounts[level]);
    if (remaining > 0) {
      const seeds = selectFallbackSeedsForLevel(level, remaining, seenTopics, dateKey);
      seeds.forEach((seed) => {
        filledCounts[level] += 1;
        generatedLessons.push(
          buildDailyCurriculumDraftLesson(seed, dateKey, filledCounts[level])
        );
      });
    }
  }

  return { date: dateKey, lessons: generatedLessons, source, modelUsed, notice };
}

async function persistDraftsToSupabaseIfConfigured(
  env: WorkerEnv,
  lessons: Lesson[]
): Promise<void> {
  const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseKey = (env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey || lessons.length === 0) return;

  const rows = lessons.map((lesson) => {
    const titleAr = (lesson.titleAr || '').trim();
    const titleEn = (lesson.titleEn || '').trim();
    const title =
      titleAr && titleEn && titleAr !== titleEn
        ? `${titleAr} | ${titleEn}`
        : titleAr || titleEn || 'Untitled Lesson';

    return {
      id: lesson.id,
      title,
      content: lesson.textAr || '',
      level: lesson.level,
      is_public: false,
      status: 'draft',
      author_id: null,
      created_at: new Date(lesson.createdAt || Date.now()).toISOString(),
    };
  });

  await fetch(`${supabaseUrl}/rest/v1/lessons?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  }).catch(() => undefined);
}

export default {
  async scheduled(_event: unknown, env: WorkerEnv, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    const dateKey = getDateKey();
    const task = (async () => {
      const result = await generateDailyCurriculumDraftsOnWorker({
        env,
        dateKey,
        missingCounts: {
          beginner: DAILY_CURRICULUM_QUOTA_PER_LEVEL,
          intermediate: DAILY_CURRICULUM_QUOTA_PER_LEVEL,
          advanced: DAILY_CURRICULUM_QUOTA_PER_LEVEL,
        },
        existingTopics: [],
      });
      await persistDraftsToSupabaseIfConfigured(env, result.lessons);
    })();
    ctx.waitUntil(task);
  },

  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (url.pathname === '/api/curriculum/daily') {
      if (request.method === 'GET') {
        return jsonResponse({
          ok: true,
          date: url.searchParams.get('date') || getDateKey(),
          quotaPerLevel: DAILY_CURRICULUM_QUOTA_PER_LEVEL,
          dailyTotal: DAILY_CURRICULUM_QUOTA_PER_LEVEL * CURRICULUM_LEVELS.length,
        });
      }

      if (request.method !== 'POST') {
        return jsonResponse(
          { error: { message: `Method ${request.method} not allowed. Use POST.` } },
          405
        );
      }

      let body: {
        date?: string;
        missingCounts?: Partial<Record<ProficiencyLevel, number>>;
        existingTopics?: string[];
        apiKey?: string;
      } = {};
      try {
        const parsed = (await request.json()) as unknown;
        if (parsed && typeof parsed === 'object') {
          body = parsed as typeof body;
        }
      } catch {
        return jsonResponse({ error: { message: 'Invalid JSON request body.' } }, 400);
      }

      const dateKey =
        typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
          ? body.date
          : getDateKey();

      const missingCounts: Record<ProficiencyLevel, number> = {
        beginner: Math.min(
          DAILY_CURRICULUM_QUOTA_PER_LEVEL,
          Math.max(0, Number(body.missingCounts?.beginner ?? DAILY_CURRICULUM_QUOTA_PER_LEVEL))
        ),
        intermediate: Math.min(
          DAILY_CURRICULUM_QUOTA_PER_LEVEL,
          Math.max(0, Number(body.missingCounts?.intermediate ?? DAILY_CURRICULUM_QUOTA_PER_LEVEL))
        ),
        advanced: Math.min(
          DAILY_CURRICULUM_QUOTA_PER_LEVEL,
          Math.max(0, Number(body.missingCounts?.advanced ?? DAILY_CURRICULUM_QUOTA_PER_LEVEL))
        ),
      };

      const existingTopics = Array.isArray(body.existingTopics)
        ? body.existingTopics.filter((t): t is string => typeof t === 'string')
        : [];

      const result = await generateDailyCurriculumDraftsOnWorker({
        env,
        dateKey,
        missingCounts,
        existingTopics,
        clientApiKey: body.apiKey,
      });

      return jsonResponse({
        ok: true,
        date: result.date,
        lessons: result.lessons,
        generatedCount: result.lessons.length,
        source: result.source,
        modelUsed: result.modelUsed,
        notice: result.notice,
      });
    }

    if (url.pathname === '/api/gemini/generateContent') {
      if (request.method !== 'POST') {
        return jsonResponse(
          { error: { message: `Method ${request.method} not allowed. Use POST.` } },
          405
        );
      }

      let rawBody: Record<string, unknown> = {};
      try {
        const parsed = (await request.json()) as unknown;
        if (parsed && typeof parsed === 'object') {
          rawBody = parsed as Record<string, unknown>;
        }
      } catch {
        return jsonResponse({ error: { message: 'Invalid JSON request body.' } }, 400);
      }

      const apiKey =
        getTrimmedKey(env.GEMINI_API_KEY) ||
        getTrimmedKey(env.VITE_GEMINI_API_KEY) ||
        getTrimmedKey(rawBody.apiKey);

      if (!apiKey) {
        return jsonResponse(
          {
            error: {
              message:
                'Gemini API key is not configured on Worker (GEMINI_API_KEY / VITE_GEMINI_API_KEY).',
            },
          },
          500
        );
      }

      const requestedModel =
        typeof rawBody.model === 'string' && rawBody.model.trim()
          ? rawBody.model.trim().replace(/^models\//, '')
          : 'gemini-2.5-flash';

      const forwardPayload =
        rawBody.payload !== undefined
          ? rawBody.payload
          : (() => {
              const copy = { ...rawBody };
              delete copy.model;
              delete copy.apiKey;
              return copy;
            })();

      const isTextFallbackModel = WORKER_TEXT_MODEL_FALLBACK_ORDER.includes(requestedModel);
      const modelsToTry = isTextFallbackModel
        ? [
            requestedModel,
            ...WORKER_TEXT_MODEL_FALLBACK_ORDER.filter((m) => m !== requestedModel),
          ]
        : [requestedModel];

      const upstreamHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKey.startsWith('ya29.')) {
        upstreamHeaders['Authorization'] = `Bearer ${apiKey}`;
      } else {
        upstreamHeaders['x-goog-api-key'] = apiKey;
      }

      let lastStatus = 502;
      let lastText = '';
      let lastContentType = 'application/json; charset=utf-8';

      try {
        for (const modelName of modelsToTry) {
          const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
          const upstream = await fetch(upstreamUrl, {
            method: 'POST',
            headers: upstreamHeaders,
            body: JSON.stringify(forwardPayload || {}),
          });

          const text = await upstream.text().catch(() => '');
          const contentType = upstream.headers.get('Content-Type') || 'application/json; charset=utf-8';

          if (upstream.ok) {
            return new Response(text, {
              status: upstream.status,
              headers: {
                'Content-Type': contentType,
                'X-Qalam-Gemini-Model': modelName,
                ...CORS_HEADERS,
              },
            });
          }

          lastStatus = upstream.status;
          lastText = text;
          lastContentType = contentType;

          if (
            isTextFallbackModel &&
            (upstream.status === 404 ||
              upstream.status === 503 ||
              /"status"\s*:\s*"UNAVAILABLE"/i.test(text))
          ) {
            continue;
          }

          return new Response(text, {
            status: upstream.status,
            headers: {
              'Content-Type': contentType,
              ...CORS_HEADERS,
            },
          });
        }

        return new Response(
          lastText ||
            JSON.stringify({
              error: { message: 'All Gemini text models were temporarily unavailable.' },
            }),
          {
            status: lastStatus,
            headers: {
              'Content-Type': lastContentType,
              ...CORS_HEADERS,
            },
          }
        );
      } catch (err) {
        return jsonResponse(
          {
            error: {
              message: err instanceof Error ? err.message : 'Upstream Gemini fetch failed.',
            },
          },
          502
        );
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
