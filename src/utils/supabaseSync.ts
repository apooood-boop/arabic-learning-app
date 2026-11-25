import {
  AdminManagedAccount,
  AuthUser,
  Lesson,
  LessonStatus,
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
  getSupabaseConfigStatus,
  TABLE_LESSONS,
  TABLE_PROFILES,
  TABLE_STUDY_NOTES,
  TABLE_USER_PROGRESS,
  TABLE_VOCAB_CARDS,
} from './supabaseClient';
import { SupabaseClient } from '@supabase/supabase-js';
import { isPrimaryOwnerEmail, resolveAccountRole } from './auth';

export interface StudyNoteCloudResult {
  ok: boolean;
  userId?: string;
  error?: string;
}

export interface VocabCloudSyncResult {
  ok: boolean;
  syncedCount: number;
  userId?: string;
  error?: string;
}

type CloudUserRef = Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string | null;

async function resolveCloudProfileUserId(
  client: SupabaseClient,
  profileUser?: CloudUserRef,
  contextLabel = 'cloud_sync'
): Promise<{ userId: string | null; error?: string }> {
  let sessionUser: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null = null;
  try {
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();
    if (sessionError) {
      console.warn(`[Qalam Supabase] Error reading auth session (${contextLabel}):`, sessionError.message);
    }
    sessionUser = session?.user ?? null;
  } catch (err) {
    console.warn(`[Qalam Supabase] Exception reading auth session (${contextLabel}):`, err);
  }

  const passedId =
    typeof profileUser === 'string'
      ? profileUser
      : profileUser && !profileUser.isGuest
        ? profileUser.id
        : null;
  const candidateId = sessionUser?.id || (passedId && passedId !== 'guest-demo' ? passedId : null);

  if (!candidateId) {
    return {
      userId: null,
      error: 'You must be signed in to sync data to the cloud.',
    };
  }

  const candidateEmail = (
    sessionUser?.email ||
    (typeof profileUser === 'object' && profileUser ? profileUser.email : '') ||
    ''
  )
    .trim()
    .toLowerCase();

  try {
    const { data: byId, error: byIdError } = await client
      .from(TABLE_PROFILES)
      .select('id')
      .eq('id', candidateId)
      .maybeSingle();

    if (byId?.id) {
      return { userId: byId.id };
    }
    if (byIdError) {
      console.warn(`[Qalam Supabase] Profile lookup by id failed (${contextLabel}):`, byIdError.message);
    }

    if (candidateEmail) {
      const { data: byEmail, error: byEmailError } = await client
        .from(TABLE_PROFILES)
        .select('id')
        .ilike('email', candidateEmail)
        .maybeSingle();

      if (byEmail?.id) {
        return { userId: byEmail.id };
      }
      if (byEmailError) {
        console.warn(`[Qalam Supabase] Profile lookup by email failed (${contextLabel}):`, byEmailError.message);
      }

      const displayName =
        (typeof profileUser === 'object' && profileUser?.name?.trim()) ||
        (typeof sessionUser?.user_metadata?.name === 'string'
          ? sessionUser.user_metadata.name.trim()
          : '') ||
        'Learner';
      const role = resolveAccountRole(
        candidateEmail,
        typeof profileUser === 'object' && profileUser ? profileUser.role : undefined
      );
      const isPrimary = isPrimaryOwnerEmail(candidateEmail);

      const { data: ensured, error: ensureError } = await client
        .from(TABLE_PROFILES)
        .upsert(
          {
            id: candidateId,
            name: displayName,
            email: candidateEmail,
            role,
            is_primary_owner: isPrimary,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'email' }
        )
        .select('id')
        .maybeSingle();

      if (ensured?.id) {
        return { userId: ensured.id };
      }
      if (ensureError) {
        console.error(`[Qalam Supabase] Failed to ensure profile row for ${contextLabel}:`, ensureError);
      }
    }
  } catch (err) {
    console.warn(`[Qalam Supabase] Exception resolving profile id for ${contextLabel}:`, err);
  }

  return { userId: candidateId };
}

async function getAuthenticatedSupabaseUserId(client: SupabaseClient): Promise<string | null> {
  try {
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user?.id) {
      return null;
    }
    return user.id;
  } catch {
    return null;
  }
}

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

export async function fetchVocabCardsFromCloud(
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string
): Promise<VocabCard[] | null> {
  const client = getSupabaseClient();
  const userId = typeof user === 'string' ? user : user?.id;
  if (!client || !userId || userId === 'guest-demo') return null;

  const resolved = await resolveCloudProfileUserId(client, user, 'vocabulary_cards');
  if (!resolved.userId) return null;

  try {
    const { data, error } = await client
      .from(TABLE_VOCAB_CARDS)
      .select('*')
      .eq('user_id', resolved.userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Qalam Supabase] Failed to fetch vocabulary_cards:', error);
      return null;
    }
    if (!Array.isArray(data)) return null;

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
    console.error('[Qalam Supabase] Exception fetching vocabulary_cards:', err);
    return null;
  }
}

export async function upsertVocabCardsToCloudWithResult(
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string,
  cards: VocabCard[]
): Promise<VocabCloudSyncResult> {
  const client = getSupabaseClient();
  if (!client) {
    const cfg = getSupabaseConfigStatus();
    return {
      ok: false,
      syncedCount: 0,
      error: cfg.error || 'Supabase is not configured.',
    };
  }

  const userId = typeof user === 'string' ? user : user?.id;
  if (!userId || userId === 'guest-demo' || (typeof user === 'object' && user?.isGuest)) {
    return {
      ok: false,
      syncedCount: 0,
      error: 'Sign in with an account to sync flashcards to Supabase.',
    };
  }

  if (cards.length === 0) {
    return { ok: true, syncedCount: 0 };
  }

  const resolved = await resolveCloudProfileUserId(client, user, 'vocabulary_cards');
  if (!resolved.userId) {
    const message = resolved.error || 'No authenticated user found for vocabulary_cards sync.';
    console.error('[Qalam Supabase] Cannot sync vocabulary_cards:', message);
    return { ok: false, syncedCount: 0, error: message };
  }

  const now = Date.now();
  const rows = cards.map((c) => ({
    id: c.id,
    user_id: resolved.userId!,
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
    created_at: Math.trunc(c.createdAt || now),
    last_reviewed_at: c.lastReviewedAt ? Math.trunc(c.lastReviewedAt) : null,
    next_review_at: c.nextReviewAt ? Math.trunc(c.nextReviewAt) : null,
    interval_days: Math.max(1, Math.trunc(c.intervalDays || 1)),
    review_count: Math.max(0, Math.trunc(c.reviewCount || 0)),
    updated_at: new Date().toISOString(),
  }));

  try {
    const { error } = await client.from(TABLE_VOCAB_CARDS).upsert(rows, { onConflict: 'id' });
    if (error) {
      console.error('[Qalam Supabase] Error saving vocab cards to vocabulary_cards:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        userId: resolved.userId,
        count: rows.length,
      });
      return {
        ok: false,
        syncedCount: 0,
        userId: resolved.userId,
        error: error.message || 'Failed to sync flashcards to Supabase.',
      };
    }
    return { ok: true, syncedCount: rows.length, userId: resolved.userId };
  } catch (err) {
    console.error('[Qalam Supabase] Exception saving vocab cards to vocabulary_cards:', err);
    return {
      ok: false,
      syncedCount: 0,
      userId: resolved.userId,
      error: err instanceof Error ? err.message : 'Unexpected error syncing flashcards to Supabase.',
    };
  }
}

export async function upsertVocabCardsToCloud(
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string,
  cards: VocabCard[]
): Promise<boolean> {
  const res = await upsertVocabCardsToCloudWithResult(user, cards);
  return res.ok;
}

export async function deleteVocabCardFromCloud(
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string,
  cardId: string
): Promise<boolean> {
  const client = getSupabaseClient();
  const userId = typeof user === 'string' ? user : user?.id;
  if (!client || !userId || userId === 'guest-demo') return false;

  const resolved = await resolveCloudProfileUserId(client, user, 'vocabulary_cards');
  if (!resolved.userId) return false;

  try {
    const { error } = await client
      .from(TABLE_VOCAB_CARDS)
      .delete()
      .eq('id', cardId)
      .eq('user_id', resolved.userId);

    if (error) {
      console.error('[Qalam Supabase] Failed to delete vocabulary_card:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Qalam Supabase] Exception deleting vocabulary_card:', err);
    return false;
  }
}

// ==============================================================================
// 3. Study Notes Cloud Operations
// ==============================================================================

export async function fetchStudyNotesFromCloud(
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string
): Promise<StudyNote[] | null> {
  const client = getSupabaseClient();
  const userId = typeof user === 'string' ? user : user?.id;
  if (!client || !userId || userId === 'guest-demo') return null;

  const resolved = await resolveCloudProfileUserId(client, user, 'study_notes');
  if (!resolved.userId) return null;

  try {
    const { data, error } = await client
      .from(TABLE_STUDY_NOTES)
      .select('*')
      .eq('user_id', resolved.userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[Qalam Supabase] Failed to fetch study_notes:', error);
      return null;
    }
    if (!Array.isArray(data)) return null;

    return data.map((row) => ({
      id: row.id,
      title: row.title || undefined,
      body: row.body || '',
      context: row.context || undefined,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
    }));
  } catch (err) {
    console.error('[Qalam Supabase] Exception fetching study_notes:', err);
    return null;
  }
}

export async function upsertStudyNoteToCloud(
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string,
  note: StudyNote
): Promise<StudyNoteCloudResult> {
  const client = getSupabaseClient();
  if (!client) {
    const cfg = getSupabaseConfigStatus();
    const message = cfg.error || 'Supabase is not configured.';
    console.error('[Qalam Supabase] Cannot save study note:', message);
    return { ok: false, error: message };
  }

  const cleanBody = (note.body ?? '').trim();
  if (!cleanBody) {
    const message = 'Study note content cannot be empty.';
    console.error('[Qalam Supabase] Study note validation failed:', message);
    return { ok: false, error: message };
  }

  const resolved = await resolveCloudProfileUserId(client, user, 'study_notes');
  if (!resolved.userId) {
    const message = resolved.error || 'No authenticated user found for study_notes save.';
    console.error('[Qalam Supabase] Cannot save study note:', message);
    return { ok: false, error: message };
  }

  const cleanTitle = note.title?.trim() || null;
  const now = Date.now();
  const payload = {
    id: note.id,
    user_id: resolved.userId,
    title: cleanTitle,
    body: cleanBody,
    context: note.context ?? null,
    created_at: Math.trunc(note.createdAt || now),
    updated_at: Math.trunc(note.updatedAt || now),
  };

  try {
    const { data, error } = await client
      .from(TABLE_STUDY_NOTES)
      .upsert(payload, { onConflict: 'id' })
      .select('id, user_id')
      .maybeSingle();

    if (error) {
      console.error('[Qalam Supabase] Failed to save study note to study_notes:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        userId: resolved.userId,
        noteId: note.id,
      });
      return {
        ok: false,
        error: error.message || 'Failed to save study note to Supabase.',
      };
    }

    return { ok: true, userId: data?.user_id || resolved.userId };
  } catch (err) {
    console.error('[Qalam Supabase] Exception saving study note to study_notes:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unexpected error saving study note to Supabase.',
    };
  }
}

export async function upsertStudyNotesToCloud(
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string,
  notes: StudyNote[]
): Promise<boolean> {
  const client = getSupabaseClient();
  const userId = typeof user === 'string' ? user : user?.id;
  if (!client || !userId || userId === 'guest-demo' || notes.length === 0) return false;

  const validNotes = notes.filter((n) => (n.body ?? '').trim().length > 0);
  if (validNotes.length === 0) return false;

  const resolved = await resolveCloudProfileUserId(client, user, 'study_notes');
  if (!resolved.userId) {
    console.error('[Qalam Supabase] Cannot sync study_notes:', resolved.error || 'No authenticated user.');
    return false;
  }

  const rows = validNotes.map((n) => ({
    id: n.id,
    user_id: resolved.userId!,
    title: n.title?.trim() || null,
    body: n.body.trim(),
    context: n.context || null,
    created_at: Math.trunc(n.createdAt || Date.now()),
    updated_at: Math.trunc(n.updatedAt || Date.now()),
  }));

  try {
    const { error } = await client.from(TABLE_STUDY_NOTES).upsert(rows, { onConflict: 'id' });
    if (error) {
      console.error('[Qalam Supabase] Error syncing study_notes to cloud:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Qalam Supabase] Exception syncing study_notes to cloud:', err);
    return false;
  }
}

export async function deleteStudyNoteFromCloud(
  user: Pick<AuthUser, 'id' | 'name' | 'email' | 'role' | 'isGuest'> | string,
  noteId: string
): Promise<StudyNoteCloudResult> {
  const client = getSupabaseClient();
  const userId = typeof user === 'string' ? user : user?.id;
  if (!client || !userId || userId === 'guest-demo') {
    return { ok: false, error: 'Cloud deletion skipped (offline or guest mode).' };
  }

  const resolved = await resolveCloudProfileUserId(client, user, 'study_notes');
  if (!resolved.userId) {
    console.error('[Qalam Supabase] Cannot delete study note:', resolved.error || 'No authenticated user.');
    return { ok: false, error: resolved.error || 'No authenticated user found.' };
  }

  try {
    const { error } = await client
      .from(TABLE_STUDY_NOTES)
      .delete()
      .eq('id', noteId)
      .eq('user_id', resolved.userId);

    if (error) {
      console.error('[Qalam Supabase] Failed to delete note from study_notes:', error);
      return { ok: false, error: error.message || 'Failed to delete note from Supabase.' };
    }
    return { ok: true, userId: resolved.userId };
  } catch (err) {
    console.error('[Qalam Supabase] Exception deleting note from study_notes:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unexpected error deleting note.',
    };
  }
}

// ==============================================================================
// 4. Learning Progress Cloud Operations
// ==============================================================================

export async function fetchUserProgressFromCloud(userId: string): Promise<UserProgressData | null> {
  const client = getSupabaseClient();
  if (!client || !userId || userId === 'guest-demo') return null;

  const authUserId = await getAuthenticatedSupabaseUserId(client);
  if (!authUserId) {
    return null;
  }

  try {
    const { data, error } = await client
      .from(TABLE_USER_PROGRESS)
      .select('*')
      .eq('user_id', authUserId)
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

  // Fetch active Supabase Auth user before syncing; skip cloud upsert if unauthenticated
  // and strictly overwrite user_id with the real Supabase Auth UUID.
  const authUserId = await getAuthenticatedSupabaseUserId(client);
  if (!authUserId) {
    return false;
  }

  try {
    const row = {
      user_id: authUserId,
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
      if (error.code === '23503' || error.message?.includes('user_progress_user_id_fkey')) {
        return false;
      }
      console.warn('[Qalam Supabase] Error saving user progress to cloud:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Qalam Supabase] Exception saving user progress to cloud:', err);
    return false;
  }
}

// ==============================================================================
// 5. Lessons & Daily Curriculum Cloud Operations
// ==============================================================================

const LESSON_SELECT_COLUMNS = 'id, title, content, level, is_public, status, author_id, created_at';

export interface LessonCloudSaveResult {
  ok: boolean;
  lesson?: Lesson;
  userId?: string;
  error?: string;
}

export interface LessonCloudFetchResult {
  ok: boolean;
  lessons: Lesson[];
  resolvedUserId?: string | null;
  error?: string;
}

export function isPrivilegedLessonRole(role?: UserRole | string | null): boolean {
  return role === 'admin' || role === 'moderator';
}

export function resolveLessonPublicFlag(
  authorRole?: UserRole | string | null,
  status: LessonStatus = 'published',
  explicitIsPublic?: boolean
): boolean {
  if (status === 'draft') {
    return false;
  }
  if (isPrivilegedLessonRole(authorRole)) {
    return typeof explicitIsPublic === 'boolean' ? explicitIsPublic : true;
  }
  if (authorRole === 'student') {
    return false;
  }
  return Boolean(explicitIsPublic);
}

export function canUserViewPublishedLesson(
  lesson: Lesson,
  user: AuthUser | null,
  resolvedCloudUserId?: string | null
): boolean {
  if (lesson.status === 'draft') {
    return false;
  }
  if (!lesson.isCustom) {
    return true;
  }
  if (lesson.isPublic === true || isPrivilegedLessonRole(lesson.authorRole)) {
    return true;
  }
  if (user && !user.isGuest && lesson.authorId) {
    if (lesson.authorId === user.id) return true;
    if (resolvedCloudUserId && lesson.authorId === resolvedCloudUserId) return true;
  }
  return false;
}

export function canUserDeleteLesson(
  lesson: Lesson,
  user: AuthUser | null,
  resolvedCloudUserId?: string | null
): boolean {
  if (!lesson.isCustom || !user || user.isGuest) return false;
  if (user.role === 'admin' || user.role === 'moderator') return true;
  if (!lesson.authorId) return false;
  return (
    lesson.authorId === user.id ||
    Boolean(resolvedCloudUserId && lesson.authorId === resolvedCloudUserId)
  );
}

function serializeLessonTitle(lesson: Lesson): string {
  const titleAr = (lesson.titleAr || '').trim();
  const titleEn = (lesson.titleEn || '').trim();
  if (titleAr && titleEn && titleAr !== titleEn) {
    return `${titleAr} | ${titleEn}`;
  }
  return titleAr || titleEn || 'Untitled Lesson';
}

function parseLessonTitle(rawTitle: string): { titleAr: string; titleEn: string } {
  const cleaned = rawTitle.trim();
  if (!cleaned) {
    return { titleAr: 'درس عربي', titleEn: 'Arabic Lesson' };
  }
  const sepIndex = cleaned.indexOf(' | ');
  if (sepIndex !== -1) {
    const left = cleaned.slice(0, sepIndex).trim();
    const right = cleaned.slice(sepIndex + 3).trim();
    return {
      titleAr: left || right || cleaned,
      titleEn: right || left || cleaned,
    };
  }
  return {
    titleAr: cleaned,
    titleEn: cleaned,
  };
}

function serializeLessonContent(lesson: Lesson): string {
  if (lesson.contentType === 'video' || lesson.youtubeUrl || (lesson.transcriptSegments && lesson.transcriptSegments.length > 0)) {
    return JSON.stringify({
      __qalam_v1: true,
      contentType: 'video',
      textAr: lesson.textAr || '',
      youtubeUrl: lesson.youtubeUrl || undefined,
      videoDurationSeconds: lesson.videoDurationSeconds,
      transcriptSegments: Array.isArray(lesson.transcriptSegments)
        ? lesson.transcriptSegments
        : undefined,
      description: lesson.description || undefined,
    });
  }
  return lesson.textAr || '';
}

function estimateReadingMinutes(text: string): number {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil((words || 30) / 35));
}

function parseLessonContent(
  rawContent: string,
  level: ProficiencyLevel
): {
  contentType: 'text' | 'video';
  textAr: string;
  youtubeUrl?: string;
  videoDurationSeconds?: number;
  transcriptSegments?: Lesson['transcriptSegments'];
  description: string;
  readingTimeMinutes: number;
} {
  const trimmed = rawContent.trim();
  if (trimmed.startsWith('{"__qalam_v1":')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        __qalam_v1?: boolean;
        contentType?: string;
        textAr?: string;
        youtubeUrl?: string;
        videoDurationSeconds?: number;
        transcriptSegments?: Lesson['transcriptSegments'];
        description?: string;
      };
      if (parsed && parsed.__qalam_v1) {
        const textAr = typeof parsed.textAr === 'string' ? parsed.textAr : '';
        return {
          contentType: parsed.contentType === 'video' ? 'video' : 'text',
          textAr,
          youtubeUrl: typeof parsed.youtubeUrl === 'string' ? parsed.youtubeUrl : undefined,
          videoDurationSeconds:
            typeof parsed.videoDurationSeconds === 'number'
              ? parsed.videoDurationSeconds
              : undefined,
          transcriptSegments: Array.isArray(parsed.transcriptSegments)
            ? parsed.transcriptSegments
            : undefined,
          description:
            typeof parsed.description === 'string' && parsed.description.trim()
              ? parsed.description.trim()
              : 'YouTube video lesson with Arabic transcript.',
          readingTimeMinutes: estimateReadingMinutes(textAr),
        };
      }
    } catch {
      // Fall back to plain text if JSON parsing fails
    }
  }

  return {
    contentType: 'text',
    textAr: rawContent,
    description: `Curated ${level} Arabic reading passage with interactive word lookup.`,
    readingTimeMinutes: estimateReadingMinutes(rawContent),
  };
}

function parseCreatedAtMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
    const parsedMs = Date.parse(raw);
    if (Number.isFinite(parsedMs)) {
      return parsedMs;
    }
  }
  return Date.now();
}

function toDeterministicUuid(seed: string): string {
  const fnv = (str: string, init: number) => {
    let h = init >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const h1 = fnv(seed, 2166136261);
  const h2 = fnv(`a:${seed}`, 2166136261);
  const h3 = fnv(`b:${seed}`, 2166136261);
  const h4 = fnv(`c:${seed}`, 2166136261);
  const hex = `${h1}${h2}${h3}${h4}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function mapCloudRowToLesson(row: Record<string, unknown>): Lesson {
  const id = String(row.id || '');
  const level: ProficiencyLevel =
    row.level === 'intermediate' || row.level === 'advanced' ? row.level : 'beginner';
  const status: LessonStatus = row.status === 'draft' ? 'draft' : 'published';
  const isPublic = status === 'draft' ? false : Boolean(row.is_public);
  const authorId =
    typeof row.author_id === 'string' && row.author_id.trim() ? row.author_id.trim() : undefined;
  const authorRole: UserRole = isPublic ? 'admin' : 'student';

  const { titleAr, titleEn } = parseLessonTitle(String(row.title || ''));
  const parsedContent = parseLessonContent(String(row.content || ''), level);
  const dailyMatch = id.match(/^daily-(\d{4}-\d{2}-\d{2})-/);

  return {
    id,
    titleEn,
    titleAr,
    level,
    description: parsedContent.description,
    contentType: parsedContent.contentType,
    youtubeUrl: parsedContent.youtubeUrl,
    videoDurationSeconds: parsedContent.videoDurationSeconds,
    transcriptSegments: parsedContent.transcriptSegments,
    readingTimeMinutes: parsedContent.readingTimeMinutes,
    textAr: parsedContent.textAr,
    isCustom: true,
    authorName: dailyMatch ? 'Qalam Curriculum Agent' : isPublic ? 'Instructor' : 'Learner',
    authorId,
    authorRole,
    isPublic,
    status,
    isDailyCurriculum: Boolean(dailyMatch),
    curriculumDate: dailyMatch ? dailyMatch[1] : undefined,
    createdAt: parseCreatedAtMs(row.created_at),
  };
}

export async function fetchLessonsFromCloudDetailed(
  activeUser?: AuthUser | null
): Promise<LessonCloudFetchResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { ok: false, lessons: [], error: 'Supabase is not configured.' };
  }

  let resolvedUserId: string | null = null;
  if (activeUser && !activeUser.isGuest) {
    const resolved = await resolveCloudProfileUserId(client, activeUser, 'lessons_fetch');
    resolvedUserId = resolved.userId;
  }

  try {
    let query = client
      .from(TABLE_LESSONS)
      .select(LESSON_SELECT_COLUMNS)
      .order('created_at', { ascending: false });

    const isPrivileged = Boolean(
      activeUser && !activeUser.isGuest && isPrivilegedLessonRole(activeUser.role)
    );

    if (!activeUser || activeUser.isGuest) {
      query = query.eq('is_public', true).eq('status', 'published');
    } else if (!isPrivileged) {
      const ownerIds = Array.from(
        new Set(
          [activeUser.id, resolvedUserId].filter(
            (v): v is string => Boolean(v && v !== 'guest-demo')
          )
        )
      );
      if (ownerIds.length > 0) {
        const ownerFilters = ownerIds.map((uid) => `author_id.eq.${uid}`).join(',');
        query = query.or(`and(is_public.eq.true,status.eq.published),${ownerFilters}`);
      } else {
        query = query.eq('is_public', true).eq('status', 'published');
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Qalam Supabase] Failed to fetch lessons from lessons table:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return {
        ok: false,
        lessons: [],
        resolvedUserId,
        error: error.message || 'Failed to load lessons from Supabase.',
      };
    }

    if (!Array.isArray(data)) {
      return { ok: true, lessons: [], resolvedUserId };
    }

    const mapped = data.map((row) => mapCloudRowToLesson(row as Record<string, unknown>));
    return { ok: true, lessons: mapped, resolvedUserId };
  } catch (err) {
    console.error('[Qalam Supabase] Exception fetching lessons from lessons table:', err);
    return {
      ok: false,
      lessons: [],
      resolvedUserId,
      error: err instanceof Error ? err.message : 'Unexpected error fetching lessons.',
    };
  }
}

export async function fetchLessonsFromCloud(
  activeUser?: AuthUser | null
): Promise<Lesson[] | null> {
  const result = await fetchLessonsFromCloudDetailed(activeUser);
  if (!result.ok) return null;
  return result.lessons;
}

export async function upsertLessonsBatchToCloud(
  user: CloudUserRef,
  lessons: Lesson[]
): Promise<{ ok: boolean; syncedCount: number; lessons?: Lesson[]; userId?: string; error?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    const cfg = getSupabaseConfigStatus();
    const message = cfg.error || 'Supabase is not configured.';
    console.error('[Qalam Supabase] Cannot save lessons:', message);
    return { ok: false, syncedCount: 0, error: message };
  }
  if (lessons.length === 0) {
    return { ok: true, syncedCount: 0, lessons: [] };
  }

  let resolvedUserId: string | null = null;
  if (user && (typeof user === 'string' || !user.isGuest)) {
    const resolved = await resolveCloudProfileUserId(client, user, 'lessons');
    resolvedUserId = resolved.userId;
  }

  const activeUserRole: UserRole | undefined =
    typeof user === 'object' && user && !user.isGuest ? user.role : undefined;

  const buildRows = (
    useNumericCreatedAt: boolean,
    forceUuidIds: boolean,
    overrideAuthorId?: string | null
  ) =>
    lessons.map((lesson) => {
      const status: LessonStatus = lesson.status === 'draft' ? 'draft' : 'published';
      const effectiveRole: UserRole =
        activeUserRole ??
        lesson.authorRole ??
        (lesson.isDailyCurriculum ? 'admin' : 'student');
      const isPublic = resolveLessonPublicFlag(effectiveRole, status, lesson.isPublic);

      const explicitOwner =
        lesson.authorId &&
        lesson.authorId !== 'guest-demo' &&
        lesson.authorId !== 'system-curriculum-agent'
          ? lesson.authorId
          : null;

      // Always prefer explicit override or resolved Supabase Auth/Profile ID when available
      const authorId =
        overrideAuthorId !== undefined
          ? overrideAuthorId
          : resolvedUserId || explicitOwner || null;
      const createdAtMs = Math.trunc(lesson.createdAt || Date.now());
      const rowId = forceUuidIds
        ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lesson.id)
          ? lesson.id
          : toDeterministicUuid(lesson.id)
        : lesson.id;

      return {
        id: rowId,
        title: serializeLessonTitle(lesson),
        content: serializeLessonContent(lesson),
        level: lesson.level,
        is_public: isPublic,
        status,
        author_id: authorId,
        created_at: useNumericCreatedAt ? createdAtMs : new Date(createdAtMs).toISOString(),
      };
    });

  const attemptUpsert = async (
    useNumericCreatedAt: boolean,
    forceUuidIds: boolean,
    overrideAuthorId?: string | null
  ) => {
    const rows = buildRows(useNumericCreatedAt, forceUuidIds, overrideAuthorId);
    return client
      .from(TABLE_LESSONS)
      .upsert(rows, { onConflict: 'id' })
      .select(LESSON_SELECT_COLUMNS);
  };

  try {
    let useNumericCreatedAt = false;
    let forceUuidIds = false;
    let { data, error } = await attemptUpsert(useNumericCreatedAt, forceUuidIds);

    // Retry transparently if Supabase table uses BIGINT created_at and/or UUID id
    for (let attempt = 0; attempt < 2 && error && error.code === '22P02'; attempt++) {
      const msg = (error.message || '').toLowerCase();
      let retried = false;
      if (!useNumericCreatedAt && (msg.includes('bigint') || msg.includes('integer'))) {
        useNumericCreatedAt = true;
        retried = true;
      }
      if (!forceUuidIds && msg.includes('uuid')) {
        forceUuidIds = true;
        retried = true;
      }
      if (!retried) break;
      ({ data, error } = await attemptUpsert(useNumericCreatedAt, forceUuidIds));
    }

    // Fallback when RLS (42501) blocks direct anon write: try server service-role proxy, then anonymous Supabase Auth
    if (error && error.code === '42501') {
      try {
        const proxyRows = buildRows(useNumericCreatedAt, forceUuidIds);
        const proxyResp = await fetch('/api/lessons/cloud-upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: proxyRows }),
        });
        if (proxyResp.ok) {
          const proxyJson = (await proxyResp.json().catch(() => null)) as {
            ok?: boolean;
            data?: Array<Record<string, unknown>>;
          } | null;
          if (proxyJson?.ok) {
            const savedLessons = Array.isArray(proxyJson.data)
              ? proxyJson.data.map((row) => mapCloudRowToLesson(row))
              : undefined;
            return {
              ok: true,
              syncedCount: savedLessons?.length ?? lessons.length,
              lessons: savedLessons,
              userId: resolvedUserId || undefined,
            };
          }
        }
      } catch {
        // Server proxy unavailable or unconfigured; continue to auth fallback
      }

      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session) {
          const { data: anonData, error: anonError } = await client.auth.signInAnonymously();
          if (!anonError && anonData?.user?.id) {
            ({ data, error } = await attemptUpsert(useNumericCreatedAt, forceUuidIds));
            if (error && error.code === '42501') {
              ({ data, error } = await attemptUpsert(
                useNumericCreatedAt,
                forceUuidIds,
                anonData.user.id
              ));
            }
          }
        }
      } catch {
        // Anonymous auth not enabled on Supabase project
      }
    }

    if (error) {
      const isRlsBlocked = error.code === '42501';
      const friendlyError = isRlsBlocked
        ? 'Supabase RLS policy blocked writing to "lessons" (code 42501). Run the lessons RLS SQL policy in Supabase SQL Editor (Admin → Diagnostics → Supabase SQL Schema → Copy lessons RLS Fix).'
        : error.message || 'Failed to save lesson to Supabase.';

      console.error('[Qalam Supabase] Failed to save lesson(s) to lessons table:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        authorId: resolvedUserId,
        lessonIds: lessons.map((l) => l.id),
      });
      return {
        ok: false,
        syncedCount: 0,
        userId: resolvedUserId || undefined,
        error: friendlyError,
      };
    }

    const savedLessons = Array.isArray(data)
      ? data.map((row) => mapCloudRowToLesson(row as Record<string, unknown>))
      : undefined;

    return {
      ok: true,
      syncedCount: savedLessons?.length ?? lessons.length,
      lessons: savedLessons,
      userId: resolvedUserId || undefined,
    };
  } catch (err) {
    console.error('[Qalam Supabase] Exception saving lesson(s) to lessons table:', err);
    return {
      ok: false,
      syncedCount: 0,
      userId: resolvedUserId || undefined,
      error: err instanceof Error ? err.message : 'Unexpected error saving lessons to Supabase.',
    };
  }
}

export async function upsertLessonToCloudWithResult(
  user: CloudUserRef,
  lesson: Lesson
): Promise<LessonCloudSaveResult> {
  const res = await upsertLessonsBatchToCloud(user, [lesson]);
  return {
    ok: res.ok,
    lesson: res.lessons?.[0],
    userId: res.userId,
    error: res.error,
  };
}

export async function upsertLessonToCloud(
  user: CloudUserRef,
  lesson: Lesson
): Promise<boolean> {
  const res = await upsertLessonsBatchToCloud(user, [lesson]);
  return res.ok;
}

export async function deleteLessonFromCloudWithResult(
  lessonId: string
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client || !lessonId) {
    return { ok: false, error: 'Supabase is not configured.' };
  }

  try {
    let { error } = await client.from(TABLE_LESSONS).delete().eq('id', lessonId);
    if (error && error.code === '42501') {
      try {
        const proxyResp = await fetch('/api/lessons/cloud-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId }),
        });
        if (proxyResp.ok) {
          const proxyJson = (await proxyResp.json().catch(() => null)) as { ok?: boolean } | null;
          if (proxyJson?.ok) {
            return { ok: true };
          }
        }
      } catch {
        // Continue to anonymous auth check
      }

      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session) {
          const { data: anonData, error: anonError } = await client.auth.signInAnonymously();
          if (!anonError && anonData?.user?.id) {
            ({ error } = await client.from(TABLE_LESSONS).delete().eq('id', lessonId));
          }
        }
      } catch {
        // Ignore
      }
    }

    if (error) {
      console.error('[Qalam Supabase] Failed to delete lesson from lessons table:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        lessonId,
      });
      return {
        ok: false,
        error:
          error.code === '42501'
            ? 'Supabase RLS policy blocked deleting from "lessons" (42501). Run the lessons RLS SQL policy in Admin → Diagnostics → Supabase SQL Schema.'
            : error.message || 'Failed to delete lesson from Supabase.',
      };
    }
    return { ok: true };
  } catch (err) {
    console.error('[Qalam Supabase] Exception deleting lesson from lessons table:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unexpected error deleting lesson.',
    };
  }
}

export async function deleteLessonFromCloud(lessonId: string): Promise<boolean> {
  const res = await deleteLessonFromCloudWithResult(lessonId);
  return res.ok;
}
