import { AuthUser, VocabCard, WordAnalysis } from '../types/arabic';
import {
  applySmartPartialTashkeel,
  clearAllArabicAudioCaches,
  getAudioDiagnosticsSnapshot,
  invalidateCachedArabicAudio,
  normalizeStandaloneArabicKey,
  normalizeStandaloneVocabWord,
  speakArabic,
  stripFinalIrabForSpeech,
  stripTashkeel,
  unlockArabicAudioContext,
  type AudioDiagnosticsSnapshot,
} from './arabic';
import { isAdminUser } from './auth';
import { fetchGeminiGenerateContent, getClientGeminiApiKey } from './geminiAuth';
import {
  analyzeArabicWordClient,
  clearGeminiResponseCaches,
  getGeminiTextDiagnosticsSnapshot,
  isFakePlaceholderTranslation,
  type GeminiTextDiagnosticsSnapshot,
} from './geminiClient';

import {
  getSupabaseConfigStatus,
  pingSupabaseConnection,
  type SupabaseConfigStatus,
} from './supabaseClient';

function assertAdminActor(actorUser: AuthUser | null): void {
  if (!isAdminUser(actorUser)) {
    throw new Error('صلاحيات الأدمن مطلوبة لتشغيل هذه الأداة · Admin privileges are required.');
  }
}

export function maskApiKey(rawKey: string | null): string {
  if (!rawKey) return 'Not Configured';
  const trimmed = rawKey.trim();
  if (trimmed.length <= 10) return '••••••';
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)} (len ${trimmed.length})`;
}

export type DiagnosticCheckKey = 'gemini' | 'voices' | 'audioPath' | 'cardsAndCache' | 'supabase';

export interface SupabaseDiagnosticsSnapshot {
  isConfigured: boolean;
  url: string | null;
  maskedKey: string;
  statusSummary: string;
  error?: string;
}

export interface AdminHealthSnapshot {
  checkedAt: number;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  apiKeyFormat: 'AQ. Auth Token (Bearer)' | 'Standard Key (x-goog-api-key)' | 'Missing';
  geminiStatusSummary: string;
  geminiText: GeminiTextDiagnosticsSnapshot;
  audio: AudioDiagnosticsSnapshot;
  audioContextState: string;
  audioPathReady: boolean;
  supabase: SupabaseDiagnosticsSnapshot;
  wordCacheTotal: number;
  wordCachePlaceholders: number;
  vocabCardsTotal: number;
  vocabCardsWithPlaceholders: number;
  vocabCardsNeedingNormalization: number;
  vocabCardsCustomEdited: number;
  checkErrors: Partial<Record<DiagnosticCheckKey, string>>;
}

function createEmptyGeminiTextSnapshot(): GeminiTextDiagnosticsSnapshot {
  return {
    cooldownActive: false,
    cooldownRemainingSec: 0,
    quotaReason: null,
    memoryCacheEntries: 0,
    persistentCacheEntries: 0,
    placeholderEntriesInResponseCache: 0,
  };
}

function createEmptyAudioSnapshot(): AudioDiagnosticsSnapshot {
  return {
    speechSynthesisSupported: false,
    totalVoices: 0,
    arabicVoices: [],
    memoryCachedClips: 0,
    persistentCachedClips: 0,
    geminiAudioCooldownActive: false,
    geminiAudioCooldownRemainingSec: 0,
    geminiAudioRejectedReason: null,
    staticApiTtsUnavailable: false,
  };
}

function runGeminiAndKeyCheck(): {
  apiKey: string | null;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  apiKeyFormat: AdminHealthSnapshot['apiKeyFormat'];
  geminiText: GeminiTextDiagnosticsSnapshot;
  geminiStatusSummary: string;
  error?: string;
} {
  try {
    const apiKey = getClientGeminiApiKey();
    const apiKeyFormat: AdminHealthSnapshot['apiKeyFormat'] = !apiKey
      ? 'Missing'
      : apiKey.startsWith('AQ.')
        ? 'AQ. Auth Token (Bearer)'
        : 'Standard Key (x-goog-api-key)';
    const geminiText = getGeminiTextDiagnosticsSnapshot();
    const geminiStatusSummary = !apiKey
      ? 'VITE_GEMINI_API_KEY not configured'
      : geminiText.cooldownActive
        ? `Cooldown active (${geminiText.cooldownRemainingSec}s remaining)`
        : `Key ready (${apiKeyFormat})`;

    return {
      apiKey,
      apiKeyConfigured: Boolean(apiKey),
      apiKeyMasked: maskApiKey(apiKey),
      apiKeyFormat,
      geminiText,
      geminiStatusSummary,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to inspect Gemini API key/status.';
    return {
      apiKey: null,
      apiKeyConfigured: false,
      apiKeyMasked: 'Check Error',
      apiKeyFormat: 'Missing',
      geminiText: createEmptyGeminiTextSnapshot(),
      geminiStatusSummary: `Check failed: ${msg}`,
      error: msg,
    };
  }
}

async function probeGeminiEndpointMetadata(apiKey: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2500);
  try {
    const cleanKey = apiKey.trim();
    const isAuthToken = cleanKey.startsWith('AQ.');
    const headers: Record<string, string> = isAuthToken
      ? { Authorization: `Bearer ${cleanKey}` }
      : { 'x-goog-api-key': cleanKey };

    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite',
      {
        method: 'GET',
        signal: controller.signal,
        headers,
      }
    );
    if (res.ok) {
      return `Endpoint reachable (HTTP ${res.status})`;
    }
    if (res.status === 429) {
      return 'Endpoint rate-limited (HTTP 429)';
    }
    if (res.status === 401 || res.status === 403) {
      return `Auth rejected (HTTP ${res.status})`;
    }
    return `Endpoint responded HTTP ${res.status}`;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return 'Connectivity probe timed out (2.5s)';
    }
    return err instanceof Error ? `Network check: ${err.message}` : 'Network check failed';
  } finally {
    window.clearTimeout(timer);
  }
}

function runSpeechVoicesCheckSync(): {
  speechSynthesisSupported: boolean;
  totalVoices: number;
  arabicVoices: AudioDiagnosticsSnapshot['arabicVoices'];
  error?: string;
} {
  try {
    const speechSynthesisSupported =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance !== 'undefined';

    if (!speechSynthesisSupported) {
      return {
        speechSynthesisSupported: false,
        totalVoices: 0,
        arabicVoices: [],
      };
    }

    const voices = window.speechSynthesis.getVoices() || [];
    const arabicVoices = voices
      .filter((v) => typeof v?.lang === 'string' && v.lang.toLowerCase().startsWith('ar'))
      .map((v) => ({
        name: v.name,
        lang: v.lang,
        localService: Boolean(v.localService),
      }));

    return {
      speechSynthesisSupported: true,
      totalVoices: voices.length,
      arabicVoices,
    };
  } catch (err) {
    return {
      speechSynthesisSupported: false,
      totalVoices: 0,
      arabicVoices: [],
      error: err instanceof Error ? err.message : 'Failed to read browser speechSynthesis voices.',
    };
  }
}

async function runSpeechVoicesCheckAsync(): Promise<{
  speechSynthesisSupported: boolean;
  totalVoices: number;
  arabicVoices: AudioDiagnosticsSnapshot['arabicVoices'];
  error?: string;
}> {
  try {
    const initial = runSpeechVoicesCheckSync();
    if (initial.error || !initial.speechSynthesisSupported || initial.totalVoices > 0) {
      return initial;
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return initial;
    }

    // Wait briefly (max 250ms) in case voices are still hydrating asynchronously
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          window.speechSynthesis.removeEventListener('voiceschanged', finish);
        } catch {
          // Ignore listener removal errors
        }
        resolve();
      };
      const timer = window.setTimeout(finish, 250);
      try {
        window.speechSynthesis.addEventListener(
          'voiceschanged',
          () => {
            window.clearTimeout(timer);
            finish();
          },
          { once: true }
        );
      } catch {
        window.clearTimeout(timer);
        finish();
      }
    });

    return runSpeechVoicesCheckSync();
  } catch (err) {
    return {
      speechSynthesisSupported: false,
      totalVoices: 0,
      arabicVoices: [],
      error: err instanceof Error ? err.message : 'SpeechSynthesis voice check failed.',
    };
  }
}

function runAudioPathAndCacheCheck(
  voicesResult: {
    speechSynthesisSupported: boolean;
    totalVoices: number;
    arabicVoices: AudioDiagnosticsSnapshot['arabicVoices'];
  },
  apiKeyConfigured: boolean
): {
  audio: AudioDiagnosticsSnapshot;
  audioContextState: string;
  audioPathReady: boolean;
  error?: string;
} {
  try {
    const baseAudio = getAudioDiagnosticsSnapshot();
    const audio: AudioDiagnosticsSnapshot = {
      ...baseAudio,
      speechSynthesisSupported:
        voicesResult.speechSynthesisSupported || baseAudio.speechSynthesisSupported,
      totalVoices: Math.max(voicesResult.totalVoices, baseAudio.totalVoices),
      arabicVoices:
        voicesResult.arabicVoices.length > 0
          ? voicesResult.arabicVoices
          : baseAudio.arabicVoices,
    };

    let audioContextState = 'unavailable';
    if (typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        try {
          const probeCtx = new AudioCtx();
          audioContextState = probeCtx.state || 'ready';
          void probeCtx.close().catch(() => {});
        } catch {
          audioContextState = 'supported (needs user gesture)';
        }
      }
    }

    const hasNativeVoice = audio.arabicVoices.length > 0;
    const hasGeminiFallback =
      apiKeyConfigured && !audio.geminiAudioCooldownActive && !audio.geminiAudioRejectedReason;
    const hasCachedAudio = audio.memoryCachedClips > 0 || audio.persistentCachedClips > 0;
    const audioPathReady =
      hasNativeVoice || hasGeminiFallback || hasCachedAudio || audioContextState !== 'unavailable';

    return {
      audio,
      audioContextState,
      audioPathReady,
    };
  } catch (err) {
    return {
      audio: createEmptyAudioSnapshot(),
      audioContextState: 'error',
      audioPathReady: false,
      error: err instanceof Error ? err.message : 'Audio path diagnostics failed.',
    };
  }
}

function runCardsAndCacheScan(
  activeVocabCards: VocabCard[],
  analysisCache: Record<string, WordAnalysis>
): {
  wordCacheTotal: number;
  wordCachePlaceholders: number;
  vocabCardsTotal: number;
  vocabCardsWithPlaceholders: number;
  vocabCardsNeedingNormalization: number;
  vocabCardsCustomEdited: number;
  error?: string;
} {
  try {
    const wordCacheEntries = Object.values(analysisCache || {});
    const wordCachePlaceholders = wordCacheEntries.filter((entry) =>
      isFakePlaceholderTranslation(entry)
    ).length;

    const safeCards = Array.isArray(activeVocabCards) ? activeVocabCards : [];
    let vocabCardsWithPlaceholders = 0;
    let vocabCardsNeedingNormalization = 0;
    let vocabCardsCustomEdited = 0;

    for (const card of safeCards) {
      if (!card || typeof card !== 'object') continue;
      if (card.hasCustomEdits) {
        vocabCardsCustomEdited += 1;
      }
      if (card.englishMeaning?.trim().startsWith('Contextual Arabic word')) {
        vocabCardsWithPlaceholders += 1;
      }
      if (!card.hasCustomEdits && card.wordWithTashkeel) {
        const normalized = applySmartPartialTashkeel(
          normalizeStandaloneVocabWord(card.wordWithTashkeel, {
            wordType: card.wordType,
            partOfSpeech: card.partOfSpeech,
          }) || card.wordWithTashkeel
        );
        if (normalized && normalized !== card.wordWithTashkeel) {
          vocabCardsNeedingNormalization += 1;
        }
      }
    }

    return {
      wordCacheTotal: wordCacheEntries.length,
      wordCachePlaceholders,
      vocabCardsTotal: safeCards.length,
      vocabCardsWithPlaceholders,
      vocabCardsNeedingNormalization,
      vocabCardsCustomEdited,
    };
  } catch (err) {
    return {
      wordCacheTotal: 0,
      wordCachePlaceholders: 0,
      vocabCardsTotal: Array.isArray(activeVocabCards) ? activeVocabCards.length : 0,
      vocabCardsWithPlaceholders: 0,
      vocabCardsNeedingNormalization: 0,
      vocabCardsCustomEdited: 0,
      error: err instanceof Error ? err.message : 'Saved cards & cache scan failed.',
    };
  }
}

export function runAdminHealthCheck(
  actorUser: AuthUser | null,
  activeVocabCards: VocabCard[],
  analysisCache: Record<string, WordAnalysis>
): AdminHealthSnapshot {
  assertAdminActor(actorUser);

  const checkErrors: Partial<Record<DiagnosticCheckKey, string>> = {};

  // 1. API Key & Gemini check
  const geminiRes = runGeminiAndKeyCheck();
  if (geminiRes.error) checkErrors.gemini = geminiRes.error;

  // 2. Browser speechSynthesis voices check
  const voicesRes = runSpeechVoicesCheckSync();
  if (voicesRes.error) checkErrors.voices = voicesRes.error;

  // 3. Audio path & TTS cache check
  const audioPathRes = runAudioPathAndCacheCheck(voicesRes, geminiRes.apiKeyConfigured);
  if (audioPathRes.error) checkErrors.audioPath = audioPathRes.error;

  // 4. Saved cards & cache scan
  const cardsRes = runCardsAndCacheScan(activeVocabCards, analysisCache);
  if (cardsRes.error) checkErrors.cardsAndCache = cardsRes.error;

  // 5. Supabase cloud database configuration check
  const supabaseCfg = getSupabaseConfigStatus();
  if (supabaseCfg.error) checkErrors.supabase = supabaseCfg.error;
  const supabaseDiag: SupabaseDiagnosticsSnapshot = {
    isConfigured: supabaseCfg.isConfigured,
    url: supabaseCfg.url,
    maskedKey: supabaseCfg.maskedKey,
    statusSummary: supabaseCfg.isConfigured
      ? 'Configured (Cloud sync ready)'
      : 'Not Configured (Operating in Local Fallback Mode)',
    error: supabaseCfg.error,
  };

  return {
    checkedAt: Date.now(),
    apiKeyConfigured: geminiRes.apiKeyConfigured,
    apiKeyMasked: geminiRes.apiKeyMasked,
    apiKeyFormat: geminiRes.apiKeyFormat,
    geminiStatusSummary: geminiRes.geminiStatusSummary,
    geminiText: geminiRes.geminiText,
    audio: audioPathRes.audio,
    audioContextState: audioPathRes.audioContextState,
    audioPathReady: audioPathRes.audioPathReady,
    supabase: supabaseDiag,
    wordCacheTotal: cardsRes.wordCacheTotal,
    wordCachePlaceholders: cardsRes.wordCachePlaceholders,
    vocabCardsTotal: cardsRes.vocabCardsTotal,
    vocabCardsWithPlaceholders: cardsRes.vocabCardsWithPlaceholders,
    vocabCardsNeedingNormalization: cardsRes.vocabCardsNeedingNormalization,
    vocabCardsCustomEdited: cardsRes.vocabCardsCustomEdited,
    checkErrors,
  };
}

export async function runFullAdminReScan(
  actorUser: AuthUser | null,
  activeVocabCards: VocabCard[],
  analysisCache: Record<string, WordAnalysis>
): Promise<AdminHealthSnapshot> {
  assertAdminActor(actorUser);

  const checkErrors: Partial<Record<DiagnosticCheckKey, string>> = {};

  // Execute each diagnostic check independently in its own try/catch + async isolation
  // so any slow or failing check never blocks completion of the others.
  const [geminiSettled, voicesSettled, cardsSettled, supabaseSettled] = await Promise.allSettled([
    (async () => {
      const base = runGeminiAndKeyCheck();
      if (!base.error && base.apiKey && !base.geminiText.cooldownActive && typeof window !== 'undefined') {
        try {
          const probeStatus = await probeGeminiEndpointMetadata(base.apiKey);
          if (probeStatus) {
            return { ...base, geminiStatusSummary: probeStatus };
          }
        } catch (err) {
          return {
            ...base,
            error: err instanceof Error ? err.message : 'Gemini endpoint probe failed.',
          };
        }
      }
      return base;
    })(),
    runSpeechVoicesCheckAsync(),
    Promise.resolve().then(() => runCardsAndCacheScan(activeVocabCards, analysisCache)),
    pingSupabaseConnection(),
  ]);

  const geminiRes =
    geminiSettled.status === 'fulfilled'
      ? geminiSettled.value
      : {
          apiKey: null,
          apiKeyConfigured: false,
          apiKeyMasked: 'Check Error',
          apiKeyFormat: 'Missing' as const,
          geminiText: createEmptyGeminiTextSnapshot(),
          geminiStatusSummary: 'Gemini check threw unexpectedly',
          error:
            geminiSettled.reason instanceof Error
              ? geminiSettled.reason.message
              : String(geminiSettled.reason),
        };
  if (geminiRes.error) checkErrors.gemini = geminiRes.error;

  const voicesRes =
    voicesSettled.status === 'fulfilled'
      ? voicesSettled.value
      : {
          speechSynthesisSupported: false,
          totalVoices: 0,
          arabicVoices: [] as AudioDiagnosticsSnapshot['arabicVoices'],
          error:
            voicesSettled.reason instanceof Error
              ? voicesSettled.reason.message
              : String(voicesSettled.reason),
        };
  if (voicesRes.error) checkErrors.voices = voicesRes.error;

  const audioPathRes = runAudioPathAndCacheCheck(voicesRes, geminiRes.apiKeyConfigured);
  if (audioPathRes.error) checkErrors.audioPath = audioPathRes.error;

  const cardsRes =
    cardsSettled.status === 'fulfilled'
      ? cardsSettled.value
      : {
          wordCacheTotal: 0,
          wordCachePlaceholders: 0,
          vocabCardsTotal: Array.isArray(activeVocabCards) ? activeVocabCards.length : 0,
          vocabCardsWithPlaceholders: 0,
          vocabCardsNeedingNormalization: 0,
          vocabCardsCustomEdited: 0,
          error:
            cardsSettled.reason instanceof Error
              ? cardsSettled.reason.message
              : String(cardsSettled.reason),
        };
  if (cardsRes.error) checkErrors.cardsAndCache = cardsRes.error;

  const baseSupabaseCfg = getSupabaseConfigStatus();
  let supabaseSummary = baseSupabaseCfg.isConfigured
    ? 'Configured'
    : 'Not Configured (Operating in Local Fallback Mode)';

  if (supabaseSettled.status === 'fulfilled') {
    const probe = supabaseSettled.value;
    supabaseSummary = probe.status;
    if (!probe.ok && baseSupabaseCfg.isConfigured) {
      checkErrors.supabase = probe.details || probe.status;
    }
  } else {
    supabaseSummary = 'Ping failed';
    checkErrors.supabase = String(supabaseSettled.reason);
  }

  const supabaseDiag: SupabaseDiagnosticsSnapshot = {
    isConfigured: baseSupabaseCfg.isConfigured,
    url: baseSupabaseCfg.url,
    maskedKey: baseSupabaseCfg.maskedKey,
    statusSummary: supabaseSummary,
    error: baseSupabaseCfg.error || checkErrors.supabase,
  };

  return {
    checkedAt: Date.now(),
    apiKeyConfigured: geminiRes.apiKeyConfigured,
    apiKeyMasked: geminiRes.apiKeyMasked,
    apiKeyFormat: geminiRes.apiKeyFormat,
    geminiStatusSummary: geminiRes.geminiStatusSummary,
    geminiText: geminiRes.geminiText,
    audio: audioPathRes.audio,
    audioContextState: audioPathRes.audioContextState,
    audioPathReady: audioPathRes.audioPathReady,
    supabase: supabaseDiag,
    wordCacheTotal: cardsRes.wordCacheTotal,
    wordCachePlaceholders: cardsRes.wordCachePlaceholders,
    vocabCardsTotal: cardsRes.vocabCardsTotal,
    vocabCardsWithPlaceholders: cardsRes.vocabCardsWithPlaceholders,
    vocabCardsNeedingNormalization: cardsRes.vocabCardsNeedingNormalization,
    vocabCardsCustomEdited: cardsRes.vocabCardsCustomEdited,
    checkErrors,
  };
}

export interface AutoRepairReport {
  repairedAt: number;
  removedWordCachePlaceholders: number;
  cleanedVocabPlaceholders: number;
  normalizedVocabCards: number;
  preservedCustomEditedCards: number;
  clearedGeminiCacheEntries: number;
  clearedAudioCacheEntries: number;
  repairedOtherAccountCards: number;
}

export function runAutoDataAndCacheRepair(params: {
  actorUser: AuthUser | null;
  activeVocabCards: VocabCard[];
  analysisCache: Record<string, WordAnalysis>;
  onVocabRepaired: (nextCards: VocabCard[]) => void;
  onAnalysisCacheRepaired: (nextCache: Record<string, WordAnalysis>) => void;
}): AutoRepairReport {
  assertAdminActor(params.actorUser);

  // 1. Scan and remove placeholder entries from qalam_word_cache_v2
  let removedWordCachePlaceholders = 0;
  const cleanedWordCache: Record<string, WordAnalysis> = {};
  for (const [key, val] of Object.entries(params.analysisCache || {})) {
    if (isFakePlaceholderTranslation(val)) {
      removedWordCachePlaceholders += 1;
    } else {
      cleanedWordCache[key] = val;
    }
  }
  params.onAnalysisCacheRepaired(cleanedWordCache);

  // 2. Repair active user's vocabCards: clean placeholders + normalize standalone form (preserving hasCustomEdits)
  let cleanedVocabPlaceholders = 0;
  let normalizedVocabCards = 0;
  let preservedCustomEditedCards = 0;

  const repairCardList = (cards: VocabCard[]): { next: VocabCard[]; changed: boolean } => {
    let listChanged = false;
    const next = cards.map((card) => {
      let updated = card;
      let cardChanged = false;

      if (card.englishMeaning?.trim().startsWith('Contextual Arabic word')) {
        cleanedVocabPlaceholders += 1;
        cardChanged = true;
        updated = {
          ...updated,
          englishMeaning: 'Translation pending — tap Translate or Edit to retry',
          transliteration:
            card.transliteration === card.word ? '' : card.transliteration,
        };
      }

      if (card.hasCustomEdits) {
        preservedCustomEditedCards += 1;
      } else {
        const standaloneAr = applySmartPartialTashkeel(
          normalizeStandaloneVocabWord(updated.wordWithTashkeel, {
            wordType: updated.wordType,
            partOfSpeech: updated.partOfSpeech,
          }) || updated.wordWithTashkeel
        );
        const nextWord = stripTashkeel(standaloneAr) || updated.word;
        const nextKey = normalizeStandaloneArabicKey(standaloneAr) || updated.normalizedKey;
        const nextVocalized = stripFinalIrabForSpeech(standaloneAr, {
          wordType: updated.wordType,
          partOfSpeech: updated.partOfSpeech,
        });

        if (
          standaloneAr !== updated.wordWithTashkeel ||
          nextKey !== updated.normalizedKey ||
          nextWord !== updated.word
        ) {
          normalizedVocabCards += 1;
          cardChanged = true;
          invalidateCachedArabicAudio(updated.wordWithTashkeel, 'word');
          updated = {
            ...updated,
            word: nextWord,
            wordWithTashkeel: standaloneAr,
            normalizedKey: nextKey,
            vocalizedWord: nextVocalized,
          };
        }
      }

      if (cardChanged) listChanged = true;
      return updated;
    });
    return { next, changed: listChanged };
  };

  const activeRepair = repairCardList(params.activeVocabCards);
  if (activeRepair.changed) {
    params.onVocabRepaired(activeRepair.next);
  }

  // Also scan any other qalam_vocab_cards_v2::* stores in localStorage for placeholders
  let repairedOtherAccountCards = 0;
  if (typeof window !== 'undefined') {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const storageKey = window.localStorage.key(i);
        if (!storageKey || !storageKey.startsWith('qalam_vocab_cards_v2::')) continue;
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as VocabCard[];
        if (!Array.isArray(parsed)) continue;
        let touched = false;
        const fixed = parsed.map((c) => {
          if (c.englishMeaning?.trim().startsWith('Contextual Arabic word')) {
            touched = true;
            repairedOtherAccountCards += 1;
            return {
              ...c,
              englishMeaning: 'Translation pending — tap Translate or Edit to retry',
            };
          }
          return c;
        });
        if (touched) {
          window.localStorage.setItem(storageKey, JSON.stringify(fixed));
        }
      }
    } catch {
      // Ignore storage scan errors
    }
  }

  // 3. Clear Gemini response cache + cooldowns & stale TTS audio caches
  const geminiCleared = clearGeminiResponseCaches();
  const audioCleared = clearAllArabicAudioCaches();

  return {
    repairedAt: Date.now(),
    removedWordCachePlaceholders,
    cleanedVocabPlaceholders,
    normalizedVocabCards,
    preservedCustomEditedCards,
    clearedGeminiCacheEntries: geminiCleared.clearedMemory + geminiCleared.clearedPersistent,
    clearedAudioCacheEntries: audioCleared.clearedMemory + audioCleared.clearedPersistent,
    repairedOtherAccountCards,
  };
}

export interface LiveToolTestResult {
  tool: 'gemini_ping' | 'supabase_ping' | 'translation' | 'audio' | 'vocab_edit_cache';
  ok: boolean;
  durationMs: number;
  summary: string;
  details: string;
}

export async function pingSupabaseApiStatus(
  actorUser: AuthUser | null
): Promise<LiveToolTestResult> {
  assertAdminActor(actorUser);
  const res = await pingSupabaseConnection();
  return {
    tool: 'supabase_ping',
    ok: res.ok,
    durationMs: res.latencyMs,
    summary: `Supabase: ${res.status}`,
    details: res.details || 'Connection check completed.',
  };
}

export async function pingGeminiApiStatus(
  actorUser: AuthUser | null
): Promise<LiveToolTestResult> {
  assertAdminActor(actorUser);
  const apiKey = getClientGeminiApiKey();
  if (!apiKey) {
    return {
      tool: 'gemini_ping',
      ok: false,
      durationMs: 0,
      summary: 'VITE_GEMINI_API_KEY is missing',
      details: 'No client Gemini API key found in import.meta.env.VITE_GEMINI_API_KEY.',
    };
  }

  const started = performance.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7000);
  const authMode = apiKey.startsWith('AQ.') ? 'Authorization: Bearer (AQ.)' : 'x-goog-api-key';

  try {
    const { response, errorBody } = await fetchGeminiGenerateContent({
      model: 'gemini-2.5-flash',
      apiKey,
      signal: controller.signal,
      logPrefix: 'Admin Diagnostics Ping',
      payload: {
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
      },
    });
    const durationMs = Math.round(performance.now() - started);

    if (response.ok) {
      return {
        tool: 'gemini_ping',
        ok: true,
        durationMs,
        summary: `Gemini API HTTP ${response.status} OK (${authMode})`,
        details: `Live probe succeeded for ${maskApiKey(apiKey)}`,
      };
    }

    const snippet = errorBody.replace(/\s+/g, ' ').slice(0, 180);
    return {
      tool: 'gemini_ping',
      ok: false,
      durationMs,
      summary: `Gemini API returned HTTP ${response.status} (${authMode})`,
      details: snippet || response.statusText,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    return {
      tool: 'gemini_ping',
      ok: false,
      durationMs,
      summary: 'Gemini API network/timeout error',
      details: err instanceof Error ? err.message : String(err),
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function testTranslationTool(
  actorUser: AuthUser | null,
  sampleArabic: string
): Promise<LiveToolTestResult> {
  assertAdminActor(actorUser);
  const word = sampleArabic.trim() || 'مَكْتَبَة';
  const started = performance.now();

  try {
    const res = await analyzeArabicWordClient({
      word,
      contextSentence: word,
      level: 'intermediate',
    });
    const durationMs = Math.round(performance.now() - started);
    return {
      tool: 'translation',
      ok: true,
      durationMs,
      summary: `Translated "${res.wordWithTashkeel}" → "${res.englishMeaning}" (${res.source || 'gemini'})`,
      details: [
        `POS: ${res.partOfSpeech}`,
        res.transliteration ? `Transliteration: ${res.transliteration}` : '',
        `Examples returned: ${res.examples.length}`,
        res.notice ? `Notice: ${res.notice}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      tool: 'translation',
      ok: false,
      durationMs,
      summary: 'Translation call returned an error',
      details: msg,
    };
  }
}

export async function testAudioPlaybackTool(
  actorUser: AuthUser | null,
  sampleArabic: string
): Promise<LiveToolTestResult> {
  assertAdminActor(actorUser);
  const text = sampleArabic.trim() || 'مَرْحَبًا';
  const started = performance.now();
  const beforeSnap = getAudioDiagnosticsSnapshot();

  unlockArabicAudioContext();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, summary: string, details: string) => {
      if (settled) return;
      settled = true;
      resolve({
        tool: 'audio',
        ok,
        durationMs: Math.round(performance.now() - started),
        summary,
        details,
      });
    };

    const watchdog = window.setTimeout(() => {
      finish(
        false,
        'Audio test timed out after 7s',
        `Arabic voices installed: ${beforeSnap.arabicVoices.length} | Audio cooldown: ${
          beforeSnap.geminiAudioCooldownActive ? `${beforeSnap.geminiAudioCooldownRemainingSec}s` : 'none'
        }`
      );
    }, 7000);

    speakArabic(text, {
      mode: 'word',
      rate: 0.95,
      onStart: () => {
        window.clearTimeout(watchdog);
        const afterSnap = getAudioDiagnosticsSnapshot();
        finish(
          true,
          `Audio playback started for "${text}"`,
          `Browser ar-* voices: ${afterSnap.arabicVoices.length} | Cached clips (mem/disk): ${afterSnap.memoryCachedClips}/${afterSnap.persistentCachedClips}`
        );
      },
      onError: (msg) => {
        window.clearTimeout(watchdog);
        const afterSnap = getAudioDiagnosticsSnapshot();
        finish(
          false,
          'Audio playback reported diagnostic error',
          `${msg} | Browser ar-* voices: ${afterSnap.arabicVoices.length} | Gemini cooldown: ${
            afterSnap.geminiAudioCooldownActive
              ? `${afterSnap.geminiAudioCooldownRemainingSec}s`
              : 'inactive'
          }`
        );
      },
    });
  });
}

export function testVocabEditAndCacheTool(
  actorUser: AuthUser | null,
  sampleArabic: string
): LiveToolTestResult {
  assertAdminActor(actorUser);
  const started = performance.now();
  const input = sampleArabic.trim() || 'كِتَابًا';

  const standalone = applySmartPartialTashkeel(
    normalizeStandaloneVocabWord(input, { wordType: 'اسم', partOfSpeech: 'Noun' }) || input
  );
  const pausal = stripFinalIrabForSpeech(standalone, { wordType: 'اسم', partOfSpeech: 'Noun' });
  invalidateCachedArabicAudio(input, 'word');
  invalidateCachedArabicAudio(standalone, 'word');

  const durationMs = Math.round(performance.now() - started);
  const caseStripped = standalone !== input;

  return {
    tool: 'vocab_edit_cache',
    ok: Boolean(standalone && pausal),
    durationMs,
    summary: `Normalized "${input}" → "${standalone}" (Pausal speech: "${pausal}")`,
    details: `Case-ending normalized: ${caseStripped ? 'Yes' : 'Already standalone'} · Cache invalidation executed cleanly`,
  };
}

export function formatDiagnosticReportText(params: {
  health: AdminHealthSnapshot;
  repair?: AutoRepairReport | null;
  testResults?: LiveToolTestResult[];
}): string {
  const { health, repair, testResults = [] } = params;
  const checkErrorEntries = Object.entries(health.checkErrors || {}).filter(([, msg]) => Boolean(msg));
  const lines = [
    '=== Qalam Admin Diagnostics Report ===',
    `Generated: ${new Date().toISOString()}`,
    `Last Scanned At: ${new Date(health.checkedAt).toISOString()}`,
    `VITE_GEMINI_API_KEY: ${health.apiKeyConfigured ? `${health.apiKeyMasked} [${health.apiKeyFormat}]` : 'MISSING'}`,
    `Gemini Status: ${health.geminiStatusSummary}`,
    `Supabase Cloud DB: ${
      health.supabase.isConfigured
        ? `Configured [${health.supabase.maskedKey}] - ${health.supabase.statusSummary}`
        : 'Not Configured (Operating in Local Fallback Mode)'
    }`,
    `Gemini Text Cooldown: ${
      health.geminiText.cooldownActive
        ? `ACTIVE (${health.geminiText.cooldownRemainingSec}s) - ${health.geminiText.quotaReason || ''}`
        : 'Ready (No cooldown)'
    }`,
    `AudioContext: ${health.audioContextState} | Audio Path Ready: ${health.audioPathReady ? 'Yes' : 'No'}`,
    `Gemini Audio Cooldown: ${
      health.audio.geminiAudioCooldownActive
        ? `ACTIVE (${health.audio.geminiAudioCooldownRemainingSec}s)`
        : 'Ready (No cooldown)'
    }${health.audio.geminiAudioRejectedReason ? ` | Rejected: ${health.audio.geminiAudioRejectedReason}` : ''}`,
    `Browser SpeechSynthesis: ${health.audio.speechSynthesisSupported ? 'Supported' : 'Unsupported'} | Total voices: ${health.audio.totalVoices} | Arabic (ar-*) voices: ${health.audio.arabicVoices.length}`,
    ...(health.audio.arabicVoices.length > 0
      ? [`  Voices: ${health.audio.arabicVoices.map((v) => `${v.name} (${v.lang})`).join(', ')}`]
      : []),
    `Caches: WordCache=${health.wordCacheTotal} (Placeholders=${health.wordCachePlaceholders}) | GeminiRespCache=${health.geminiText.persistentCacheEntries} | TTSCache(mem/disk)=${health.audio.memoryCachedClips}/${health.audio.persistentCachedClips}`,
    `Vocabulary Deck: Total=${health.vocabCardsTotal} | CustomEdited=${health.vocabCardsCustomEdited} | NeedsNormalization=${health.vocabCardsNeedingNormalization} | Placeholders=${health.vocabCardsWithPlaceholders}`,
    ...(checkErrorEntries.length > 0
      ? [
          '--- Isolated Check Errors ---',
          ...checkErrorEntries.map(([checkName, msg]) => `[${checkName}] ${msg}`),
        ]
      : []),
  ];

  if (repair) {
    lines.push(
      '--- Last Auto-Repair Run ---',
      `Removed WordCache Placeholders: ${repair.removedWordCachePlaceholders}`,
      `Cleaned Vocab Placeholders: ${repair.cleanedVocabPlaceholders} (Other stores: ${repair.repairedOtherAccountCards})`,
      `Normalized Standalone Cards: ${repair.normalizedVocabCards} (Preserved custom edits: ${repair.preservedCustomEditedCards})`,
      `Cleared Stale Caches (Gemini/Audio): ${repair.clearedGeminiCacheEntries} / ${repair.clearedAudioCacheEntries}`
    );
  }

  if (testResults.length > 0) {
    lines.push('--- Live Tool Test Results ---');
    for (const t of testResults) {
      lines.push(`[${t.ok ? 'PASS' : 'WARN/ERR'}] ${t.tool} (${t.durationMs}ms): ${t.summary} — ${t.details}`);
    }
  }

  return lines.join('\n');
}
