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
}

export async function fetchGeminiGenerateContent(params: {
  model: string;
  apiKey: string;
  payload: unknown;
  signal?: AbortSignal;
  logPrefix?: string;
}): Promise<GeminiRestResult> {
  const cleanKey = params.apiKey.trim();
  const logPrefix = params.logPrefix || 'Gemini API';
  const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`;
  const bodyJson = JSON.stringify(params.payload);
  const isAuthToken = cleanKey.startsWith('AQ.');

  const primaryUrl = baseUrl;
  const primaryHeaders: Record<string, string> = isAuthToken
    ? {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanKey}`,
      }
    : {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey,
      };

  const primaryRes = await fetch(primaryUrl, {
    method: 'POST',
    signal: params.signal,
    headers: primaryHeaders,
    body: bodyJson,
  });

  if (primaryRes.ok) {
    return { response: primaryRes, errorBody: '' };
  }

  const primaryErrorBody = await primaryRes.text().catch(() => '');
  console.error(
    `[${logPrefix}] Request to ${params.model} failed (${isAuthToken ? 'Bearer' : 'x-goog-api-key'}, HTTP ${primaryRes.status} ${primaryRes.statusText}):`,
    primaryErrorBody
  );

  // Only attempt auth-header fallback on auth/bad-request failures (400/401/403), never on 404 or 429
  const shouldRetryAuthFallback =
    primaryRes.status === 400 || primaryRes.status === 401 || primaryRes.status === 403;

  if (!shouldRetryAuthFallback) {
    return { response: primaryRes, errorBody: primaryErrorBody };
  }

  const fallbackUrl = isAuthToken
    ? baseUrl
    : `${baseUrl}?key=${encodeURIComponent(cleanKey)}`;
  const fallbackHeaders: Record<string, string> = isAuthToken
    ? {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanKey,
      }
    : {
        'Content-Type': 'application/json',
      };

  const fallbackRes = await fetch(fallbackUrl, {
    method: 'POST',
    signal: params.signal,
    headers: fallbackHeaders,
    body: bodyJson,
  });

  if (fallbackRes.ok) {
    return { response: fallbackRes, errorBody: '' };
  }

  const fallbackErrorBody = await fallbackRes.text().catch(() => '');
  console.error(
    `[${logPrefix}] Fallback request to ${params.model} failed (${isAuthToken ? 'x-goog-api-key' : 'query-param'}, HTTP ${fallbackRes.status} ${fallbackRes.statusText}):`,
    fallbackErrorBody
  );

  return { response: fallbackRes, errorBody: fallbackErrorBody };
}
