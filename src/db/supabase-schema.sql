-- ==============================================================================
-- Qalam (قَلَم) Arabic Learning App — Supabase Database Schema & RLS Policies
-- ==============================================================================
-- Instructions:
-- 1. Open your Supabase Project Dashboard -> SQL Editor -> New Query.
-- 2. Paste this entire SQL file and click "Run" (Execute).
-- 3. In your applet .env (or environment configuration), set:
--    VITE_SUPABASE_URL="https://your-project.supabase.co"
--    VITE_SUPABASE_ANON_KEY="your-anon-public-key"
-- ==============================================================================

-- 1. Enable standard UUID and pgcrypto extensions if not already present
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. Table: profiles (User accounts & roles)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'moderator', 'admin')),
  is_primary_owner BOOLEAN NOT NULL DEFAULT FALSE,
  salt TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for instant email lookups
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(LOWER(email));

-- ==============================================================================
-- 3. Strict Primary Owner Protection Triggers for apooood@gmail.com
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.protect_primary_owner_admin()
RETURNS TRIGGER AS $$
BEGIN
  -- Normalize email to lowercase
  NEW.email := LOWER(TRIM(NEW.email));

  -- If this is the Primary Owner, permanently lock role to 'admin' and is_primary_owner to TRUE
  IF NEW.email = 'apooood@gmail.com' THEN
    NEW.role := 'admin';
    NEW.is_primary_owner := TRUE;
  END IF;

  -- Block any attempt to downgrade role or unset is_primary_owner for apooood@gmail.com
  IF TG_OP = 'UPDATE' THEN
    IF OLD.email = 'apooood@gmail.com' AND (NEW.role != 'admin' OR NEW.is_primary_owner IS NOT TRUE) THEN
      RAISE EXCEPTION 'The Primary Owner Admin (apooood@gmail.com) is permanently protected and cannot be modified or downgraded.';
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_primary_owner_admin ON public.profiles;
CREATE TRIGGER trg_protect_primary_owner_admin
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_primary_owner_admin();

-- Block deletion of the Primary Owner Admin
CREATE OR REPLACE FUNCTION public.prevent_delete_primary_owner()
RETURNS TRIGGER AS $$
BEGIN
  IF LOWER(TRIM(OLD.email)) = 'apooood@gmail.com' THEN
    RAISE EXCEPTION 'The Primary Owner account (apooood@gmail.com) cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_delete_primary_owner ON public.profiles;
CREATE TRIGGER trg_prevent_delete_primary_owner
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_delete_primary_owner();

-- Seed Primary Owner Admin account if not already present
INSERT INTO public.profiles (id, name, email, role, is_primary_owner, created_at, updated_at)
VALUES (
  'usr_owner_apooood',
  'Primary Owner',
  'apooood@gmail.com',
  'admin',
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO UPDATE SET
  role = 'admin',
  is_primary_owner = TRUE,
  updated_at = NOW();

-- ==============================================================================
-- 4. Table: vocabulary_cards (User flashcards & SRS status)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.vocabulary_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  word_with_tashkeel TEXT NOT NULL,
  vocalized_word TEXT,
  normalized_key TEXT NOT NULL,
  english_meaning TEXT NOT NULL,
  transliteration TEXT DEFAULT '',
  part_of_speech TEXT DEFAULT 'Noun',
  word_type TEXT,
  root TEXT,
  level TEXT DEFAULT 'beginner',
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'learned')),
  srs_rating TEXT CHECK (srs_rating IN ('hard', 'good', 'easy')),
  examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  has_custom_edits BOOLEAN DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  last_reviewed_at BIGINT,
  next_review_at BIGINT,
  interval_days INTEGER DEFAULT 1,
  review_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vocab_cards_user_id ON public.vocabulary_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_vocab_cards_status ON public.vocabulary_cards(user_id, status);

-- ==============================================================================
-- 5. Table: study_notes (User study notes)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.study_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  context JSONB,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_notes_user_id ON public.study_notes(user_id);

-- ==============================================================================
-- 6. Table: user_progress (Streaks, level, reading history, daily logs & goals)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_progress (
  user_id TEXT PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  selected_level TEXT NOT NULL DEFAULT 'beginner',
  reading_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  study_streak JSONB NOT NULL DEFAULT '{"count": 0, "lastActivityDate": null}'::jsonb,
  daily_logs JSONB NOT NULL DEFAULT '{}'::jsonb,
  daily_word_goal INTEGER NOT NULL DEFAULT 5,
  reader_preferences JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 7. Row Level Security (RLS) Configuration
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;

-- Helper to safely get the current request user identifier
-- Supports both Supabase Auth JWT (auth.uid()) and custom client headers
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS TEXT AS $$
BEGIN
  -- 1. Check Supabase auth.uid() if logged in via Supabase Auth
  IF auth.uid() IS NOT NULL THEN
    RETURN auth.uid()::text;
  END IF;

  -- 2. Check custom x-user-id header if set in request
  BEGIN
    RETURN current_setting('request.headers', true)::jsonb->>'x-user-id';
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper to check if the current requester is an admin
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN AS $$
DECLARE
  v_uid TEXT;
  v_role TEXT;
BEGIN
  v_uid := public.current_app_user_id();
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid LIMIT 1;
  RETURN v_role = 'admin';
END;
$$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------------------------
-- RLS Policies: profiles
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow user to read own profile or admin to read all" ON public.profiles;
CREATE POLICY "Allow user to read own profile or admin to read all"
ON public.profiles FOR SELECT
USING (
  id = public.current_app_user_id()
  OR public.is_admin_user()
  OR LOWER(email) = 'apooood@gmail.com'
  -- Allow anon to lookup by email during login/registration
  OR auth.role() = 'anon'
);

DROP POLICY IF EXISTS "Allow registration of new profiles" ON public.profiles;
CREATE POLICY "Allow registration of new profiles"
ON public.profiles FOR INSERT
WITH CHECK (
  -- Newly inserted profiles default to non-owner student role unless apooood@gmail.com
  (LOWER(email) = 'apooood@gmail.com' AND role = 'admin')
  OR (LOWER(email) != 'apooood@gmail.com' AND is_primary_owner = FALSE)
);

DROP POLICY IF EXISTS "Allow user to update own profile or admin to update roles" ON public.profiles;
CREATE POLICY "Allow user to update own profile or admin to update roles"
ON public.profiles FOR UPDATE
USING (
  id = public.current_app_user_id()
  OR public.is_admin_user()
  OR auth.role() = 'anon'
)
WITH CHECK (
  -- Can never change Primary Owner away from admin
  (OLD.email = 'apooood@gmail.com' AND NEW.role = 'admin')
  OR (OLD.email != 'apooood@gmail.com')
);

DROP POLICY IF EXISTS "Allow admin to delete non-owner profiles" ON public.profiles;
CREATE POLICY "Allow admin to delete non-owner profiles"
ON public.profiles FOR DELETE
USING (
  LOWER(email) != 'apooood@gmail.com'
  AND (id = public.current_app_user_id() OR public.is_admin_user() OR auth.role() = 'anon')
);

-- ------------------------------------------------------------------------------
-- RLS Policies: vocabulary_cards
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own vocabulary cards" ON public.vocabulary_cards;
CREATE POLICY "Users can manage own vocabulary cards"
ON public.vocabulary_cards FOR ALL
USING (
  user_id = public.current_app_user_id()
  OR public.is_admin_user()
  OR auth.role() = 'anon'
)
WITH CHECK (
  user_id = public.current_app_user_id()
  OR public.is_admin_user()
  OR auth.role() = 'anon'
);

-- ------------------------------------------------------------------------------
-- RLS Policies: study_notes
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own study notes" ON public.study_notes;
CREATE POLICY "Users can manage own study notes"
ON public.study_notes FOR ALL
USING (
  user_id = public.current_app_user_id()
  OR public.is_admin_user()
  OR auth.role() = 'anon'
)
WITH CHECK (
  user_id = public.current_app_user_id()
  OR public.is_admin_user()
  OR auth.role() = 'anon'
);

-- ------------------------------------------------------------------------------
-- RLS Policies: user_progress
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage own progress" ON public.user_progress;
CREATE POLICY "Users can manage own progress"
ON public.user_progress FOR ALL
USING (
  user_id = public.current_app_user_id()
  OR public.is_admin_user()
  OR auth.role() = 'anon'
)
WITH CHECK (
  user_id = public.current_app_user_id()
  OR public.is_admin_user()
  OR auth.role() = 'anon'
);

-- ==============================================================================
-- Schema setup complete. All tables and RLS policies are active.
-- ==============================================================================
