const ADMIN_KEY_OVERRIDE_STORAGE_KEY = 'qalam_admin_gemini_api_key_override';

export function getAdminGeminiApiKeyOverride(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ADMIN_KEY_OVERRIDE_STORAGE_KEY);
    const cleaned = (raw || '').trim();
    return cleaned && cleaned !== 'MY_GEMINI_API_KEY' ? cleaned : null;
  } catch {
    return null;
  }
}

export function setAdminGeminiApiKeyOverride(key: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!key || !key.trim()) {
      window.localStorage.removeItem(ADMIN_KEY_OVERRIDE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ADMIN_KEY_OVERRIDE_STORAGE_KEY, key.trim());
    }
    window.dispatchEvent(new CustomEvent('qalam:gemini-key-changed'));
  } catch {
    // Ignore storage errors
  }
}

export function getClientGeminiApiKey(): string | null {
  const override = getAdminGeminiApiKeyOverride();
  if (override) return override;

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

export interface GeminiApiKeyInfo {
  source: 'Admin Override' | 'Environment Variable' | 'None';
  key: string | null;
  masked: string;
  length: number;
  hasOverride: boolean;
}

export function getGeminiApiKeyInfo(): GeminiApiKeyInfo {
  const override = getAdminGeminiApiKeyOverride();
  const envRaw = (() => {
    try {
      const metaEnv =
        typeof import.meta !== 'undefined'
          ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
          : undefined;
      return (metaEnv?.VITE_GEMINI_API_KEY?.trim() || metaEnv?.VITE_API_KEY?.trim() || '').trim();
    } catch {
      return '';
    }
  })();

  const activeKey = override || (envRaw && envRaw !== 'MY_GEMINI_API_KEY' ? envRaw : null);
  const source = override ? 'Admin Override' : (envRaw && envRaw !== 'MY_GEMINI_API_KEY' ? 'Environment Variable' : 'None');

  let masked = 'None configured';
  if (activeKey) {
    if (activeKey.length <= 8) {
      masked = '••••••••';
    } else {
      masked = `${activeKey.slice(0, 6)}••••${activeKey.slice(-4)}`;
    }
  }

  return {
    source: source as GeminiApiKeyInfo['source'],
    key: activeKey,
    masked,
    length: activeKey ? activeKey.length : 0,
    hasOverride: Boolean(override),
  };
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
  _retriedFallbackModel?: boolean;
}): Promise<GeminiRestResult> {
  const logPrefix = params.logPrefix || 'Gemini API';
  const cleanModel = (params.model || 'gemini-2.5-flash').replace(/^models\//, '');
  const proxyUrl = '/api/gemini/generateContent';
  const targetGoogleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`;
  const cleanKey = (params.apiKey || getClientGeminiApiKey() || '').trim();
  const bodyJson = JSON.stringify({
    model: cleanModel,
    payload: params.payload,
    apiKey: cleanKey || undefined,
  });

  try {
    const res = await fetch(proxyUrl, {
      method: 'POST',
      signal: params.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyJson,
    });

    if (res.ok) {
      return { response: res, errorBody: '', url: targetGoogleUrl };
    }

    // If Cloudflare Worker static host returned 405 (Worker route not yet deployed),
    // cleanly fall back to direct Google endpoint when a client API key is available.
    if (res.status === 405) {
      console.warn(
        `[${logPrefix}] Worker route POST /api/gemini/generateContent returned HTTP 405 (route needs deployment).`
      );
      if (cleanKey) {
        try {
          const directHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (cleanKey.startsWith('ya29.')) {
            directHeaders['Authorization'] = `Bearer ${cleanKey}`;
          } else {
            directHeaders['x-goog-api-key'] = cleanKey;
          }
          const directRes = await fetch(targetGoogleUrl, {
            method: 'POST',
            signal: params.signal,
            headers: directHeaders,
            body: JSON.stringify(params.payload || {}),
          });
          if (directRes.ok) {
            return { response: directRes, errorBody: '', url: targetGoogleUrl };
          }
          const directErr = await directRes.text().catch(() => '');
          if (
            directRes.status === 404 &&
            cleanModel === 'gemini-2.5-flash' &&
            !params._retriedFallbackModel
          ) {
            return fetchGeminiGenerateContent({
              ...params,
              model: 'gemini-3.8-flash',
              _retriedFallbackModel: true,
            });
          }
          let directMsg = '';
          try {
            const parsedDirect = JSON.parse(directErr) as { error?: { message?: string } };
            directMsg = parsedDirect?.error?.message || '';
          } catch {
            // ignore
          }
          return {
            response: directRes,
            errorBody: directErr,
            errorMessage: directMsg || directErr,
            url: targetGoogleUrl,
          };
        } catch (directNetworkErr) {
          const fallbackMsg =
            directNetworkErr instanceof Error
              ? directNetworkErr.message
              : String(directNetworkErr);
          const deployHint = `Worker /api/gemini/generateContent returned 405 and direct fallback failed: ${fallbackMsg}`;
          return {
            response: new Response(JSON.stringify({ error: { message: deployHint } }), {
              status: 405,
              statusText: 'Method Not Allowed',
            }),
            errorBody: deployHint,
            errorMessage: deployHint,
            url: targetGoogleUrl,
          };
        }
      }

      const missingRouteBody = JSON.stringify({
        error: {
          message:
            'Cloudflare Worker route POST /api/gemini/generateContent returned HTTP 405 and needs deployment.',
        },
      });
      return {
        response: new Response(missingRouteBody, {
          status: 405,
          statusText: 'Method Not Allowed',
          headers: { 'Content-Type': 'application/json' },
        }),
        errorBody: missingRouteBody,
        errorMessage:
          'Cloudflare Worker route POST /api/gemini/generateContent returned HTTP 405 and needs deployment.',
        url: targetGoogleUrl,
      };
    }

    const errorBody = await res.text().catch(() => '');
    if (
      res.status === 404 &&
      cleanModel === 'gemini-2.5-flash' &&
      !params._retriedFallbackModel &&
      /no longer available|not found|not supported/i.test(errorBody)
    ) {
      return fetchGeminiGenerateContent({
        ...params,
        model: 'gemini-3.8-flash',
        _retriedFallbackModel: true,
      });
    }

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
      `[${logPrefix}] Server Gemini proxy failed (HTTP ${res.status}): ${detailMsg}`
    );

    return { response: res, errorBody, errorMessage, url: targetGoogleUrl };
  } catch (err) {
    const errorBody = err instanceof Error ? err.message : String(err);
    console.error(`[${logPrefix}] Network error contacting server Gemini proxy:`, errorBody);
    return {
      response: new Response(JSON.stringify({ error: { message: errorBody } }), { status: 500 }),
      errorBody,
      errorMessage: errorBody,
      url: targetGoogleUrl,
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
