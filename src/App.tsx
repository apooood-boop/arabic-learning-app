import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  Clock,
  Compass,
  Crown,
  Flame,
  GraduationCap,
  Layers,
  LogIn,
  NotebookPen,
  Plus,
  Sprout,
  Trash2,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import { AddLessonModal } from './components/AddLessonModal';
import { AuthModal } from './components/AuthModal';
import { ConversationView } from './components/ConversationView';
import { ExamsView } from './components/ExamsView';
import { LandingPage } from './components/LandingPage';
import { LessonReader } from './components/LessonReader';
import { Navbar } from './components/Navbar';
import { NotesDrawer } from './components/NotesDrawer';
import { PracticeScope } from './components/PracticeMode';
import { ReadingHistoryView } from './components/ReadingHistoryView';
import { UserManagementModal } from './components/UserManagementModal';
import { VocabularyView } from './components/VocabularyView';
import { DailyStudyLog, WeeklyVocabChart } from './components/WeeklyVocabChart';
import { ActiveWordSelection, WordContextMenu } from './components/WordContextMenu';
import { buildResilientWordAnalysis, lookupFallbackWord } from './data/fallbackLexicon';
import { SAMPLE_LESSONS } from './data/lessons';
import { useLocalStorage } from './hooks/useLocalStorage';
import {
  ActiveTab,
  AuthUser,
  Lesson,
  NoteContextTag,
  PracticeStatus,
  ProficiencyLevel,
  ReaderPreferences,
  ReadingHistoryItem,
  SrsRating,
  StudyNote,
  StudyStreak,
  VocabCard,
  WordAnalysis,
} from './types/arabic';
import { getActiveUser, isAdminUser, logoutUser } from './utils/auth';
import { isSupabaseConfigured } from './utils/supabaseClient';
import {
  fetchStudyNotesFromCloud,
  fetchUserProgressFromCloud,
  fetchVocabCardsFromCloud,
  upsertStudyNotesToCloud,
  upsertUserProgressToCloud,
  upsertVocabCardsToCloud,
} from './utils/supabaseSync';
import {
  applySmartPartialTashkeel,
  countArabicWords,
  getArabicFontClass,
  invalidateCachedArabicAudio,
  LEVEL_LABELS,
  normalizeArabicWord,
  normalizeStandaloneArabicKey,
  normalizeStandaloneVocabWord,
  stripFinalIrabForSpeech,
  stripTashkeel,
} from './utils/arabic';
import {
  analyzeArabicWordClient,
  isFakePlaceholderTranslation,
} from './utils/geminiClient';

const DEFAULT_PREFERENCES: ReaderPreferences = {
  showTashkeel: true,
  fontSize: 32,
  fontStyle: 'scheherazade',
  speechRate: 0.92,
};

function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayDateKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateKey(d);
}

const STARTER_VOCAB_CARDS: VocabCard[] = [
  {
    id: 'starter-qahwa',
    normalizedKey: normalizeArabicWord('القهوةُ'),
    word: 'القهوةُ',
    wordWithTashkeel: 'القهوةُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-qahwa',
    englishMeaning: 'the coffee',
    examples: [
      {
        arabic: 'رائحةُ القهوةِ العربيّةِ تملأُ أرجاءَ المطبخِ.',
        english: 'The aroma of Arabic coffee fills the corners of the kitchen.',
      },
      {
        arabic: 'يجتمعُ الأصدقاءُ لشربِ القهوةِ وتبادلِ الأخبارِ.',
        english: 'Friends gather to drink coffee and exchange news.',
      },
    ],
    lessonId: 'beg-morning-market',
    lessonTitle: 'A Morning in the Old Market',
    level: 'beginner',
    status: 'needs_review',
    createdAt: 1700000000001,
    source: 'lexicon',
  },
  {
    id: 'starter-hikma',
    normalizedKey: normalizeArabicWord('الحكمةُ'),
    word: 'الحكمةُ',
    wordWithTashkeel: 'الحكمةُ',
    partOfSpeech: 'Noun',
    transliteration: 'al-ḥikma',
    englishMeaning: 'wisdom',
    examples: [
      {
        arabic: 'تأتي الحكمةُ منَ التّأمّلِ والتّجاربِ الطّويلةِ.',
        english: 'Wisdom comes from reflection and long experiences.',
      },
      {
        arabic: 'سمّيتْ دارُ العلمِ في بغدادَ ببيْتِ الحكمةِ.',
        english: 'The center of learning in Baghdad was named the House of Wisdom.',
      },
    ],
    lessonId: 'int-house-of-wisdom',
    lessonTitle: 'The House of Wisdom in Baghdad',
    level: 'intermediate',
    status: 'needs_review',
    createdAt: 1700000000002,
    source: 'lexicon',
  },
  {
    id: 'starter-saada',
    normalizedKey: normalizeArabicWord('السّعادةُ'),
    word: 'السّعادةُ',
    wordWithTashkeel: 'السّعادةُ',
    partOfSpeech: 'Noun',
    transliteration: 'as-saʿāda',
    englishMeaning: 'happiness',
    examples: [
      {
        arabic: 'تكمنُ السّعادةُ الحقيقيّةُ في القناعةِ والعطاءِ.',
        english: 'True happiness lies in contentment and generosity.',
      },
      {
        arabic: 'شعرتِ الطّالبةُ بالسّعادةِ عندَ استلامِ شهادتِها.',
        english: 'The student felt happiness upon receiving her certificate.',
      },
    ],
    lessonId: 'beg-family-garden',
    lessonTitle: 'Our Family Garden',
    level: 'beginner',
    status: 'learned',
    createdAt: 1700000000003,
    source: 'lexicon',
  },
];

function migrateLegacyGuestStorage() {
  if (typeof window === 'undefined') return;
  try {
    const pairs: Array<[string, string]> = [
      ['qalam_vocab_cards', 'qalam_vocab_cards_v2::guest-demo'],
      ['qalam_study_streak', 'qalam_study_streak_v2::guest-demo'],
      ['qalam_daily_study_logs', 'qalam_daily_study_logs_v2::guest-demo'],
      ['qalam_selected_level', 'qalam_selected_level_v2::guest-demo'],
      ['qalam_reading_history', 'qalam_reading_history_v2::guest-demo'],
    ];
    for (const [legacyKey, nextKey] of pairs) {
      const legacyVal = window.localStorage.getItem(legacyKey);
      if (legacyVal && !window.localStorage.getItem(nextKey)) {
        window.localStorage.setItem(nextKey, legacyVal);
      }
    }
  } catch {
    // Ignore storage errors
  }
}

migrateLegacyGuestStorage();

function migrateGuestDataToAccount(targetUserId: string) {
  if (typeof window === 'undefined' || !targetUserId || targetUserId === 'guest-demo') return;
  try {
    const prefixes = [
      'qalam_vocab_cards_v2',
      'qalam_reading_history_v2',
      'qalam_study_streak_v2',
      'qalam_daily_study_logs_v2',
      'qalam_daily_goal_v2',
      'qalam_study_notes_v2',
      'qalam_selected_level_v2',
    ];
    for (const prefix of prefixes) {
      const guestVal = window.localStorage.getItem(`${prefix}::guest-demo`);
      const targetKey = `${prefix}::${targetUserId}`;
      const existingTarget = window.localStorage.getItem(targetKey);
      const isTargetEmpty =
        existingTarget === null || existingTarget === '[]' || existingTarget === '{}';
      if (guestVal && guestVal !== '[]' && guestVal !== '{}' && isTargetEmpty) {
        window.localStorage.setItem(targetKey, guestVal);
      }
    }
  } catch {
    // Ignore storage errors
  }
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => getActiveUser());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  const sessionScope = currentUser ? currentUser.id : 'guest-demo';

  const [activeTab, setActiveTab] = useState<ActiveTab>('lessons');
  const [activeNavSection, setActiveNavSection] = useState<
    'home' | 'history' | 'levels' | 'vocabulary' | 'exams' | 'conversation'
  >('home');
  const [activeHeroSwitch, setActiveHeroSwitch] = useState<
    'levels' | 'practice' | 'notes' | 'addText' | null
  >(null);
  const [selectedLevel, setSelectedLevel] = useLocalStorage<ProficiencyLevel>(
    `qalam_selected_level_v2::${sessionScope}`,
    'beginner'
  );
  const [customLessons, setCustomLessons] = useLocalStorage<Lesson[]>(
    'qalam_custom_lessons',
    []
  );
  const [vocabCards, setVocabCards] = useLocalStorage<VocabCard[]>(
    `qalam_vocab_cards_v2::${sessionScope}`,
    STARTER_VOCAB_CARDS
  );
  const [readingHistory, setReadingHistory] = useLocalStorage<ReadingHistoryItem[]>(
    `qalam_reading_history_v2::${sessionScope}`,
    []
  );
  const [preferences, setPreferences] = useLocalStorage<ReaderPreferences>(
    'qalam_reader_prefs',
    DEFAULT_PREFERENCES
  );
  // Persistent localStorage translation cache for 0ms repeat lookups
  const [analysisCache, setAnalysisCache] = useLocalStorage<Record<string, WordAnalysis>>(
    'qalam_word_cache_v2',
    {}
  );
  // Daily study streak persisted per user session
  const [studyStreak, setStudyStreak] = useLocalStorage<StudyStreak>(
    `qalam_study_streak_v2::${sessionScope}`,
    { count: 0, lastActivityDate: null }
  );
  // Daily vocabulary learning logs for weekly progress chart per user session
  const [dailyLogs, setDailyLogs] = useLocalStorage<Record<string, DailyStudyLog>>(
    `qalam_daily_study_logs_v2::${sessionScope}`,
    {}
  );
  // Daily word target for My Daily Goal module per user session
  const [dailyWordGoal, setDailyWordGoal] = useLocalStorage<number>(
    `qalam_daily_goal_v2::${sessionScope}`,
    5
  );
  const [studyNotes, setStudyNotes] = useLocalStorage<StudyNote[]>(
    `qalam_study_notes_v2::${sessionScope}`,
    []
  );

  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [practiceScopeRequest, setPracticeScopeRequest] = useState<{
    scope: PracticeScope;
    seq: number;
  }>({ scope: 'all', seq: 0 });
  const [isAddLessonOpen, setIsAddLessonOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
  const [notesContext, setNotesContext] = useState<NoteContextTag | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [audioToast, setAudioToast] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<{
    lessonId: string;
    title: string;
    levelEn: string;
    levelAr: string;
  } | null>(null);

  // Word Context Menu State
  const [wordSelection, setWordSelection] = useState<ActiveWordSelection | null>(null);
  const [popoverMode, setPopoverMode] = useState<'menu' | 'translation'>('menu');
  const [wordAnalysis, setWordAnalysis] = useState<WordAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [savingVocab, setSavingVocab] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // In-flight deduplication map for background prefetching
  const inFlightRequests = useRef<Map<string, Promise<WordAnalysis>>>(new Map());
  const levelsSectionRef = useRef<HTMLElement | null>(null);
  const audioToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleTtsNotice = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>;
      if (custom.detail?.message) {
        setAudioToast(custom.detail.message);
        if (audioToastTimerRef.current !== null) {
          window.clearTimeout(audioToastTimerRef.current);
        }
        audioToastTimerRef.current = window.setTimeout(() => {
          setAudioToast(null);
          audioToastTimerRef.current = null;
        }, 5500);
      }
    };
    const handleQuotaNotice = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string }>;
      if (custom.detail?.message) {
        setApiNotice(custom.detail.message);
      }
    };

    window.addEventListener('qalam:tts-notice', handleTtsNotice);
    window.addEventListener('qalam:quota-notice', handleQuotaNotice);
    return () => {
      window.removeEventListener('qalam:tts-notice', handleTtsNotice);
      window.removeEventListener('qalam:quota-notice', handleQuotaNotice);
      if (audioToastTimerRef.current !== null) {
        window.clearTimeout(audioToastTimerRef.current);
      }
    };
  }, []);

  // Bi-directional Supabase Cloud Data Sync for authenticated users
  useEffect(() => {
    if (!currentUser || currentUser.isGuest || !isSupabaseConfigured()) return;
    const userId = currentUser.id;
    let isMounted = true;

    async function loadInitialCloudData() {
      try {
        const [cloudCards, cloudNotes, cloudProgress] = await Promise.all([
          fetchVocabCardsFromCloud(userId),
          fetchStudyNotesFromCloud(userId),
          fetchUserProgressFromCloud(userId),
        ]);

        if (!isMounted) return;

        if (cloudCards && cloudCards.length > 0) {
          setVocabCards((local) => {
            const map = new Map<string, VocabCard>();
            for (const c of cloudCards) map.set(c.id, c);
            for (const c of local) {
              if (!map.has(c.id)) {
                map.set(c.id, c);
              }
            }
            const merged = Array.from(map.values());
            void upsertVocabCardsToCloud(userId, merged);
            return merged;
          });
        } else if (vocabCards.length > 0) {
          void upsertVocabCardsToCloud(userId, vocabCards);
        }

        if (cloudNotes && cloudNotes.length > 0) {
          setStudyNotes((local) => {
            const map = new Map<string, StudyNote>();
            for (const n of cloudNotes) map.set(n.id, n);
            for (const n of local) {
              if (!map.has(n.id)) {
                map.set(n.id, n);
              }
            }
            const merged = Array.from(map.values());
            void upsertStudyNotesToCloud(userId, merged);
            return merged;
          });
        } else if (studyNotes.length > 0) {
          void upsertStudyNotesToCloud(userId, studyNotes);
        }

        if (cloudProgress) {
          if (cloudProgress.selectedLevel) setSelectedLevel(cloudProgress.selectedLevel);
          if (cloudProgress.readingHistory && cloudProgress.readingHistory.length > 0) {
            setReadingHistory(cloudProgress.readingHistory);
          }
          if (cloudProgress.studyStreak) setStudyStreak(cloudProgress.studyStreak);
          if (cloudProgress.dailyLogs && Object.keys(cloudProgress.dailyLogs).length > 0) {
            setDailyLogs(cloudProgress.dailyLogs);
          }
          if (typeof cloudProgress.dailyWordGoal === 'number') {
            setDailyWordGoal(cloudProgress.dailyWordGoal);
          }
          if (cloudProgress.readerPreferences) setPreferences(cloudProgress.readerPreferences);
        } else {
          void upsertUserProgressToCloud(userId, {
            selectedLevel,
            readingHistory,
            studyStreak,
            dailyLogs,
            dailyWordGoal,
            readerPreferences: preferences,
          });
        }
      } catch (err) {
        console.warn('[Qalam Supabase] Initial cloud load error:', err);
      }
    }

    void loadInitialCloudData();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.id]);

  // Cloud auto-sync when cards change
  const prevCardsRef = useRef(vocabCards);
  useEffect(() => {
    if (!currentUser || currentUser.isGuest || !isSupabaseConfigured()) return;
    if (prevCardsRef.current !== vocabCards) {
      prevCardsRef.current = vocabCards;
      const timer = window.setTimeout(() => {
        void upsertVocabCardsToCloud(currentUser.id, vocabCards);
      }, 700);
      return () => window.clearTimeout(timer);
    }
  }, [vocabCards, currentUser?.id]);

  // Cloud auto-sync when notes change
  const prevNotesRef = useRef(studyNotes);
  useEffect(() => {
    if (!currentUser || currentUser.isGuest || !isSupabaseConfigured()) return;
    if (prevNotesRef.current !== studyNotes) {
      prevNotesRef.current = studyNotes;
      const timer = window.setTimeout(() => {
        void upsertStudyNotesToCloud(currentUser.id, studyNotes);
      }, 700);
      return () => window.clearTimeout(timer);
    }
  }, [studyNotes, currentUser?.id]);

  // Cloud auto-sync when learning progress changes
  useEffect(() => {
    if (!currentUser || currentUser.isGuest || !isSupabaseConfigured()) return;
    const timer = window.setTimeout(() => {
      void upsertUserProgressToCloud(currentUser.id, {
        selectedLevel,
        readingHistory,
        studyStreak,
        dailyLogs,
        dailyWordGoal,
        readerPreferences: preferences,
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    selectedLevel,
    readingHistory,
    studyStreak,
    dailyLogs,
    dailyWordGoal,
    preferences,
    currentUser?.id,
  ]);

  // Role/Auth Access Control: only signed-in non-guest users can add/manage custom content
  const canAddContent = Boolean(currentUser && !currentUser.isGuest);

  const allLessons = useMemo(
    () => (canAddContent ? [...customLessons, ...SAMPLE_LESSONS] : SAMPLE_LESSONS),
    [canAddContent, customLessons]
  );

  const filteredLessons = useMemo(
    () => allLessons.filter((lesson) => lesson.level === selectedLevel),
    [allLessons, selectedLevel]
  );

  const activeLesson = useMemo(
    () => allLessons.find((l) => l.id === activeLessonId) ?? null,
    [allLessons, activeLessonId]
  );

  const vocabStatusMap = useMemo(() => {
    const map = new Map<string, VocabCard['status']>();
    for (const card of vocabCards) {
      map.set(card.normalizedKey, card.status);
      const wordKey = normalizeArabicWord(card.word);
      const tashkeelKey = normalizeArabicWord(card.wordWithTashkeel);
      const standaloneKey = normalizeStandaloneArabicKey(card.wordWithTashkeel);
      if (wordKey) map.set(wordKey, card.status);
      if (tashkeelKey) map.set(tashkeelKey, card.status);
      if (standaloneKey) map.set(standaloneKey, card.status);
    }
    return map;
  }, [vocabCards]);

  const learnedCount = useMemo(
    () => vocabCards.filter((c) => c.status === 'learned').length,
    [vocabCards]
  );
  const difficultCount = useMemo(
    () => vocabCards.filter((c) => c.srsRating === 'hard').length,
    [vocabCards]
  );
  const reviewCount = vocabCards.length - learnedCount;

  const todayKey = getLocalDateKey();
  const yesterdayKey = getYesterdayDateKey();

  const effectiveStreakCount = useMemo(() => {
    if (!studyStreak.lastActivityDate) return 0;
    if (
      studyStreak.lastActivityDate === todayKey ||
      studyStreak.lastActivityDate === yesterdayKey
    ) {
      return studyStreak.count;
    }
    return 0;
  }, [studyStreak, todayKey, yesterdayKey]);

  const studiedToday = studyStreak.lastActivityDate === todayKey && effectiveStreakCount > 0;

  const recordStudyActivity = useCallback(
    (actionType?: 'added' | 'reviewed' | 'translated') => {
      const today = getLocalDateKey();
      const yesterday = getYesterdayDateKey();
      setStudyStreak((prev) => {
        if (prev.lastActivityDate === today) {
          return prev.count > 0 ? prev : { count: 1, lastActivityDate: today };
        }
        if (prev.lastActivityDate === yesterday) {
          return { count: prev.count + 1, lastActivityDate: today };
        }
        return { count: 1, lastActivityDate: today };
      });

      if (actionType) {
        setDailyLogs((prev) => {
          const current = prev[today] ?? { added: 0, reviewed: 0, translated: 0 };
          return {
            ...prev,
            [today]: {
              ...current,
              [actionType]: current[actionType] + 1,
            },
          };
        });
      }
    },
    [setStudyStreak, setDailyLogs]
  );

  const levelInfo = LEVEL_LABELS[selectedLevel];

  const handleSelectLevel = (level: ProficiencyLevel) => {
    setSelectedLevel(level);
    setActiveLessonId(null);
    setWordSelection(null);
  };

  const handleSelectTab = (tab: ActiveTab) => {
    if (tab === 'vocabulary') {
      setPracticeScopeRequest((prev) => ({ scope: 'all', seq: prev.seq + 1 }));
    }
    if (tab === 'lessons') {
      setActiveLessonId(null);
    }
    setActiveTab(tab);
    setActiveNavSection(tab === 'lessons' ? 'home' : tab);
    setWordSelection(null);
  };

  const handleOpenDifficultPractice = () => {
    setActiveHeroSwitch('practice');
    setPracticeScopeRequest((prev) => ({ scope: 'hard', seq: prev.seq + 1 }));
    setActiveTab('vocabulary');
    setActiveNavSection('vocabulary');
    setWordSelection(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectHome = () => {
    setActiveHeroSwitch(null);
    setActiveTab('lessons');
    setActiveNavSection('home');
    setActiveLessonId(null);
    setWordSelection(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectLevelsNav = () => {
    setActiveHeroSwitch('levels');
    setActiveTab('lessons');
    setActiveNavSection('levels');
    setActiveLessonId(null);
    setWordSelection(null);
    window.requestAnimationFrame(() => {
      levelsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleUpdateReadingHistory = useCallback(
    (item: Partial<ReadingHistoryItem> & { lessonId: string }) => {
      setReadingHistory((prev) => {
        const existingIndex = prev.findIndex((h) => h.lessonId === item.lessonId);
        const targetLesson = allLessons.find((l) => l.id === item.lessonId);
        const now = Date.now();

        if (existingIndex >= 0) {
          const existing = prev[existingIndex];
          const updated: ReadingHistoryItem = {
            ...existing,
            ...item,
            titleEn: item.titleEn || existing.titleEn || targetLesson?.titleEn || 'Lesson',
            titleAr: item.titleAr || existing.titleAr || targetLesson?.titleAr || '',
            level: item.level || existing.level || targetLesson?.level || 'beginner',
            lastReadAt: Math.max(existing.lastReadAt, item.lastReadAt ?? now),
            progressPercent: Math.max(existing.progressPercent, item.progressPercent ?? 0),
            wordsInteracted: Math.max(existing.wordsInteracted, item.wordsInteracted ?? 0),
            totalWords: item.totalWords || existing.totalWords || 1,
            audioListened: Boolean(existing.audioListened || item.audioListened),
            quizCompleted: Boolean(existing.quizCompleted || item.quizCompleted),
            quizScore: item.quizScore ?? existing.quizScore,
          };
          const next = [...prev];
          next.splice(existingIndex, 1);
          return [updated, ...next];
        }

        const newItem: ReadingHistoryItem = {
          lessonId: item.lessonId,
          titleEn: item.titleEn || targetLesson?.titleEn || 'Lesson',
          titleAr: item.titleAr || targetLesson?.titleAr || '',
          level: item.level || targetLesson?.level || 'beginner',
          lastReadAt: item.lastReadAt ?? now,
          progressPercent: item.progressPercent ?? 10,
          wordsInteracted: item.wordsInteracted ?? 0,
          totalWords: item.totalWords || 1,
          audioListened: Boolean(item.audioListened),
          quizCompleted: Boolean(item.quizCompleted),
          quizScore: item.quizScore,
        };
        return [newItem, ...prev];
      });
    },
    [allLessons, setReadingHistory]
  );

  const handleClearReadingHistory = useCallback(() => {
    setReadingHistory([]);
  }, [setReadingHistory]);

  const handleRemoveReadingHistoryItem = useCallback(
    (lessonId: string) => {
      setReadingHistory((prev) => prev.filter((item) => item.lessonId !== lessonId));
    },
    [setReadingHistory]
  );

  const handleOpenLesson = (lessonId: string) => {
    recordStudyActivity();
    setActiveLessonId(lessonId);
    setWordSelection(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddLesson = (lesson: Lesson) => {
    if (!canAddContent) return;
    setCustomLessons((prev) => [lesson, ...prev]);
    setSelectedLevel(lesson.level);
    setActiveTab('lessons');
    setActiveNavSection('levels');
    setActiveLessonId(null);
    setPublishNotice({
      lessonId: lesson.id,
      title: lesson.titleAr || lesson.titleEn,
      levelEn: LEVEL_LABELS[lesson.level].en,
      levelAr: LEVEL_LABELS[lesson.level].ar,
    });
  };

  const handleOpenAuth = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setIsAuthModalOpen(true);
  };

  const handleLogout = () => {
    logoutUser();
    setCurrentUser(null);
    setActiveLessonId(null);
    setActiveTab('lessons');
    setActiveNavSection('home');
    setIsAddLessonOpen(false);
    setIsNotesOpen(false);
    setIsUserManagementOpen(false);
    setPublishNotice(null);
    setWordSelection(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteCustomLesson = (lessonId: string) => {
    setCustomLessons((prev) => prev.filter((l) => l.id !== lessonId));
    if (activeLessonId === lessonId) {
      setActiveLessonId(null);
    }
  };

  const getCacheKey = (word: string, contextSentence: string, level: ProficiencyLevel) =>
    `v3::${level}::${normalizeArabicWord(word)}::${stripTashkeel(contextSentence).replace(/\s+/g, ' ').trim().slice(0, 80)}`;

  const fetchWordAnalysis = async (selection: ActiveWordSelection): Promise<WordAnalysis> => {
    const targetLevel: ProficiencyLevel =
      selection.lessonLevel ?? activeLesson?.level ?? selectedLevel;
    const cacheKey = getCacheKey(selection.word, selection.contextSentence, targetLevel);

    // 1. Instant 0ms localStorage cache hit (ignoring any legacy fake placeholders)
    const cached = analysisCache[cacheKey];
    if (cached && !isFakePlaceholderTranslation(cached)) {
      return cached;
    }

    // 2. Reuse in-flight request if already running
    const existingPromise = inFlightRequests.current.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const requestPromise = (async () => {
      const analysis = await analyzeArabicWordClient({
        word: selection.word,
        contextSentence: selection.contextSentence,
        level: targetLevel,
      });

      if (analysis.notice) {
        setApiNotice(analysis.notice);
      }

      if (!isFakePlaceholderTranslation(analysis)) {
        setAnalysisCache((prev) => ({ ...prev, [cacheKey]: analysis }));
      }
      return analysis;
    })();

    inFlightRequests.current.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      inFlightRequests.current.delete(cacheKey);
    }
  };

  const handleSelectWord = (selection: ActiveWordSelection) => {
    setWordSelection(selection);
    setPopoverMode('menu');
    setAnalysisError(null);
    setJustSaved(false);

    const targetLevel: ProficiencyLevel =
      selection.lessonLevel ?? activeLesson?.level ?? selectedLevel;
    const cacheKey = getCacheKey(selection.word, selection.contextSentence, targetLevel);
    const cached = analysisCache[cacheKey];
    if (cached && !isFakePlaceholderTranslation(cached)) {
      setWordAnalysis(cached);
    } else {
      setWordAnalysis(null);
    }
  };

  const handleTranslateWord = async () => {
    if (!wordSelection) return;
    recordStudyActivity('translated');
    setPopoverMode('translation');
    setAnalysisError(null);

    const targetLevel: ProficiencyLevel =
      wordSelection.lessonLevel ?? activeLesson?.level ?? selectedLevel;
    const cacheKey = getCacheKey(
      wordSelection.word,
      wordSelection.contextSentence,
      targetLevel
    );
    const cached = analysisCache[cacheKey];
    if (cached && !isFakePlaceholderTranslation(cached)) {
      setWordAnalysis(cached);
      setAnalysisLoading(false);
      return;
    }

    setAnalysisLoading(true);
    try {
      const result = await fetchWordAnalysis(wordSelection);
      setWordAnalysis(result);
      setAnalysisError(null);
    } catch (err) {
      console.warn('[Qalam Translation] fetchWordAnalysis threw error, using built-in analysis:', err);
      const fallback = buildResilientWordAnalysis(
        wordSelection.word,
        wordSelection.contextSentence,
        'Showing built-in Arabic analysis.',
        targetLevel
      );
      setWordAnalysis(fallback);
      setAnalysisError(null);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleAddToVocabulary = () => {
    if (!wordSelection) return;
    recordStudyActivity();
    const rawNormalized = normalizeArabicWord(wordSelection.word);
    const normalizedKey = normalizeStandaloneArabicKey(wordSelection.word) || rawNormalized;
    const sourceLevel: ProficiencyLevel =
      wordSelection.lessonLevel ?? activeLesson?.level ?? selectedLevel;
    const cacheKey = getCacheKey(
      wordSelection.word,
      wordSelection.contextSentence,
      sourceLevel
    );

    if (vocabStatusMap.has(normalizedKey) || vocabStatusMap.has(rawNormalized)) {
      setJustSaved(true);
      if (!wordAnalysis) {
        const existing = vocabCards.find(
          (c) =>
            c.normalizedKey === normalizedKey ||
            c.normalizedKey === rawNormalized ||
            normalizeStandaloneArabicKey(c.wordWithTashkeel) === normalizedKey
        );
        if (existing) {
          setWordAnalysis(existing);
        }
      }
      setPopoverMode('translation');
      return;
    }

    const validCached =
      analysisCache[cacheKey] && !isFakePlaceholderTranslation(analysisCache[cacheKey])
        ? analysisCache[cacheKey]
        : null;
    const validCurrent =
      wordAnalysis && !isFakePlaceholderTranslation(wordAnalysis) ? wordAnalysis : null;
    const curatedBaseline = lookupFallbackWord(
      wordSelection.word,
      wordSelection.contextSentence,
      undefined,
      sourceLevel
    );

    const resolvedBaseline = validCached ?? validCurrent ?? curatedBaseline;
    const standaloneRaw = normalizeStandaloneVocabWord(
      resolvedBaseline?.wordWithTashkeel || wordSelection.word,
      {
        wordType: resolvedBaseline?.wordType,
        partOfSpeech: resolvedBaseline?.partOfSpeech,
      }
    );
    const standaloneWordAr = applySmartPartialTashkeel(
      standaloneRaw || resolvedBaseline?.wordWithTashkeel || wordSelection.word
    );
    const standaloneKey = normalizeStandaloneArabicKey(standaloneWordAr) || normalizedKey;

    const instantAnalysis: WordAnalysis = resolvedBaseline ?? {
      word: stripTashkeel(standaloneWordAr) || stripTashkeel(wordSelection.word),
      wordWithTashkeel: standaloneWordAr,
      vocalizedWord: stripFinalIrabForSpeech(standaloneWordAr, {
        wordType: 'اسم',
        partOfSpeech: 'Vocabulary',
      }),
      partOfSpeech: 'Vocabulary',
      wordType: 'اسم',
      root: '',
      transliteration: '',
      englishMeaning: 'Translation pending — tap Translate or Edit to retry',
      examples: [],
      level: sourceLevel,
    };

    const newCardId = `vocab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newCard: VocabCard = {
      ...instantAnalysis,
      id: newCardId,
      word: stripTashkeel(standaloneWordAr) || instantAnalysis.word,
      wordWithTashkeel: standaloneWordAr,
      normalizedKey: standaloneKey,
      lessonId: activeLesson?.id,
      lessonTitle: activeLesson?.titleEn,
      level: instantAnalysis.level ?? sourceLevel,
      vocalizedWord:
        instantAnalysis.vocalizedWord ||
        stripFinalIrabForSpeech(standaloneWordAr, {
          wordType: instantAnalysis.wordType,
          partOfSpeech: instantAnalysis.partOfSpeech,
        }),
      status: 'needs_review',
      createdAt: Date.now(),
    };

    setVocabCards((prev) => [newCard, ...prev]);
    setWordAnalysis({
      ...instantAnalysis,
      word: newCard.word,
      wordWithTashkeel: newCard.wordWithTashkeel,
      vocalizedWord: newCard.vocalizedWord,
    });
    setAnalysisError(null);
    setSavingVocab(false);
    recordStudyActivity('added');
    setJustSaved(true);
    setPopoverMode('translation');

    // Background AI enrichment: upgrades the saved card seamlessly if Gemini responds with real translation data
    if (instantAnalysis.source !== 'gemini' && instantAnalysis.source !== 'cache') {
      const capturedSelection = wordSelection;
      void fetchWordAnalysis(capturedSelection)
        .then((enriched) => {
          if (enriched.source === 'gemini') {
            const enrichedStandaloneAr = applySmartPartialTashkeel(
              normalizeStandaloneVocabWord(enriched.wordWithTashkeel, {
                wordType: enriched.wordType,
                partOfSpeech: enriched.partOfSpeech,
              }) || enriched.wordWithTashkeel
            );
            setVocabCards((prev) =>
              prev.map((card) =>
                card.id === newCardId && !card.hasCustomEdits
                  ? {
                      ...card,
                      ...enriched,
                      word: stripTashkeel(enrichedStandaloneAr) || enriched.word,
                      wordWithTashkeel: enrichedStandaloneAr,
                      id: card.id,
                      normalizedKey:
                        normalizeStandaloneArabicKey(enrichedStandaloneAr) || card.normalizedKey,
                      lessonId: card.lessonId,
                      lessonTitle: card.lessonTitle,
                      level: enriched.level ?? card.level,
                      status: card.status,
                      createdAt: card.createdAt,
                    }
                  : card
              )
            );
            setWordAnalysis((curr) =>
              curr &&
              (normalizeStandaloneArabicKey(curr.word) === standaloneKey ||
                normalizeArabicWord(curr.word) === rawNormalized)
                ? {
                    ...enriched,
                    word: stripTashkeel(enrichedStandaloneAr) || enriched.word,
                    wordWithTashkeel: enrichedStandaloneAr,
                  }
                : curr
            );
          }
        })
        .catch((err) => {
          console.error('[Qalam Translation] Background vocabulary enrichment failed:', err);
          if (err instanceof Error && err.message && !curatedBaseline) {
            setWordAnalysis((curr) =>
              curr &&
              (normalizeStandaloneArabicKey(curr.word) === standaloneKey ||
                normalizeArabicWord(curr.word) === rawNormalized)
                ? {
                    ...curr,
                    notice: `Saved to vocabulary locally. ${err.message}`,
                  }
                : curr
            );
          }
        });
    }
  };

  const handleUpdateVocabStatus = (id: string, status: PracticeStatus) => {
    recordStudyActivity('reviewed');
    setVocabCards((prev) =>
      prev.map((card) =>
        card.id === id ? { ...card, status, lastReviewedAt: Date.now() } : card
      )
    );
  };

  const handleRateVocabCard = (id: string, rating: SrsRating) => {
    recordStudyActivity('reviewed');
    const now = Date.now();
    const intervalDays = rating === 'hard' ? 0 : rating === 'good' ? 2 : 7;
    const nextReviewAt =
      rating === 'hard' ? now : now + intervalDays * 24 * 60 * 60 * 1000;
    const nextStatus: PracticeStatus =
      rating === 'hard' ? 'needs_review' : 'learned';

    setVocabCards((prev) =>
      prev.map((card) =>
        card.id === id
          ? {
              ...card,
              status: nextStatus,
              srsRating: rating,
              intervalDays,
              nextReviewAt,
              lastReviewedAt: now,
              reviewCount: (card.reviewCount ?? 0) + 1,
            }
          : card
      )
    );
  };

  const handleEditVocabCard = (updatedCard: VocabCard, previousCard: VocabCard) => {
    // Invalidate cached TTS audio for both previous and updated word & example sentences
    invalidateCachedArabicAudio(previousCard.wordWithTashkeel, 'word');
    if (previousCard.vocalizedWord) {
      invalidateCachedArabicAudio(previousCard.vocalizedWord, 'word');
    }
    invalidateCachedArabicAudio(updatedCard.wordWithTashkeel, 'word');
    if (updatedCard.vocalizedWord) {
      invalidateCachedArabicAudio(updatedCard.vocalizedWord, 'word');
    }

    for (const ex of previousCard.examples) {
      invalidateCachedArabicAudio(ex.arabic);
    }
    for (const ex of updatedCard.examples) {
      invalidateCachedArabicAudio(ex.arabic);
    }

    // Invalidate stale cached translations for previous/updated standalone word keys
    const prevRawKey = normalizeArabicWord(previousCard.wordWithTashkeel);
    const prevStandaloneKey = normalizeStandaloneArabicKey(previousCard.wordWithTashkeel);
    const nextRawKey = normalizeArabicWord(updatedCard.wordWithTashkeel);
    const nextStandaloneKey = normalizeStandaloneArabicKey(updatedCard.wordWithTashkeel);
    setAnalysisCache((prev) => {
      let changed = false;
      const next: Record<string, WordAnalysis> = {};
      for (const [k, val] of Object.entries(prev)) {
        const valRaw = normalizeArabicWord(val.wordWithTashkeel || val.word);
        const valStandalone = normalizeStandaloneArabicKey(val.wordWithTashkeel || val.word);
        const matchesEdited =
          valRaw === prevRawKey ||
          valRaw === nextRawKey ||
          valStandalone === prevStandaloneKey ||
          valStandalone === nextStandaloneKey;
        if (matchesEdited) {
          changed = true;
        } else {
          next[k] = val;
        }
      }
      return changed ? next : prev;
    });

    setVocabCards((prev) =>
      prev.map((card) => (card.id === updatedCard.id ? updatedCard : card))
    );
  };

  const handleDeleteVocabCard = (id: string) => {
    setVocabCards((prev) => prev.filter((card) => card.id !== id));
  };

  const handleToggleDifficultCard = (id: string) => {
    const now = Date.now();
    setVocabCards((prev) =>
      prev.map((card) => {
        if (card.id !== id) return card;
        if (card.srsRating === 'hard') {
          return {
            ...card,
            srsRating: undefined,
            lastReviewedAt: now,
          };
        }
        return {
          ...card,
          status: 'needs_review',
          srsRating: 'hard',
          intervalDays: 0,
          nextReviewAt: now,
          lastReviewedAt: now,
        };
      })
    );
  };

  const getDefaultNoteContext = useCallback((): NoteContextTag | null => {
    if (activeTab === 'lessons' && activeLesson) {
      return {
        type: 'lesson',
        label: activeLesson.titleAr || activeLesson.titleEn,
        refId: activeLesson.id,
      };
    }
    if (activeTab === 'vocabulary') {
      return {
        type: 'vocab',
        label: 'مفرداتي · My Vocabulary',
      };
    }
    if (activeTab === 'exams') {
      return {
        type: 'exam',
        label: 'الامتحانات · Exams',
      };
    }
    if (activeTab === 'conversation') {
      return {
        type: 'conversation',
        label: 'المحادثة · Conversation',
      };
    }
    return null;
  }, [activeLesson, activeTab]);

  const handleOpenNotes = useCallback(
    (explicitContext?: NoteContextTag) => {
      setActiveHeroSwitch('notes');
      setNotesContext(explicitContext ?? getDefaultNoteContext());
      setIsNotesOpen(true);
    },
    [getDefaultNoteContext]
  );

  const handleSaveNote = useCallback(
    (input: { id?: string; title?: string; body: string; context?: NoteContextTag }) => {
      const now = Date.now();
      setStudyNotes((prev) => {
        if (input.id) {
          return prev.map((note) =>
            note.id === input.id
              ? {
                  ...note,
                  title: input.title,
                  body: input.body,
                  context: input.context,
                  updatedAt: now,
                }
              : note
          );
        }
        const nextNote: StudyNote = {
          id: `note-${now}-${Math.random().toString(36).slice(2, 7)}`,
          title: input.title,
          body: input.body,
          context: input.context,
          createdAt: now,
          updatedAt: now,
        };
        return [nextNote, ...prev];
      });
    },
    [setStudyNotes]
  );

  const handleDeleteNote = useCallback(
    (id: string) => {
      setStudyNotes((prev) => prev.filter((note) => note.id !== id));
    },
    [setStudyNotes]
  );

  const completedLessonsCount = useMemo(
    () => readingHistory.filter((item) => item.progressPercent >= 100).length,
    [readingHistory]
  );

  const activeWordKey = wordSelection ? normalizeArabicWord(wordSelection.word) : null;
  const isCurrentWordSaved = activeWordKey ? vocabStatusMap.has(activeWordKey) : false;

  return (
    <div
      className="min-h-screen flex flex-col bg-[#FAFBF8] text-[#1F2718]"
      onDragStart={(e) => {
        if (e.target instanceof HTMLImageElement || e.target instanceof SVGElement) {
          e.preventDefault();
        }
      }}
    >
      <Navbar
        activeTab={activeTab}
        activeNavSection={activeNavSection}
        onSelectHome={handleSelectHome}
        onSelectHistory={() => handleSelectTab('history')}
        onSelectLevels={handleSelectLevelsNav}
        onSelectTab={handleSelectTab}
        vocabCount={vocabCards.length}
        historyCount={readingHistory.length}
        currentUser={currentUser}
        canAddContent={canAddContent}
        onOpenAuth={handleOpenAuth}
        onOpenAddLesson={() => {
          if (canAddContent) {
            setActiveHeroSwitch('addText');
            setIsAddLessonOpen(true);
          }
        }}
        onOpenUserManagement={() => {
          if (isAdminUser(currentUser)) setIsUserManagementOpen(true);
        }}
        onLogout={handleLogout}
        notesCount={studyNotes.length}
        onOpenNotes={() => handleOpenNotes()}
        dailyWordGoal={dailyWordGoal}
        onChangeDailyGoal={setDailyWordGoal}
        vocabCards={vocabCards}
        todayLog={dailyLogs[todayKey]}
        todayKey={todayKey}
      />

      {!currentUser ? (
        <>
          <LandingPage onGetStarted={(mode) => handleOpenAuth(mode)} />

          <footer className="border-t border-[#DCE5D3] bg-white/95 py-6">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-xs text-[#5A6552] sm:px-6 lg:px-8">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-lg font-bold text-[#2D3B22] select-none">
                    قَلَم
                  </span>
                  <span className="font-medium text-[#1F2718]">
                    Qalam — Contextual Arabic Reading &amp; Smart Flashcard Studio
                  </span>
                </div>
                <p className="text-[11px] text-[#6B7861]">
                  &copy; {new Date().getFullYear()} Qalam (قَلَم). Original Arabic lessons, exercises, and study prompts. All rights reserved.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => handleOpenAuth('login')}
                  className="font-semibold text-[#2D3B22] hover:underline cursor-pointer"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenAuth('register')}
                  className="font-semibold text-[#9A6F14] hover:underline cursor-pointer"
                >
                  Create Free Account
                </button>
              </div>
            </div>
          </footer>

          <AuthModal
            isOpen={isAuthModalOpen}
            initialMode={authModalMode}
            onClose={() => setIsAuthModalOpen(false)}
            onAuthenticated={(user) => {
              migrateGuestDataToAccount(user.id);
              setCurrentUser(user);
              setActiveTab('lessons');
              setActiveNavSection('home');
              setActiveLessonId(null);
              setWordSelection(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </>
      ) : (
        <>
          {/* Friendly Non-Blocking API Notice Banner */}
          {apiNotice && (
            <div className="border-b border-[#E8B948]/40 bg-[#FEF9EC]">
              <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 text-xs text-[#5C4107] sm:px-6 lg:px-8">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="h-4 w-4 shrink-0 text-[#D4A338]" aria-hidden="true" />
                  <span dir="auto" className="leading-relaxed">{apiNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setApiNotice(null)}
                  aria-label="Dismiss notification"
                  className="rounded-md p-1 text-[#9A6F14] hover:bg-[#FBF3DC] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {activeTab === 'lessons' && (
          <>
            {activeLesson ? (
              <LessonReader
                lesson={activeLesson}
                preferences={preferences}
                onUpdatePreferences={setPreferences}
                vocabStatusMap={vocabStatusMap}
                activeWordKey={activeWordKey}
                onSelectWord={handleSelectWord}
                onBackToList={() => {
                  setActiveLessonId(null);
                  setWordSelection(null);
                }}
                onUpdateReadingHistory={handleUpdateReadingHistory}
                notesCount={studyNotes.length}
                onOpenNotes={(ctx) => handleOpenNotes(ctx)}
              />
            ) : (
              <div className="space-y-9">
                {/* Refined Dark Olive Welcome Banner */}
                <section className="animate-fade-slide-up relative overflow-hidden rounded-2xl border border-[#3E522D] bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] text-[#FAFBF8] shadow-md">
                  <div className="islamic-geo-pattern pointer-events-none absolute inset-0 opacity-40" />
                  <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#D4A338]/15 blur-3xl" />
                  <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-[#DCE5D3]/10 blur-3xl" />

                  <div className="relative mx-auto max-w-3xl px-6 py-10 sm:px-10 sm:py-12 text-center space-y-5">
                    <div className="space-y-3">
                      <h1
                        dir="rtl"
                        lang="ar"
                        className="font-arabic-scheherazade text-4xl sm:text-5xl font-bold text-white leading-[1.55]"
                      >
                        اقرأ، استمع، تدرّب، وطوّر لغتك!
                      </h1>

                      <p className="mx-auto max-w-xl text-xs sm:text-sm text-[#DCE5D3] leading-relaxed pt-1">
                        Improve your Arabic through level-based reading, audio listening, pronunciation practice, and instant word translations. Build your vocabulary and develop your language skills in context.
                      </p>
                    </div>

                    <div
                      role="group"
                      aria-label="Primary actions"
                      className="flex flex-wrap items-center justify-center gap-3 pt-1 pb-1"
                    >
                      <button
                        type="button"
                        aria-pressed={activeHeroSwitch === 'levels'}
                        onClick={handleSelectLevelsNav}
                        className={`qalam-switch-btn text-xs sm:text-sm font-bold ${
                          activeHeroSwitch === 'levels' ? 'is-active' : ''
                        }`}
                      >
                        <span>Explore Levels</span>
                        <ArrowDown
                          className={`h-3.5 w-3.5 transition-colors duration-[180ms] ${
                            activeHeroSwitch === 'levels' ? 'text-[#1F2718]' : 'text-[#FACC15]'
                          }`}
                          aria-hidden="true"
                        />
                      </button>

                      <button
                        type="button"
                        aria-pressed={activeHeroSwitch === 'practice'}
                        onClick={handleOpenDifficultPractice}
                        className={`qalam-switch-btn text-xs sm:text-sm font-semibold ${
                          activeHeroSwitch === 'practice' ? 'is-active font-bold' : ''
                        }`}
                      >
                        <Flame
                          className={`h-4 w-4 shrink-0 transition-colors duration-[180ms] ${
                            activeHeroSwitch === 'practice' ? 'text-[#2D3B22]' : 'text-[#FACC15]'
                          }`}
                          aria-hidden="true"
                        />
                        <span>Practice Cards</span>
                        {difficultCount > 0 && (
                          <span
                            className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums transition-colors duration-[180ms] ${
                              activeHeroSwitch === 'practice'
                                ? 'bg-[#2D3B22]/15 text-[#1F2718]'
                                : 'bg-[#182111]/60 text-[#FACC15]'
                            }`}
                          >
                            {difficultCount}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        aria-pressed={activeHeroSwitch === 'notes'}
                        onClick={() => handleOpenNotes()}
                        className={`qalam-switch-btn text-xs sm:text-sm font-semibold ${
                          activeHeroSwitch === 'notes' ? 'is-active font-bold' : ''
                        }`}
                      >
                        <NotebookPen
                          className={`h-4 w-4 shrink-0 transition-colors duration-[180ms] ${
                            activeHeroSwitch === 'notes' ? 'text-[#2D3B22]' : 'text-[#FACC15]'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="font-arabic-cairo">My Notes · ملاحظاتي</span>
                        {studyNotes.length > 0 && (
                          <span
                            className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums transition-colors duration-[180ms] ${
                              activeHeroSwitch === 'notes'
                                ? 'bg-[#2D3B22]/15 text-[#1F2718]'
                                : 'bg-[#182111]/60 text-[#FACC15]'
                            }`}
                          >
                            {studyNotes.length}
                          </span>
                        )}
                      </button>

                      {canAddContent && (
                        <button
                          type="button"
                          aria-pressed={activeHeroSwitch === 'addText'}
                          onClick={() => {
                            setActiveHeroSwitch('addText');
                            setIsAddLessonOpen(true);
                          }}
                          className={`qalam-switch-btn text-xs sm:text-sm font-semibold ${
                            activeHeroSwitch === 'addText' ? 'is-active font-bold' : ''
                          }`}
                        >
                          <Plus
                            className={`h-4 w-4 shrink-0 transition-colors duration-[180ms] ${
                              activeHeroSwitch === 'addText' ? 'text-[#2D3B22]' : 'text-[#FACC15]'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="font-arabic-cairo">إضافة نص جديد (Add New Text)</span>
                        </button>
                      )}
                    </div>

                    {/* Subtle Compact Hero Stats Strip */}
                    <div className="mx-auto flex flex-wrap items-center justify-center gap-6 border-t border-white/15 pt-5 text-xs sm:text-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xl font-bold tabular-nums text-[#E8B948]">
                          {learnedCount}
                        </span>
                        <span className="text-[#DCE5D3] font-medium">Words Learned</span>
                      </div>
                      <span className="text-white/25" aria-hidden="true">|</span>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xl font-bold tabular-nums text-white">
                          {allLessons.length}
                        </span>
                        <span className="text-[#DCE5D3] font-medium">Lessons Available</span>
                      </div>
                      <span className="text-white/25" aria-hidden="true">|</span>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xl font-bold tabular-nums text-[#E8B948]">
                          {effectiveStreakCount}
                        </span>
                        <span className="text-[#DCE5D3] font-medium">Day Streak</span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Cohesive Olive & Gold Proficiency Level Cards */}
                <section
                  id="levels-section"
                  ref={levelsSectionRef}
                  aria-label="Select proficiency level"
                  className="scroll-mt-20 space-y-4 animate-fade-slide-up animate-delay-75"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2.5">
                      <h2 className="font-display text-xl sm:text-2xl font-bold text-[#1F2718]">
                        Choose Your Level
                      </h2>
                      <span
                        dir="rtl"
                        lang="ar"
                        className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]"
                      >
                        المستويات
                      </span>
                    </div>
                    <span className="text-xs text-[#5A6552]">
                      Select a track to filter reading passages
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                    {([
                      {
                        level: 'beginner' as ProficiencyLevel,
                        Icon: Sprout,
                        cardBg: 'from-[#FAFBF8] via-white to-[#EEF2E9]/70',
                        glowOrb: 'bg-[#DCE5D3]/50',
                        activeBorder:
                          'border-[#3B4D2B] ring-2 ring-[#D4A338]/40 shadow-md',
                        idleBorder:
                          'border-[#DCE5D3] hover:border-[#3E522D]/60 hover:shadow-sm',
                        iconBox:
                          'bg-[#EEF2E9] text-[#2D3B22] border border-[#DCE5D3]',
                        activeIconBox:
                          'bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] text-[#E8B948] ring-4 ring-[#DCE5D3]',
                        titleColor: 'text-[#1F2718]',
                        accentText: 'text-[#2D3B22]',
                      },
                      {
                        level: 'intermediate' as ProficiencyLevel,
                        Icon: Compass,
                        cardBg: 'from-[#FAFBF8] via-white to-[#FBF3DC]/50',
                        glowOrb: 'bg-[#FBF3DC]/60',
                        activeBorder:
                          'border-[#3B4D2B] ring-2 ring-[#D4A338]/40 shadow-md',
                        idleBorder:
                          'border-[#DCE5D3] hover:border-[#D4A338]/70 hover:shadow-sm',
                        iconBox:
                          'bg-[#FBF3DC] text-[#9A6F14] border border-[#E8B948]/50',
                        activeIconBox:
                          'bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] text-[#E8B948] ring-4 ring-[#FBF3DC]',
                        titleColor: 'text-[#1F2718]',
                        accentText: 'text-[#9A6F14]',
                      },
                      {
                        level: 'advanced' as ProficiencyLevel,
                        Icon: Crown,
                        cardBg: 'from-[#FAFBF8] via-white to-[#EEF2E9]/85',
                        glowOrb: 'bg-[#3E522D]/15',
                        activeBorder:
                          'border-[#2D3B22] ring-2 ring-[#D4A338]/45 shadow-md',
                        idleBorder:
                          'border-[#DCE5D3] hover:border-[#2D3B22]/60 hover:shadow-sm',
                        iconBox:
                          'bg-[#EEF2E9] text-[#2D3B22] border border-[#DCE5D3]',
                        activeIconBox:
                          'bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] text-[#E8B948] ring-4 ring-[#DCE5D3]',
                        titleColor: 'text-[#1F2718]',
                        accentText: 'text-[#2D3B22]',
                      },
                    ]).map((cfg) => {
                      const meta = LEVEL_LABELS[cfg.level];
                      const active = selectedLevel === cfg.level;
                      const count = allLessons.filter((l) => l.level === cfg.level).length;
                      const IconComponent = cfg.Icon;

                      return (
                        <button
                          key={cfg.level}
                          type="button"
                          onClick={() => handleSelectLevel(cfg.level)}
                          aria-pressed={active}
                          className={`group relative overflow-hidden flex flex-col justify-between rounded-2xl border bg-gradient-to-br ${cfg.cardBg} p-6 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 active:scale-[0.99] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A338] ${
                            active ? cfg.activeBorder : cfg.idleBorder
                          }`}
                        >
                          <div
                            className={`pointer-events-none -right-8 -top-8 absolute h-28 w-28 rounded-full ${cfg.glowOrb} blur-2xl transition-opacity duration-200 group-hover:opacity-100 opacity-70`}
                          />

                          <div className="relative flex items-start justify-between gap-3 w-full">
                            <div
                              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-transform duration-200 group-hover:scale-105 ${
                                active ? cfg.activeIconBox : cfg.iconBox
                              }`}
                            >
                              <IconComponent className="h-5 w-5" aria-hidden="true" />
                            </div>

                            <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                              <span className={`font-semibold ${cfg.accentText}`}>
                                {count} {count === 1 ? 'Lesson' : 'Lessons'}
                              </span>
                              {active && (
                                <CheckCircle2
                                  className="h-4 w-4 text-[#D4A338]"
                                  aria-label="Selected"
                                />
                              )}
                            </div>
                          </div>

                          <div className="relative mt-5 space-y-2 w-full">
                            <div className="flex items-baseline justify-between gap-2">
                              <h3 className={`font-display text-xl font-bold ${cfg.titleColor}`}>
                                {meta.en}
                              </h3>
                              <span
                                dir="rtl"
                                lang="ar"
                                className={`font-arabic-scheherazade text-2xl font-bold ${cfg.accentText}`}
                              >
                                {meta.ar}
                              </span>
                            </div>
                            <p
                              dir="rtl"
                              lang="ar"
                              className="font-arabic-scheherazade text-lg text-[#3F4A37] leading-relaxed text-right"
                            >
                              {meta.summaryAr}
                            </p>
                          </div>

                          <div className="relative mt-4 pt-3 border-t border-[#DCE5D3]/80 flex items-center justify-between w-full text-xs font-semibold">
                            <span className={active ? 'text-[#2D3B22] font-bold' : 'text-[#5A6552]'}>
                              {active ? 'Active Track' : 'Select Level'}
                            </span>
                            <ArrowRight
                              className={`h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1 ${
                                active ? 'text-[#D4A338]' : 'text-[#6B7861]'
                              }`}
                              aria-hidden="true"
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Filtered Lessons List */}
                <section className="space-y-5 animate-fade-slide-up animate-delay-150">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#DCE5D3] pb-3">
                    <div className="flex items-baseline gap-3">
                      <h2 className="font-display text-2xl font-bold text-[#1F2718]">
                        {levelInfo.en} Lessons
                      </h2>
                      <span dir="rtl" lang="ar" className="font-arabic-scheherazade text-2xl font-bold text-[#2D3B22]">
                        دروسُ المستوى {levelInfo.ar}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-[#5A6552]">
                        ({filteredLessons.length})
                      </span>
                    </div>

                    {canAddContent && (
                      <button
                        type="button"
                        onClick={() => setIsAddLessonOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-3.5 py-2 text-xs font-semibold text-white hover:brightness-110 shadow-sm transition-all active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0 text-[#E8B948]" aria-hidden="true" />
                        <span className="font-arabic-cairo">إضافة نص جديد (Add New Text)</span>
                      </button>
                    )}
                  </div>

                  {publishNotice && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9] px-4 py-3 text-xs text-[#1F2718]">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#3E522D]" aria-hidden="true" />
                        <span>
                          Added <span className="font-bold">{publishNotice.title}</span> to{' '}
                          <span className="font-semibold">
                            {publishNotice.levelEn} ({publishNotice.levelAr})
                          </span>
                          .
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            const id = publishNotice.lessonId;
                            setPublishNotice(null);
                            handleOpenLesson(id);
                          }}
                          className="font-semibold text-[#2D3B22] hover:underline cursor-pointer"
                        >
                          Open Reader
                        </button>
                        <button
                          type="button"
                          onClick={() => setPublishNotice(null)}
                          aria-label="Dismiss added notice"
                          className="text-[#5A6552] hover:text-[#1F2718] cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {filteredLessons.map((lesson) => {
                      const words = countArabicWords(lesson.textAr);
                      const firstLine = lesson.textAr.split('\n')[0]?.slice(0, 145) ?? '';
                      const readerFontClass = getArabicFontClass(preferences.fontStyle);

                      return (
                        <article
                          key={lesson.id}
                          className="group flex flex-col justify-between rounded-2xl border border-[#DCE5D3] bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#3E522D]/60 hover:shadow-md"
                        >
                          <div className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF2E9] text-[#2D3B22] border border-[#DCE5D3]">
                                  {lesson.contentType !== 'text' && lesson.youtubeUrl ? (
                                    <Video className="h-5 w-5 text-[#9A6F14]" aria-hidden="true" />
                                  ) : (
                                    <BookOpen className="h-5 w-5 text-[#2D3B22]" aria-hidden="true" />
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-[#5A6552] font-mono tabular-nums">
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3 w-3 text-[#6B7861]" aria-hidden="true" />
                                    <span>{lesson.readingTimeMinutes} min</span>
                                  </span>
                                  {words > 0 && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>{words} words</span>
                                    </>
                                  )}
                                  {lesson.contentType !== 'text' && lesson.youtubeUrl && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="inline-flex items-center gap-1 text-[#9A6F14] font-semibold">
                                        <Video className="h-3 w-3" aria-hidden="true" />
                                        <span>Video</span>
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {lesson.isCustom && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCustomLesson(lesson.id)}
                                  aria-label={`Delete custom lesson ${lesson.titleEn}`}
                                  className="inline-flex items-center gap-1 text-xs text-[#6B7861] hover:text-amber-800 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </div>

                            <div className="space-y-1.5">
                              <h3
                                dir="rtl"
                                lang="ar"
                                className={`${readerFontClass} text-2xl sm:text-3xl font-bold text-[#2D3B22] text-right leading-[1.9]`}
                              >
                                {applySmartPartialTashkeel(lesson.titleAr)}
                              </h3>
                              {stripTashkeel(lesson.titleEn).trim() !==
                                stripTashkeel(lesson.titleAr).trim() && (
                                <h4 className="font-display text-xl font-bold text-[#1F2718]">
                                  {lesson.titleEn}
                                </h4>
                              )}
                              <p className="text-sm text-[#5A6552] leading-relaxed">
                                {lesson.description}
                              </p>
                            </div>

                            {firstLine ? (
                              <p
                                dir="rtl"
                                lang="ar"
                                className={`rounded-xl bg-[#FAFBF8] border border-[#DCE5D3] px-4 py-3 ${readerFontClass} text-lg leading-[2.15] text-[#1F2718] line-clamp-2`}
                              >
                                {applySmartPartialTashkeel(firstLine)}...
                              </p>
                            ) : (
                              <div className="rounded-xl bg-[#FAFBF8] border border-[#DCE5D3] px-4 py-3 text-xs text-[#5A6552] flex items-center gap-2">
                                <Video className="h-4 w-4 text-[#D4A338] shrink-0" aria-hidden="true" />
                                <span>YouTube video lesson — open reader to watch the embedded clip.</span>
                              </div>
                            )}
                          </div>

                          <div className="mt-6 pt-4 border-t border-[#EEF2E9] flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-[#5A6552] truncate">
                              {lesson.isCustom
                                ? `Uploaded by ${lesson.authorName || 'Contributor'}`
                                : 'Curated Reading'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleOpenLesson(lesson.id)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 shadow-sm transition-all active:scale-[0.98] shrink-0 cursor-pointer"
                            >
                              <span>Open Reader</span>
                              <ArrowRight className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                {/* Unified Sleek Statistics & Weekly Vocabulary Progress Section */}
                <section
                  aria-label="Learning statistics and weekly progress"
                  className="animate-fade-slide-up animate-delay-225 rounded-2xl border border-[#DCE5D3] bg-white p-5 sm:p-6 shadow-sm space-y-6"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#EEF2E9] pb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EEF2E9] text-[#2D3B22] border border-[#DCE5D3]">
                        <GraduationCap className="h-5 w-5 text-[#3E522D]" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2.5">
                          <h2 className="font-display text-lg sm:text-xl font-bold text-[#1F2718]">
                            Learning Overview &amp; Weekly Progress
                          </h2>
                          <span
                            dir="rtl"
                            lang="ar"
                            className="font-arabic-cairo text-sm font-bold text-[#3B4D2B]"
                          >
                            ملخّص التّعلّم والإحصاءات
                          </span>
                        </div>
                        <p className="text-xs text-[#5A6552]">
                          Your daily streak, vocabulary mastery, reading progress, and 7-day activity trend in one view.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleOpenDifficultPractice}
                      className="inline-flex items-center justify-center gap-1.5 self-start sm:self-auto rounded-xl bg-gradient-to-r from-[#D4A338] to-[#E8B948] px-4 py-2 text-xs font-bold text-[#1F2718] hover:brightness-105 shadow-xs transition-all active:scale-[0.98] cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <SparklesIconFallback />
                      <span>
                        Practice Cards{difficultCount > 0 ? ` (${difficultCount} hard)` : ''}
                      </span>
                    </button>
                  </div>

                  {/* Unified Layout: Left Compact Stat Cards Grid + Right Weekly Chart */}
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
                    <div className="lg:col-span-5 grid grid-cols-2 gap-3.5">
                      {/* 1. Daily Streak */}
                      <div className="rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] p-4 flex items-start justify-between gap-2.5 transition-all hover:border-[#3E522D]/50">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#5A6552]">Daily Streak</p>
                          <div className="mt-1 flex items-baseline gap-1">
                            <span className="font-mono text-2xl font-bold tabular-nums text-[#1F2718]">
                              {effectiveStreakCount}
                            </span>
                            <span className="text-[11px] font-medium text-[#5A6552]">
                              {effectiveStreakCount === 1 ? 'day' : 'days'}
                            </span>
                          </div>
                          <p
                            className={`mt-0.5 text-[11px] font-semibold truncate ${
                              studiedToday ? 'text-[#9A6F14]' : 'text-[#6B7861]'
                            }`}
                          >
                            {studiedToday ? 'Active today' : 'Read to extend'}
                          </p>
                        </div>
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                            studiedToday
                              ? 'bg-[#FBF3DC] text-[#9A6F14] border-[#E8B948]/50'
                              : 'bg-[#EEF2E9] text-[#5A6552] border-[#DCE5D3]'
                          }`}
                          aria-hidden="true"
                        >
                          <Flame className="h-4.5 w-4.5" />
                        </div>
                      </div>

                      {/* 2. Learned Words */}
                      <div className="rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] p-4 flex items-start justify-between gap-2.5 transition-all hover:border-[#3E522D]/50">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#5A6552]">Words Learned</p>
                          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#2D3B22]">
                            {learnedCount}
                          </p>
                          <p className="mt-0.5 text-[11px] font-medium text-[#6B7861] font-mono tabular-nums">
                            of {vocabCards.length} saved
                          </p>
                        </div>
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF2E9] text-[#2D3B22] border border-[#DCE5D3]"
                          aria-hidden="true"
                        >
                          <Layers className="h-4.5 w-4.5" />
                        </div>
                      </div>

                      {/* 3. Needs Review */}
                      <div className="rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] p-4 flex items-start justify-between gap-2.5 transition-all hover:border-[#D4A338]/70">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#5A6552]">Needs Review</p>
                          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#9A6F14]">
                            {reviewCount}
                          </p>
                          <p className="mt-0.5 text-[11px] font-medium text-[#6B7861]">
                            Ready for SRS
                          </p>
                        </div>
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FBF3DC] text-[#9A6F14] border border-[#E8B948]/50"
                          aria-hidden="true"
                        >
                          <Award className="h-4.5 w-4.5" />
                        </div>
                      </div>

                      {/* 4. Lessons & Active Track */}
                      <div className="rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] p-4 flex items-start justify-between gap-2.5 transition-all hover:border-[#3E522D]/50">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#5A6552]">Lessons Completed</p>
                          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[#1F2718]">
                            {completedLessonsCount}
                          </p>
                          <p className="mt-0.5 text-[11px] font-semibold text-[#3B4D2B] truncate">
                            {levelInfo.en} · <span dir="rtl" lang="ar">{levelInfo.ar}</span>
                          </p>
                        </div>
                        <div
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EEF2E9] text-[#2D3B22] border border-[#DCE5D3]"
                          aria-hidden="true"
                        >
                          <BookOpen className="h-4.5 w-4.5" />
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-7 rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] p-4 sm:p-5">
                      <WeeklyVocabChart
                        vocabCards={vocabCards}
                        dailyLogs={dailyLogs}
                        embedded
                      />
                    </div>
                  </div>
                </section>
              </div>
            )}
          </>
        )}

        {activeTab === 'history' && (
          <ReadingHistoryView
            history={readingHistory}
            onOpenLesson={handleOpenLesson}
            onClearHistory={handleClearReadingHistory}
            onRemoveHistoryItem={handleRemoveReadingHistoryItem}
            onGoToLessons={() => handleSelectTab('lessons')}
          />
        )}

        {activeTab === 'vocabulary' && (
          <div className="space-y-6">
            {currentUser?.isGuest && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#DCE5D3] bg-white px-5 py-3.5 text-xs text-[#5A6552] shadow-sm">
                <span>
                  You are studying in Guest Demo mode. Sign in or register to create a dedicated personal account and add custom lessons.
                </span>
                <button
                  type="button"
                  onClick={() => handleOpenAuth('register')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#D4A338] to-[#E8B948] px-3.5 py-2 font-bold text-[#1F2718] hover:brightness-105 transition-all cursor-pointer"
                >
                  <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Sign In / Register</span>
                </button>
              </div>
            )}

            <VocabularyView
              cards={vocabCards}
              speechRate={preferences.speechRate}
              initialScope={practiceScopeRequest.scope}
              scopeRequestSeq={practiceScopeRequest.seq}
              onUpdateStatus={handleUpdateVocabStatus}
              onToggleDifficult={handleToggleDifficultCard}
              onRateSrs={handleRateVocabCard}
              onEditCard={handleEditVocabCard}
              onDeleteCard={handleDeleteVocabCard}
              onGoToLessons={() => handleSelectTab('lessons')}
              onRecordReview={() => recordStudyActivity('reviewed')}
              notesCount={studyNotes.length}
              onOpenNotes={(ctx) => handleOpenNotes(ctx)}
            />
          </div>
        )}

        {activeTab === 'exams' && (
          <ExamsView
            cards={vocabCards}
            selectedLevel={selectedLevel}
            speechRate={preferences.speechRate}
            onRateSrs={handleRateVocabCard}
            onRecordReview={() => recordStudyActivity('reviewed')}
            onGoToLessons={() => handleSelectTab('lessons')}
            notesCount={studyNotes.length}
            onOpenNotes={(ctx) => handleOpenNotes(ctx)}
          />
        )}

        {activeTab === 'conversation' && (
          <ConversationView
            cards={vocabCards}
            selectedLevel={selectedLevel}
            speechRate={preferences.speechRate}
            notesCount={studyNotes.length}
            onOpenNotes={(ctx) => handleOpenNotes(ctx)}
          />
        )}
      </main>

      <footer className="border-t border-[#DCE5D3] bg-white/95 py-5 mt-12">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-xs text-[#5A6552] sm:px-6 lg:px-8">
          <div className="space-y-0.5">
            <p className="font-medium text-[#1F2718]">
              Qalam — Contextual Arabic Reading &amp; Smart Flashcard Studio
            </p>
            <p className="text-[11px] text-[#6B7861]">
              &copy; {new Date().getFullYear()} Qalam (قَلَم). Original Arabic learning content, exercises, and study prompts. All rights reserved.
            </p>
          </div>
          <span>Click or right-click any Arabic word in a lesson to translate or save</span>
        </div>
      </footer>

      <WordContextMenu
        selection={wordSelection}
        mode={popoverMode}
        loading={analysisLoading}
        savingVocab={savingVocab}
        error={analysisError}
        analysis={wordAnalysis}
        isAlreadySaved={isCurrentWordSaved}
        justSaved={justSaved}
        speechRate={preferences.speechRate}
        onTranslate={handleTranslateWord}
        onAddToVocabulary={handleAddToVocabulary}
        onOpenVocabulary={() => {
          setWordSelection(null);
          handleSelectTab('vocabulary');
        }}
        onClose={() => setWordSelection(null)}
      />

      {canAddContent && (
        <AddLessonModal
          isOpen={isAddLessonOpen}
          defaultLevel={selectedLevel}
          currentUser={currentUser}
          onClose={() => setIsAddLessonOpen(false)}
          onAddLesson={handleAddLesson}
          onOpenAuth={() => handleOpenAuth('login')}
        />
      )}

          <AuthModal
            isOpen={isAuthModalOpen}
            initialMode={authModalMode}
            onClose={() => setIsAuthModalOpen(false)}
            onAuthenticated={(user) => {
              migrateGuestDataToAccount(user.id);
              setCurrentUser(user);
              setWordSelection(null);
            }}
          />

          {isAdminUser(currentUser) && (
            <UserManagementModal
              isOpen={isUserManagementOpen}
              currentUser={currentUser}
              vocabCards={vocabCards}
              analysisCache={analysisCache}
              onVocabRepaired={setVocabCards}
              onAnalysisCacheRepaired={setAnalysisCache}
              onClose={() => setIsUserManagementOpen(false)}
              onCurrentUserSynced={(updated) => {
                if (updated) setCurrentUser(updated);
              }}
            />
          )}

          <NotesDrawer
            isOpen={isNotesOpen}
            notes={studyNotes}
            activeContext={notesContext}
            onClose={() => setIsNotesOpen(false)}
            onSaveNote={handleSaveNote}
            onDeleteNote={handleDeleteNote}
          />

          {audioToast && (
            <div
              role="status"
              aria-live="polite"
              className="animate-fade-slide-up fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-4 z-50 flex max-w-sm items-start gap-2.5 rounded-2xl border border-[#D4A338]/55 bg-[#24301B]/95 px-4 py-3 text-xs text-[#FAFBF8] shadow-xl backdrop-blur-md"
            >
              <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-[#E8B948]" aria-hidden="true" />
              <span dir="auto" className="leading-relaxed">
                {audioToast}
              </span>
              <button
                type="button"
                onClick={() => setAudioToast(null)}
                aria-label="Dismiss audio notification"
                className="ml-1 rounded-md p-0.5 text-[#DCE5D3] hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {!isNotesOpen && (
            <button
              type="button"
              onClick={() => handleOpenNotes()}
              aria-label={`Open My Notes (${studyNotes.length} saved)`}
              className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 sm:right-5 z-30 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#DCE5D3] bg-white/95 px-4 py-2 text-xs font-semibold text-[#2D3B22] shadow-lg backdrop-blur-xs hover:border-[#D4A338] hover:bg-[#FAFBF8] transition-all cursor-pointer touch-manipulation active:scale-95"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FBF3DC] text-[#9A6F14]">
                <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span dir="rtl" lang="ar" className="font-arabic-cairo text-sm font-bold leading-none text-[#2D3B22]">
                ملاحظاتي
              </span>
              {studyNotes.length > 0 && (
                <span className="font-mono text-[11px] font-bold tabular-nums text-[#9A6F14]">
                  ({studyNotes.length})
                </span>
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SparklesIconFallback() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
    </svg>
  );
}
