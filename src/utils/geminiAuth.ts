export function getClientGeminiApiKey(): string | null {
  try {
    const metaEnv =
      typeof import.meta !== 'undefined'
        ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
        : undefined;
    const raw =
      metaEnv?.VITE_GEMINI_API_KEY?.trim() ||
      metaEnv?.VITE_API_KEY?.trim() ||
      '';
    const cleaned = raw.trim();
    if (!cleaned || cleaned === 'MY_GEMINI_API_KEY') {
      return null;
    }
    return cleaned;
  } catch {
    return null;
  }
}

export interface GeminiRestResult {
  response: Response;
  errorBody: string;
  errorMessage?: string;
  url: string;
}

export async function fetchGeminiGenerateContent(params: {
  model: string;
  apiKey?: string;
  payload: unknown;
  signal?: AbortSignal;
  logPrefix?: string;
}): Promise<GeminiRestResult> {
  const cleanKey = (params.apiKey || getClientGeminiApiKey() || '').trim();
  const logPrefix = params.logPrefix || 'Gemini API';
  const cleanModel = (params.model || 'gemini-2.5-flash').replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;
  const bodyJson = JSON.stringify(params.payload);
  const isAuthToken = cleanKey.startsWith('AQ.');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isAuthToken) {
    headers['Authorization'] = `Bearer ${cleanKey}`;
  } else if (cleanKey) {
    headers['x-goog-api-key'] = cleanKey;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: params.signal,
      headers,
      body: bodyJson,
    });

    if (res.ok) {
      return { response: res, errorBody: '', url };
    }

    const errorBody = await res.text().catch(() => '');
    let errorMessage = '';
    try {
      const parsed = JSON.parse(errorBody) as { error?: { message?: string } };
      if (parsed?.error?.message) {
        errorMessage = parsed.error.message;
      }
    } catch {
      // not JSON
    }

    const detailMsg = errorMessage || errorBody || res.statusText;
    console.error(
      `[${logPrefix}] Request to ${url} failed (HTTP ${res.status}): ${detailMsg}`
    );

    return { response: res, errorBody, errorMessage, url };
  } catch (err) {
    const errorBody = err instanceof Error ? err.message : String(err);
    console.error(`[${logPrefix}] Network error contacting ${url}:`, errorBody);
    return {
      response: new Response(JSON.stringify({ error: { message: errorBody } }), { status: 500 }),
      errorBody,
      errorMessage: errorBody,
      url,
    };
  }
}

export interface GeminiQuotaInfo {
  scope: 'daily' | 'minute' | 'general';
  cooldownMs: number;
  userMessage: string;
}

export function parseGeminiQuotaInfo(
  errorBody: string,
  feature: 'audio' | 'text' = 'text'
): GeminiQuotaInfo {
  const secMatch = errorBody.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  const retrySeconds = secMatch?.[1] ? Number(secMatch[1]) : 0;

  const isDaily =
    /PerDay|daily|free_tier_requests/i.test(errorBody) ||
    (Number.isFinite(retrySeconds) && retrySeconds >= 1800);
  const isMinute =
    !isDaily &&
    (/PerMinute|per_minute|minute|RPM/i.test(errorBody) ||
      (Number.isFinite(retrySeconds) && retrySeconds > 0 && retrySeconds < 1800));

  if (feature === 'audio') {
    const cooldownMs =
      Number.isFinite(retrySeconds) && retrySeconds > 0
        ? Math.min(10 * 60 * 1000, Math.max(35 * 1000, retrySeconds * 1000))
        : isDaily
          ? 60 * 1000
          : 45 * 1000;

    const waitHint =
      Number.isFinite(retrySeconds) && retrySeconds >= 25 && retrySeconds <= 90
        ? `retry in ~${retrySeconds} seconds`
        : 'retry in 30–60 seconds';

    if (isDaily) {
      return {
        scope: 'daily',
        cooldownMs,
        userMessage: `Free audio quota is temporarily cooling down — please ${waitHint} (or later if the daily free limit was reached).`,
      };
    }
    return {
      scope: isMinute ? 'minute' : 'general',
      cooldownMs,
      userMessage: `Free audio quota is temporarily cooling down — please ${waitHint}.`,
    };
  }

  const cooldownMs =
    Number.isFinite(retrySeconds) && retrySeconds > 0
      ? Math.min(12 * 60 * 60 * 1000, Math.max(45 * 1000, retrySeconds * 1000))
      : isDaily
        ? 4 * 60 * 60 * 1000
        : isMinute
          ? 2 * 60 * 1000
          : 15 * 60 * 1000;

  const fallbackLabel = 'Using cached entries & built-in Arabic fallback cleanly.';

  if (isDaily) {
    return {
      scope: 'daily',
      cooldownMs,
      userMessage: `Gemini free daily quota was reached (HTTP 429). ${fallbackLabel}`,
    };
  }
  if (isMinute) {
    return {
      scope: 'minute',
      cooldownMs,
      userMessage: `Gemini free per-minute quota was reached (HTTP 429). ${fallbackLabel}`,
    };
  }
  return {
    scope: 'general',
    cooldownMs,
    userMessage: `Gemini free daily/minute quota was reached (HTTP 429). ${fallbackLabel}`,
  };
}

let lastQuotaNoticeAt = 0;

export function notifyGeminiQuotaNotice(message: string): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastQuotaNoticeAt < 4000) return;
  lastQuotaNoticeAt = now;
  window.dispatchEvent(
    new CustomEvent('qalam:quota-notice', { detail: { message } })
  );
}

