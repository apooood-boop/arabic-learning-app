interface WorkerAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv {
  GEMINI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
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

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
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

      const rawModel =
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

      const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(rawModel)}:generateContent`;
      const upstreamHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKey.startsWith('ya29.')) {
        upstreamHeaders['Authorization'] = `Bearer ${apiKey}`;
      } else {
        upstreamHeaders['x-goog-api-key'] = apiKey;
      }

      try {
        const upstream = await fetch(upstreamUrl, {
          method: 'POST',
          headers: upstreamHeaders,
          body: JSON.stringify(forwardPayload || {}),
        });

        const text = await upstream.text().catch(() => '');
        const contentType = upstream.headers.get('Content-Type') || 'application/json; charset=utf-8';

        return new Response(text, {
          status: upstream.status,
          headers: {
            'Content-Type': contentType,
            ...CORS_HEADERS,
          },
        });
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
