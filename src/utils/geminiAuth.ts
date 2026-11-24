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

const TEXT_MODEL_FALLBACK_ORDER = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
] as const;

let proxyRouteUnavailable = false;
const unavailableGeminiModels = new Set<string>();

export function resetGeminiRoutingCaches(): void {
  proxyRouteUnavailable = false;
  unavailableGeminiModels.clear();
}

export function isGeminiModelUnavailable(model: string): boolean {
  return unavailableGeminiModels.has((model || '').replace(/^models\//, '').trim());
}

export function markGeminiModelUnavailable(model: string): void {
  const clean = (model || '').replace(/^models\//, '').trim();
  if (clean) {
    unavailableGeminiModels.add(clean);
  }
}

function isTextFallbackModel(model: string): boolean {
  return (TEXT_MODEL_FALLBACK_ORDER as readonly string[]).includes(model);
}

function pickAvailableTextModel(preferredModel: string, exclude: Set<string> = new Set()): string | null {
  const startIdx = TEXT_MODEL_FALLBACK_ORDER.indexOf(
    preferredModel as (typeof TEXT_MODEL_FALLBACK_ORDER)[number]
  );
  const searchList =
    startIdx >= 0
      ? TEXT_MODEL_FALLBACK_ORDER.slice(startIdx)
      : TEXT_MODEL_FALLBACK_ORDER;

  for (const candidate of searchList) {
    if (!unavailableGeminiModels.has(candidate) && !exclude.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isGeminiModelNotFound404(status: number, bodyText: string): boolean {
  if (status !== 404) return false;
  return (
    /"status"\s*:\s*"NOT_FOUND"/i.test(bodyText) ||
    /models\/[^\s"]+.*(?:not found|no longer available|not supported)/i.test(bodyText)
  );
}

export function setAdminGeminiApiKeyOverride(key: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!key || !key.trim()) {
      window.localStorage.removeItem(ADMIN_KEY_OVERRIDE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ADMIN_KEY_OVERRIDE_STORAGE_KEY, key.trim());
    }
    resetGeminiRoutingCaches();
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
  modelUsed?: string;
}

export async function fetchGeminiGenerateContent(params: {
  model: string;
  apiKey?: string;
  payload: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  logPrefix?: string;
  _attemptedModels?: string[];
}): Promise<GeminiRestResult> {
  const logPrefix = params.logPrefix || 'Gemini API';
  const requestedModel = (params.model || 'gemini-2.5-flash').replace(/^models\//, '');
  const attempted = new Set(params._attemptedModels || []);

  let effectiveModel = requestedModel;
  if (isTextFallbackModel(requestedModel) && unavailableGeminiModels.has(requestedModel)) {
    const nextHealthy = pickAvailableTextModel(requestedModel, attempted);
    if (nextHealthy) {
      effectiveModel = nextHealthy;
    }
  }
  attempted.add(effectiveModel);

  const proxyUrl = '/api/gemini/generateContent';
  const targetGoogleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent`;
  const cleanKey = (params.apiKey || getClientGeminiApiKey() || '').trim();
  const bodyJson = JSON.stringify({
    model: effectiveModel,
    payload: params.payload,
    apiKey: cleanKey || undefined,
  });

  // Own timeout controller if caller did not supply a signal
  let ownController: AbortController | null = null;
  let ownTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let effectiveSignal = params.signal;
  if (!effectiveSignal) {
    ownController = new AbortController();
    const timeoutMs = params.timeoutMs ?? 30000;
    ownTimer = globalThis.setTimeout(
      () => ownController?.abort(new DOMException('Request timed out', 'TimeoutError')),
      timeoutMs
    );
    effectiveSignal = ownController.signal;
  }

  const callDirectGoogle = async (reasonStatus?: number): Promise<GeminiRestResult> => {
    if (!cleanKey) {
      const status = reasonStatus === 404 ? 404 : 405;
      const missingRouteBody = JSON.stringify({
        error: {
          message: `Server route POST /api/gemini/generateContent returned HTTP ${status} and no client API key is configured.`,
        },
      });
      return {
        response: new Response(missingRouteBody, {
          status,
          statusText: status === 404 ? 'Not Found' : 'Method Not Allowed',
          headers: { 'Content-Type': 'application/json' },
        }),
        errorBody: missingRouteBody,
        errorMessage: `Server route POST /api/gemini/generateContent returned HTTP ${status} and no client API key is configured.`,
        url: targetGoogleUrl,
        modelUsed: effectiveModel,
      };
    }

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
        signal: effectiveSignal,
        headers: directHeaders,
        body: JSON.stringify(params.payload || {}),
      });
      if (directRes.ok) {
        return {
          response: directRes,
          errorBody: '',
          url: targetGoogleUrl,
          modelUsed: effectiveModel,
        };
      }

      const directErr = await directRes.text().catch(() => '');
      if (isGeminiModelNotFound404(directRes.status, directErr)) {
        markGeminiModelUnavailable(effectiveModel);
        if (isTextFallbackModel(effectiveModel)) {
          const nextModel = pickAvailableTextModel(effectiveModel, attempted);
          if (nextModel) {
            return fetchGeminiGenerateContent({
              ...params,
              model: nextModel,
              _attemptedModels: Array.from(attempted),
            });
          }
        }
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
        modelUsed: effectiveModel,
      };
    } catch (directNetworkErr) {
      if (
        directNetworkErr instanceof DOMException &&
        (directNetworkErr.name === 'TimeoutError' || directNetworkErr.name === 'AbortError')
      ) {
        throw directNetworkErr;
      }
      const fallbackMsg =
        directNetworkErr instanceof Error
          ? directNetworkErr.message
          : String(directNetworkErr);
      const deployHint = `Direct Gemini request failed: ${fallbackMsg}`;
      return {
        response: new Response(JSON.stringify({ error: { message: deployHint } }), {
          status: 503,
          statusText: 'Service Unavailable',
        }),
        errorBody: deployHint,
        errorMessage: deployHint,
        url: targetGoogleUrl,
        modelUsed: effectiveModel,
      };
    }
  };

  try {
    if (proxyRouteUnavailable) {
      return await callDirectGoogle(405);
    }

    const res = await fetch(proxyUrl, {
      method: 'POST',
      signal: effectiveSignal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyJson,
    });

    const headerModelUsed = res.headers.get('X-Qalam-Gemini-Model') || effectiveModel;

    if (res.ok) {
      return {
        response: res,
        errorBody: '',
        url: targetGoogleUrl,
        modelUsed: headerModelUsed,
      };
    }

    if (res.status === 405) {
      proxyRouteUnavailable = true;
      console.warn(
        `[${logPrefix}] Worker route POST /api/gemini/generateContent returned HTTP 405; using direct fallback when client key is present.`
      );
      return await callDirectGoogle(405);
    }

    const errorBody = await res.text().catch(() => '');

    if (res.status === 404 && isGeminiModelNotFound404(404, errorBody)) {
      markGeminiModelUnavailable(effectiveModel);
      if (isTextFallbackModel(effectiveModel)) {
        const nextModel = pickAvailableTextModel(effectiveModel, attempted);
        if (nextModel) {
          return await fetchGeminiGenerateContent({
            ...params,
            model: nextModel,
            _attemptedModels: Array.from(attempted),
          });
        }
      }
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

    return {
      response: res,
      errorBody,
      errorMessage,
      url: targetGoogleUrl,
      modelUsed: headerModelUsed,
    };
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === 'TimeoutError' || err.name === 'AbortError')
    ) {
      throw err;
    }
    const errorBody = err instanceof Error ? err.message : String(err);
    console.error(`[${logPrefix}] Network error contacting server Gemini proxy:`, errorBody);
    return {
      response: new Response(JSON.stringify({ error: { message: errorBody } }), { status: 500 }),
      errorBody,
      errorMessage: errorBody,
      url: targetGoogleUrl,
      modelUsed: effectiveModel,
    };
  } finally {
    if (ownTimer !== null) {
      clearTimeout(ownTimer);
    }
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
