import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Configuration keys read from client environment variables
const SUPABASE_URL = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  ''
).trim();

const SUPABASE_ANON_KEY = (
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  ''
).trim();

export const TABLE_PROFILES = 'profiles';
export const TABLE_VOCAB_CARDS = 'vocabulary_cards';
export const TABLE_STUDY_NOTES = 'study_notes';
export const TABLE_USER_PROGRESS = 'user_progress';
export const TABLE_LESSONS = 'lessons';

export interface SupabaseConfigStatus {
  isConfigured: boolean;
  url: string | null;
  maskedKey: string;
  error?: string;
}

let supabaseInstance: SupabaseClient | null = null;
let clientInitialized = false;

function maskKey(key: string): string {
  if (!key) return 'Not Configured';
  if (key.length <= 10) return '••••••••';
  return `${key.slice(0, 6)}••••${key.slice(-4)} (len ${key.length})`;
}

/**
 * Returns whether valid Supabase environment variables are present.
 */
export function isSupabaseConfigured(): boolean {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const url = new URL(SUPABASE_URL);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Returns configuration diagnostics for UI and health inspection.
 */
export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  if (!SUPABASE_URL && !SUPABASE_ANON_KEY) {
    return {
      isConfigured: false,
      url: null,
      maskedKey: 'Not Configured',
    };
  }

  if (!SUPABASE_URL) {
    return {
      isConfigured: false,
      url: null,
      maskedKey: maskKey(SUPABASE_ANON_KEY),
      error: 'VITE_SUPABASE_URL is missing',
    };
  }

  if (!SUPABASE_ANON_KEY) {
    return {
      isConfigured: false,
      url: SUPABASE_URL,
      maskedKey: 'Not Configured',
      error: 'VITE_SUPABASE_ANON_KEY is missing',
    };
  }

  try {
    new URL(SUPABASE_URL);
    return {
      isConfigured: true,
      url: SUPABASE_URL,
      maskedKey: maskKey(SUPABASE_ANON_KEY),
    };
  } catch {
    return {
      isConfigured: false,
      url: SUPABASE_URL,
      maskedKey: maskKey(SUPABASE_ANON_KEY),
      error: 'VITE_SUPABASE_URL is not a valid URL',
    };
  }
}

function readActiveUserIdHeader(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('qalam_active_user_v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; isGuest?: boolean };
    if (parsed && !parsed.isGuest && typeof parsed.id === 'string' && parsed.id.trim()) {
      return parsed.id.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detects whether the current URL contains Supabase Auth callback parameters
 * (email verification, password recovery, PKCE code, or auth error params).
 */
export function hasSupabaseAuthRedirectInUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  const combined = `${hash}&${search}`;
  return /(?:access_token|refresh_token|token_hash|type=recovery|type=signup|type=email|type=magiclink|error_description)=|[?&]code=/.test(
    combined
  );
}

let lastRecoverySessionEmail: string | null = null;
let hasPendingRecoveryEvent = false;

export function consumePendingRecoveryEvent(): { active: boolean; email: string | null } {
  const active = hasPendingRecoveryEvent;
  const email = lastRecoverySessionEmail;
  hasPendingRecoveryEvent = false;
  lastRecoverySessionEmail = null;
  return { active, email };
}

/**
 * Safely retrieves or initializes the Supabase client.
 * Returns null if credentials are not configured or invalid, never throwing.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (clientInitialized) {
    return supabaseInstance;
  }

  clientInitialized = true;

  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const urlHadRecovery =
      typeof window !== 'undefined' &&
      /type=recovery/.test(`${window.location.hash || ''}&${window.location.search || ''}`);
    if (urlHadRecovery) {
      hasPendingRecoveryEvent = true;
    }

    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: (input, init) => {
          const activeId = readActiveUserIdHeader();
          if (!activeId) {
            return fetch(input, init);
          }
          const headers = new Headers(init?.headers);
          if (!headers.has('x-user-id')) {
            headers.set('x-user-id', activeId);
          }
          return fetch(input, { ...init, headers });
        },
      },
    });

    supabaseInstance.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        hasPendingRecoveryEvent = true;
        lastRecoverySessionEmail = session?.user?.email ?? null;
      }
    });

    return supabaseInstance;
  } catch (err) {
    console.warn('[Qalam Supabase] Failed to initialize Supabase client:', err);
    supabaseInstance = null;
    return null;
  }
}

/**
 * Quick live connectivity probe to Supabase.
 */
export async function pingSupabaseConnection(): Promise<{
  ok: boolean;
  status: string;
  latencyMs: number;
  details?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    const cfg = getSupabaseConfigStatus();
    return {
      ok: false,
      status: 'Not Configured (Local Fallback Active)',
      latencyMs: 0,
      details: cfg.error || 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set.',
    };
  }

  const started = performance.now();
  try {
    // Attempt a lightweight read from profiles or server health endpoint
    const { error, status } = await client
      .from(TABLE_PROFILES)
      .select('count', { count: 'exact', head: true });

    const latencyMs = Math.round(performance.now() - started);

    if (error) {
      // 404 or table not found means connection works but schema not executed yet
      if (error.code === 'PGRST116' || error.message?.includes('relation') || error.code === '42P01') {
        return {
          ok: true,
          status: 'Connected (Schema pending in Supabase SQL Editor)',
          latencyMs,
          details: 'Connected to Supabase project, but tables need to be created with the provided SQL schema.',
        };
      }
      return {
        ok: false,
        status: `Error HTTP ${status || 'Err'} (${error.code || 'UNKNOWN'})`,
        latencyMs,
        details: error.message,
      };
    }

    return {
      ok: true,
      status: `Connected & Ready (${latencyMs}ms)`,
      latencyMs,
      details: 'Profiles table responding cleanly.',
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      ok: false,
      status: 'Network / Connection Failed',
      latencyMs,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}
