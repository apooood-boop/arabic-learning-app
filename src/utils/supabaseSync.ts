import {
  AdminManagedAccount,
  AuthUser,
  Lesson,
  ProficiencyLevel,
  ReaderPreferences,
  ReadingHistoryItem,
  StudyNote,
  StudyStreak,
  UserRole,
  VocabCard,
} from '../types/arabic';
import { DailyStudyLog } from '../components/WeeklyVocabChart';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  TABLE_PROFILES,
  TABLE_STUDY_NOTES,
  TABLE_USER_PROGRESS,
  TABLE_VOCAB_CARDS,
} from './supabaseClient';
import { isPrimaryOwnerEmail, resolveAccountRole } from './auth';

export interface UserProgressData {
  selectedLevel?: ProficiencyLevel;
  readingHistory?: ReadingHistoryItem[];
  studyStreak?: StudyStreak;
  dailyLogs?: Record<string, DailyStudyLog>;
  dailyWordGoal?: number;
  readerPreferences?: ReaderPreferences;
}

// ==============================================================================
// 1. User Profiles & Accounts Cloud Operations
// ==============================================================================

export async function syncRegisterProfileToCloud(account: {
  id: string;
  name: string;
  email: string;
  role?: UserRole | 'member' | string;
  salt: string;
  passwordHash: string;
  createdAt: number;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const email = account.email.trim().toLowerCase();
  const role = resolveAccountRole(email, account.role);
  const isPrimary = isPrimaryOwnerEmail(email);

  try {
    const { error } = await client.from(TABLE_PROFILES).upsert(
      {
        id: account.id,
        name: account.name,
        email,
        role,
        is_primary_owner: isPrimary,
        salt: account.salt,
        password_hash: account.passwordHash,
        created_at: new Date(account.createdAt).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'email' }
    );

    if (error) {
      console.warn('[Qalam Supabase] Failed to register profile in cloud:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Qalam Supabase] Exception registering profile in cloud:', err);
    return false;
  }
}

export async function fetchProfileFromCloudByEmail(emailInput: string): Promise<{
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isPrimaryOwner: boolean;
  salt: string;
  passwordHash: string;
  createdAt: number;
} | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const email = emailInput.trim().toLowerCase();
  try {
    const { data, error } = await client
      .from(TABLE_PROFILES)
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error || !data) return null;

    const resolvedRole = resolveAccountRole(data.email, data.role);
    const isPrimary = isPrimaryOwnerEmail(data.email);

    return {
      id: data.id,
      name: data.name,
      email: data.email,
      role: resolvedRole,
      isPrimaryOwner: isPrimary,
      salt: data.salt || '',
      passwordHash: data.password_hash || '',
      createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
    };
  } catch (err) {
    console.warn('[Qalam Supabase] Exception reading profile from cloud:', err);
    return null;
  }
}

export async function updatePasswordInCloud(params: {
  email: string;
  salt: string;
  passwordHash: string;
}): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const email = params.email.trim().toLowerCase();
  try {
    const { error } = await client
      .from(TABLE_PROFILES)
      .update({
        salt: params.salt,
        password_hash: params.passwordHash,
        updated_at: new Date().toISOString(),
      })
      .eq('email', email);

    return !error;
  } catch {
    return false;
  }
}

export async function fetchAllProfilesFromCloud(): Promise<AdminManagedAccount[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from(TABLE_PROFILES)
      .select('id, name, email, role, is_primary_owner, created_at')
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return null;

    return data.map((item) => {
      const email = (item.email || '').trim().toLowerCase();
      const role = resolveAccountRole(email, item.role);
      const isPrimary = isPrimaryOwnerEmail(email);

      return {
        id: item.id,
        name: item.name,
        email,
        role,
        isPrimaryOwner: isPrimary,
        createdAt: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
      };
    });
  } catch (err) {
    console.warn('[Qalam Supabase] Failed to list accounts for admin from cloud:', err);
    return null;
  }
}

export async function updateProfileRoleInCloud(
  targetUserId: string,
  targetEmail: string,
  nextRole: UserRole
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  if (isPrimaryOwnerEmail(targetEmail)) {
    return false; // Immutable
  }

  try {
    const { error } = await client
      .from(TABLE_PROFILES)
      .update({
        role: nextRole,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetUserId);

    return !error;
  } catch {
    return false;
  }
}

export async function deleteProfileFromCloud(
  targetUserId: string,
  targetEmail: string
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  if (isPrimaryOwnerEmail(targetEmail)) {
    return false; // Immutable
  }

  try {
    const { error } = await client.from(TABLE_PROFILES).delete().eq('id', targetUserId);
    return !error;
  } catch {
    return false;
  }
}

// ==============================================================================
// 2. Vocabulary Cards Cloud Operations
// ==============================================================================

export async function fetchVocabCardsFromCloud(userId: string): Promise<VocabCard[] | null> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo') return null;

  try {
    const { data, error } = await client
      .from(TABLE_VOCAB_CARDS)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return null;

    return data.map((row) => ({
      id: row.id,
      word: row.word,
      wordWithTashkeel: row.word_with_tashkeel,
      vocalizedWord: row.vocalized_word || undefined,
      normalizedKey: row.normalized_key,
      englishMeaning: row.english_meaning,
      transliteration: row.transliteration || '',
      partOfSpeech: row.part_of_speech || 'Noun',
      wordType: row.word_type || undefined,
      root: row.root || undefined,
      level: row.level || 'beginner',
      status: row.status || 'needs_review',
      srsRating: row.srs_rating || undefined,
      examples: Array.isArray(row.examples) ? row.examples : [],
      hasCustomEdits: Boolean(row.has_custom_edits),
      createdAt: Number(row.created_at) || Date.now(),
      lastReviewedAt: row.last_reviewed_at ? Number(row.last_reviewed_at) : undefined,
      nextReviewAt: row.next_review_at ? Number(row.next_review_at) : undefined,
      intervalDays: row.interval_days ? Number(row.interval_days) : 1,
      reviewCount: row.review_count ? Number(row.review_count) : 0,
    }));
  } catch (err) {
    console.warn('[Qalam Supabase] Failed to fetch vocab cards:', err);
    return null;
  }
}

export async function upsertVocabCardsToCloud(
  userId: string,
  cards: VocabCard[]
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo' || cards.length === 0) return false;

  const rows = cards.map((c) => ({
    id: c.id,
    user_id: userId,
    word: c.word,
    word_with_tashkeel: c.wordWithTashkeel,
    vocalized_word: c.vocalizedWord || null,
    normalized_key: c.normalizedKey,
    english_meaning: c.englishMeaning,
    transliteration: c.transliteration || '',
    part_of_speech: c.partOfSpeech || 'Noun',
    word_type: c.wordType || null,
    root: c.root || null,
    level: c.level || 'beginner',
    status: c.status || 'needs_review',
    srs_rating: c.srsRating || null,
    examples: Array.isArray(c.examples) ? c.examples : [],
    has_custom_edits: Boolean(c.hasCustomEdits),
    created_at: c.createdAt,
    last_reviewed_at: c.lastReviewedAt || null,
    next_review_at: c.nextReviewAt || null,
    interval_days: c.intervalDays || 1,
    review_count: c.reviewCount || 0,
    updated_at: new Date().toISOString(),
  }));

  try {
    const { error } = await client.from(TABLE_VOCAB_CARDS).upsert(rows, { onConflict: 'id' });
    if (error) {
      console.warn('[Qalam Supabase] Error saving vocab cards to cloud:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Qalam Supabase] Exception saving vocab cards to cloud:', err);
    return false;
  }
}

export async function deleteVocabCardFromCloud(userId: string, cardId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo') return false;

  try {
    const { error } = await client
      .from(TABLE_VOCAB_CARDS)
      .delete()
      .eq('id', cardId)
      .eq('user_id', userId);

    return !error;
  } catch {
    return false;
  }
}

// ==============================================================================
// 3. Study Notes Cloud Operations
// ==============================================================================

export async function fetchStudyNotesFromCloud(userId: string): Promise<StudyNote[] | null> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo') return null;

  try {
    const { data, error } = await client
      .from(TABLE_STUDY_NOTES)
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error || !Array.isArray(data)) return null;

    return data.map((row) => ({
      id: row.id,
      title: row.title || undefined,
      body: row.body || '',
      context: row.context || undefined,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
    }));
  } catch (err) {
    console.warn('[Qalam Supabase] Failed to fetch notes:', err);
    return null;
  }
}

export async function upsertStudyNotesToCloud(
  userId: string,
  notes: StudyNote[]
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo' || notes.length === 0) return false;

  const rows = notes.map((n) => ({
    id: n.id,
    user_id: userId,
    title: n.title || null,
    body: n.body,
    context: n.context || null,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  }));

  try {
    const { error } = await client.from(TABLE_STUDY_NOTES).upsert(rows, { onConflict: 'id' });
    if (error) {
      console.warn('[Qalam Supabase] Error saving study notes to cloud:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Qalam Supabase] Exception saving study notes to cloud:', err);
    return false;
  }
}

export async function deleteStudyNoteFromCloud(userId: string, noteId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo') return false;

  try {
    const { error } = await client
      .from(TABLE_STUDY_NOTES)
      .delete()
      .eq('id', noteId)
      .eq('user_id', userId);

    return !error;
  } catch {
    return false;
  }
}

// ==============================================================================
// 4. Learning Progress Cloud Operations
// ==============================================================================

export async function fetchUserProgressFromCloud(userId: string): Promise<UserProgressData | null> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo') return null;

  try {
    const { data, error } = await client
      .from(TABLE_USER_PROGRESS)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      selectedLevel: data.selected_level as ProficiencyLevel,
      readingHistory: Array.isArray(data.reading_history) ? data.reading_history : [],
      studyStreak: data.study_streak || { count: 0, lastActivityDate: null },
      dailyLogs: data.daily_logs || {},
      dailyWordGoal: typeof data.daily_word_goal === 'number' ? data.daily_word_goal : 5,
      readerPreferences: data.reader_preferences || undefined,
    };
  } catch (err) {
    console.warn('[Qalam Supabase] Failed to fetch user progress:', err);
    return null;
  }
}

export async function upsertUserProgressToCloud(
  userId: string,
  progress: UserProgressData
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo') return false;

  try {
    const row = {
      user_id: userId,
      selected_level: progress.selectedLevel || 'beginner',
      reading_history: progress.readingHistory || [],
      study_streak: progress.studyStreak || { count: 0, lastActivityDate: null },
      daily_logs: progress.dailyLogs || {},
      daily_word_goal: progress.dailyWordGoal || 5,
      reader_preferences: progress.readerPreferences || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await client.from(TABLE_USER_PROGRESS).upsert(row, { onConflict: 'user_id' });
    if (error) {
      console.warn('[Qalam Supabase] Error saving user progress to cloud:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Qalam Supabase] Exception saving user progress to cloud:', err);
    return false;
  }
}
