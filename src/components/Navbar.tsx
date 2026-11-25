import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Crown,
  Feather,
  Flame,
  History,
  LogIn,
  LogOut,
  Minus,
  NotebookPen,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  WifiOff,
} from 'lucide-react';
import { ActiveTab, AuthUser, ProficiencyLevel, VocabCard } from '../types/arabic';
import { getUserInitials, isAdminUser, isPrimaryOwnerEmail } from '../utils/auth';
import { computeWordsToday, GOAL_PRESETS } from './DailyGoalCard';
import { PWAInstallButton } from './PWAInstallButton';
import type { DailyStudyLog } from './WeeklyVocabChart';

const NAVBAR_LEVEL_META: Array<{
  level: ProficiencyLevel;
  ar: string;
  en: string;
  descAr: string;
}> = [
  { level: 'beginner', ar: 'مبتدئ', en: 'Beginner', descAr: 'نصوصٌ مبسّطةٌ ومفرداتٌ يوميّةٌ' },
  { level: 'intermediate', ar: 'متوسط', en: 'Intermediate', descAr: 'نصوصٌ ثقافيّةٌ وتراكيبُ متوسّطةٌ' },
  { level: 'advanced', ar: 'متقدم', en: 'Advanced', descAr: 'نصوصٌ أدبيّةٌ وبلاغيّةٌ معمّقةٌ' },
];

interface NavbarProps {
  activeTab: ActiveTab;
  activeNavSection: 'home' | 'history' | 'levels' | 'vocabulary' | 'exams' | 'conversation';
  selectedLevel: ProficiencyLevel;
  onSelectLevel: (level: ProficiencyLevel) => void;
  levelCounts?: Record<ProficiencyLevel, number>;
  pendingDraftsCount?: number;
  onSelectHome: () => void;
  onSelectHistory: () => void;
  onSelectLevels: () => void;
  onSelectTab: (tab: ActiveTab) => void;
  vocabCount: number;
  historyCount: number;
  currentUser: AuthUser | null;
  canAddContent: boolean;
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onOpenAddLesson: () => void;
  onOpenUserManagement?: () => void;
  onLogout: () => void;
  notesCount: number;
  onOpenNotes: () => void;
  dailyWordGoal: number;
  onChangeDailyGoal: (nextGoal: number) => void;
  vocabCards: VocabCard[];
  todayLog?: DailyStudyLog;
  todayKey: string;
}

export function Navbar({
  activeTab,
  activeNavSection,
  selectedLevel,
  onSelectLevel,
  levelCounts,
  pendingDraftsCount = 0,
  onSelectHome,
  onSelectHistory,
  onSelectTab,
  vocabCount,
  currentUser,
  canAddContent,
  onOpenAuth,
  onOpenAddLesson,
  onOpenUserManagement,
  onLogout,
  notesCount,
  onOpenNotes,
  dailyWordGoal,
  onChangeDailyGoal,
  vocabCards,
  todayLog,
  todayKey,
}: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [goalPopoverOpen, setGoalPopoverOpen] = useState(false);
  const [levelMenuOpen, setLevelMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [statusNoteOpen, setStatusNoteOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const goalRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);
  const mobileLevelDropdownRef = useRef<HTMLDivElement>(null);
  const mobileLevelTriggerRef = useRef<HTMLButtonElement>(null);

  const activeLevelInfo =
    NAVBAR_LEVEL_META.find((item) => item.level === selectedLevel) ?? NAVBAR_LEVEL_META[0];

  const safeGoal = Math.max(1, Math.min(50, dailyWordGoal));
  const wordsToday = useMemo(
    () => computeWordsToday(vocabCards, todayLog, todayKey),
    [vocabCards, todayLog, todayKey]
  );
  const goalRatio = Math.min(1, wordsToday / safeGoal);
  const goalPct = Math.round(goalRatio * 100);
  const goalRemaining = Math.max(0, safeGoal - wordsToday);
  const isGoalReached = wordsToday >= safeGoal;

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setStatusNoteOpen(false);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setStatusNoteOpen(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen && !statusNoteOpen && !goalPopoverOpen && !levelMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (goalRef.current && !goalRef.current.contains(target)) {
        setGoalPopoverOpen(false);
      }
      if (statusRef.current && !statusRef.current.contains(target)) {
        setStatusNoteOpen(false);
      }
      const inDesktopLevel = levelRef.current?.contains(target);
      const inMobileDropdown = mobileLevelDropdownRef.current?.contains(target);
      const inMobileTrigger = mobileLevelTriggerRef.current?.contains(target);
      if (!inDesktopLevel && !inMobileDropdown && !inMobileTrigger) {
        setLevelMenuOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setGoalPopoverOpen(false);
        setStatusNoteOpen(false);
        setLevelMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen, statusNoteOpen, goalPopoverOpen, levelMenuOpen]);

  const isLessonsActive =
    activeTab === 'lessons' ||
    activeNavSection === 'home' ||
    activeNavSection === 'levels';
  const isVocabActive = activeTab === 'vocabulary';
  const isExamsActive = activeTab === 'exams';
  const isConversationActive = activeTab === 'conversation';

  if (!currentUser) {
    return (
      <header
        dir="ltr"
        className="sticky top-0 z-40 pt-[env(safe-area-inset-top)] border-b border-[#3E522D]/80 bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] text-[#FAFBF8] shadow-[0_4px_20px_-6px_rgba(36,48,27,0.45)]"
      >
        <div className="mx-auto flex h-14 sm:h-16 max-w-6xl items-center justify-between gap-3 sm:gap-8 px-3 sm:px-6 lg:px-8">
          {/* Left: Auth Actions + Optional PWA Install */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuth('register')}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#D4A338] to-[#E8B948] px-3.5 py-1.5 text-xs sm:text-sm font-bold text-[#1F2718] transition-all hover:brightness-105 shadow-xs whitespace-nowrap shrink-0 cursor-pointer touch-manipulation active:scale-[0.98]"
            >
              <span>Get Started</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs sm:text-sm font-medium text-[#FAFBF8] hover:bg-white/15 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation active:scale-[0.98]"
            >
              <LogIn className="h-3.5 w-3.5 text-[#E8B948]" aria-hidden="true" />
              <span>Sign In</span>
            </button>

            <PWAInstallButton variant="header" />
          </div>

          {/* Middle: Clean Landing Section Links */}
          <nav
            aria-label="Landing navigation"
            className="hidden sm:flex items-center justify-center gap-7 text-sm font-medium"
          >
            <a
              href="#features"
              className="text-[#DCE5D3]/90 hover:text-[#E8B948] transition-colors whitespace-nowrap shrink-0"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-[#DCE5D3]/90 hover:text-[#E8B948] transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
          </nav>

          {/* Right: Brand Wordmark */}
          <button
            type="button"
            onClick={onSelectHome}
            aria-label="Qalam Arabic Home"
            className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8B948] rounded-xl px-1.5 py-1"
          >
            <span
              dir="rtl"
              lang="ar"
              className="hidden sm:inline font-arabic-scheherazade text-2xl font-bold text-[#E8B948] leading-none"
            >
              قَلَم
            </span>
            <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-white">
              Qalam
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#D4A338] to-[#E8B948] text-[#1F2718] shadow-xs">
              <Feather className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        </div>
      </header>
    );
  }

  return (
    <header
      dir="ltr"
      className="sticky top-0 z-40 pt-[env(safe-area-inset-top)] border-b border-[#3E522D]/80 bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] text-[#FAFBF8] shadow-[0_4px_20px_-6px_rgba(36,48,27,0.45)]"
    >
      <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between gap-2 sm:gap-4 px-2.5 sm:px-5 lg:px-8">
        {/* Left Zone: User Menu + High-Contrast "الهدف اليومي" Badge + PWA + Connection */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Account Menu */}
          <div className="relative flex items-center" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-2 sm:px-2.5 py-1.5 text-sm font-medium text-[#FAFBF8] hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#D4A338] to-[#E8B948] text-xs font-bold text-[#1F2718] shadow-2xs">
                {getUserInitials(currentUser.name)}
              </span>
              <span className="hidden xl:inline max-w-[100px] truncate font-semibold text-white">
                {currentUser.name}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-[#DCE5D3]" aria-hidden="true" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="animate-popover-in absolute left-0 top-12 z-50 w-64 rounded-2xl border border-[#DCE5D3] bg-white p-2 text-[#1F2718] shadow-xl"
              >
                <div className="border-b border-[#DCE5D3] px-3 py-2.5">
                  <p className="text-sm font-bold text-[#1F2718] truncate">
                    {currentUser.name}
                  </p>
                  <p className="text-xs text-[#5A6552] truncate">{currentUser.email}</p>
                  {isPrimaryOwnerEmail(currentUser.email) ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-[#FACC15]/60 bg-[#16200F] px-2 py-0.5 text-[10px] font-bold text-[#FACC15]">
                      <Crown className="h-3 w-3" aria-hidden="true" />
                      <span>المالك الرئيسي / Primary Admin</span>
                    </span>
                  ) : isAdminUser(currentUser) ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#EEF2E9] px-2 py-0.5 text-[10px] font-bold text-[#2D3B22]">
                      <ShieldCheck className="h-3 w-3 text-[#3B4D2B]" aria-hidden="true" />
                      <span>أدمن · Admin</span>
                    </span>
                  ) : currentUser.role === 'moderator' ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#FBF3DC] px-2 py-0.5 text-[10px] font-bold text-[#9A6F14]">
                      <span>مشرف · Moderator</span>
                    </span>
                  ) : (
                    <p className="mt-1 font-arabic-cairo text-[11px] font-semibold text-[#9A6F14]">
                      {currentUser.isGuest
                        ? 'Guest Demo Session · جلسة تجريبية'
                        : 'طالب · Student Account'}
                    </p>
                  )}
                </div>

                <div className="pt-1.5 space-y-1">
                  {isAdminUser(currentUser) && onOpenUserManagement && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenUserManagement();
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#16200F] text-[#FACC15]">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <span className="truncate">الإدارة · Admin Panel</span>
                      </span>
                      {pendingDraftsCount > 0 && (
                        <span className="rounded-md bg-[#2D3B22] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#FACC15] shrink-0">
                          {pendingDraftsCount} drafts
                        </span>
                      )}
                    </button>
                  )}

                  {canAddContent && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenAddLesson();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#FBF3DC] text-[#9A6F14]">
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span>إضافة نص جديد (Add New Text)</span>
                    </button>
                  )}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenNotes();
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold text-[#1F2718] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#2D3B22]">
                        <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span>ملاحظاتي (My Notes)</span>
                    </span>
                    {notesCount > 0 && (
                      <span className="font-mono text-[11px] font-bold text-[#9A6F14] tabular-nums">
                        {notesCount}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onSelectHistory();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-[#1F2718] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#2D3B22]">
                      <History className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span>Reading History</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenAuth('login');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-[#1F2718] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#EEF2E9] text-[#2D3B22]">
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span>Switch Account</span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-amber-800 hover:bg-[#FEF7E6] transition-colors cursor-pointer"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#FEF7E6] text-amber-800">
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* High-Contrast "الهدف اليومي | Daily Goal" Dark Olive & Bright Lemon-Gold Pill */}
          <div className="relative flex items-center" ref={goalRef}>
            <button
              type="button"
              onClick={() => setGoalPopoverOpen((prev) => !prev)}
              aria-expanded={goalPopoverOpen}
              aria-label={`الهدف اليومي Daily Goal: ${wordsToday} of ${safeGoal} words today (${goalPct}%). Click to customize target.`}
              title="الهدف اليومي · My Daily Goal"
              className={`group relative overflow-hidden inline-flex items-center gap-1.5 sm:gap-2 rounded-full border bg-[#16200F] px-2.5 sm:px-3 pt-1.5 pb-2 text-xs font-semibold text-[#FAFBF8] shadow-[0_2px_10px_rgba(0,0,0,0.28)] transition-all duration-200 whitespace-nowrap shrink-0 cursor-pointer touch-manipulation active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] ${
                isGoalReached
                  ? 'border-[#FACC15] animate-goal-celebrate hover:bg-[#233018]'
                  : 'border-[#FACC15]/55 hover:border-[#FEF08A] hover:bg-[#233018] hover:shadow-[0_4px_16px_-4px_rgba(250,204,21,0.4)]'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-transform duration-200 group-hover:scale-105 ${
                  isGoalReached
                    ? 'border-[#FEF08A]/80 bg-[#FACC15]/30 text-[#FEF08A]'
                    : 'border-[#FACC15]/55 bg-[#FACC15]/20 text-[#FACC15]'
                }`}
              >
                <Flame className="h-3.5 w-3.5 fill-[#FACC15]/35 text-[#FACC15]" aria-hidden="true" />
              </span>

              <span
                dir="rtl"
                lang="ar"
                className="hidden sm:inline font-arabic-cairo text-xs font-bold leading-none text-[#FEF08A]"
              >
                الهدف اليومي
              </span>

              <span className="font-mono text-[11px] font-bold tabular-nums text-[#FACC15]">
                {wordsToday}/{safeGoal}
              </span>

              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-3 bottom-0.5 h-[2.5px] overflow-hidden rounded-full bg-white/15"
              >
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-[#FACC15] to-[#FEF08A] transition-all duration-500 ease-out"
                  style={{ width: `${goalPct}%` }}
                />
              </span>
            </button>

            {goalPopoverOpen && (
              <div
                role="dialog"
                aria-label="Customize My Daily Goal"
                className="animate-popover-in fixed sm:absolute left-3 right-3 sm:left-0 sm:right-auto top-[4.25rem] sm:top-11 z-50 sm:w-80 rounded-2xl border border-[#DCE5D3] bg-white p-4 text-[#1F2718] shadow-2xl space-y-3.5"
              >
                <div className="flex items-start justify-between gap-3 border-b border-[#EEF2E9] pb-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isGoalReached
                          ? 'bg-[#FACC15] text-[#16200F]'
                          : 'bg-[#16200F] text-[#FACC15] border border-[#FACC15]/60'
                      }`}
                    >
                      <Target className="h-4.5 w-4.5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <p className="font-display text-sm font-bold text-[#1F2718]">
                          Daily Goal
                        </p>
                        <span
                          dir="rtl"
                          lang="ar"
                          className="font-arabic-cairo text-xs font-bold text-[#2D3B22]"
                        >
                          الهدف اليومي
                        </span>
                      </div>
                      <p className="text-[11px] text-[#5A6552]">
                        {isGoalReached ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#2D3B22]">
                            <CheckCircle2 className="h-3 w-3 text-[#D4A338]" aria-hidden="true" />
                            <span>أحسنتَ! أنجزتَ هدفكَ اليوميَّ</span>
                          </span>
                        ) : (
                          <span>
                            <strong className="font-mono text-[#9A6F14]">{goalRemaining}</strong>{' '}
                            {goalRemaining === 1 ? 'word' : 'words'} left today
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold tabular-nums rounded-lg bg-[#EEF2E9] px-2 py-1 text-[#2D3B22]">
                    {goalPct}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#5A6552]">
                    <span>Today&apos;s words</span>
                    <span className="font-bold text-[#1F2718]">
                      {wordsToday} / {safeGoal}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#EEF2E9]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#FACC15] to-[#3B4D2B] transition-all duration-500 ease-out"
                      style={{ width: `${goalPct}%` }}
                    />
                  </div>
                </div>

                {/* Stepper & Presets */}
                <div className="space-y-2 border-t border-[#EEF2E9] pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#2D3B22]">Daily word target</span>
                    <div className="inline-flex items-center gap-1 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9] p-0.5">
                      <button
                        type="button"
                        onClick={() => onChangeDailyGoal(Math.max(1, safeGoal - 1))}
                        aria-label="Decrease daily word target"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#2D3B22] hover:bg-white cursor-pointer"
                      >
                        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <span className="w-8 text-center font-mono text-xs font-bold tabular-nums text-[#1F2718]">
                        {safeGoal}
                      </span>
                      <button
                        type="button"
                        onClick={() => onChangeDailyGoal(Math.min(50, safeGoal + 1))}
                        aria-label="Increase daily word target"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#2D3B22] hover:bg-white cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {GOAL_PRESETS.map((preset) => {
                      const selected = safeGoal === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => onChangeDailyGoal(preset)}
                          className={`rounded-xl border py-1.5 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                            selected
                              ? 'border-[#2D3B22] bg-[#2D3B22] text-white shadow-xs'
                              : 'border-[#DCE5D3] bg-white text-[#2D3B22] hover:border-[#D4A338] hover:bg-[#FBF3DC]/60'
                          }`}
                        >
                          {preset}/d
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {isAdminUser(currentUser) && onOpenUserManagement && (
            <button
              type="button"
              onClick={onOpenUserManagement}
              title="لوحة الإدارة والفحص الذكي · Admin Panel"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#FACC15]/60 bg-[#16200F] px-2.5 py-1.5 text-xs font-bold text-[#FEF08A] hover:bg-[#233018] hover:border-[#FACC15] transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15]"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
              <span dir="rtl" lang="ar" className="font-arabic-cairo">
                الإدارة
              </span>
              <span className="hidden lg:inline text-[11px] text-[#DCE5D3]">/ Admin</span>
            </button>
          )}

          <PWAInstallButton variant="header" />

          {/* Subtle Connection Status Dot */}
          <div className="relative hidden md:flex items-center" ref={statusRef}>
            <button
              type="button"
              onClick={() => setStatusNoteOpen((prev) => !prev)}
              aria-label={
                isOnline
                  ? 'Connection online: AI features available'
                  : 'Connection lost: AI features are currently unavailable (cached mode active)'
              }
              aria-expanded={statusNoteOpen}
              title={
                isOnline
                  ? 'Online · Study workspace active'
                  : 'Offline · Cached study mode active'
              }
              className={`inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] ${
                isOnline
                  ? 'text-[#DCE5D3] hover:bg-white/10'
                  : 'bg-[#FACC15]/20 text-[#FEF08A] border border-[#FACC15]/60 hover:bg-[#FACC15]/30'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full shrink-0 ${
                  isOnline
                    ? 'bg-[#A7C48B]'
                    : 'bg-[#FACC15] ring-2 ring-[#FACC15]/35 animate-pulse'
                }`}
              />
              {!isOnline && (
                <span className="hidden lg:inline whitespace-nowrap font-semibold text-[#FEF08A]">
                  Offline
                </span>
              )}
            </button>

            {statusNoteOpen && (
              <div
                role="status"
                aria-live="polite"
                className={`animate-popover-in absolute left-0 top-10 z-50 w-72 rounded-xl border p-3.5 text-xs shadow-xl ${
                  isOnline
                    ? 'border-[#DCE5D3] bg-white text-[#1F2718]'
                    : 'border-[#E8B948] bg-[#FEF9EC] text-[#5C4107]'
                }`}
              >
                {isOnline ? (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#3E522D] shrink-0" aria-hidden="true" />
                    <span>Connected — Live translations, audio &amp; AI exams ready.</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5">
                    <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-[#D4A338]" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="font-bold text-[#2D3B22]">Offline Cache Active</p>
                      <p className="text-[11px] leading-relaxed text-[#5A6552]">
                        Static assets, saved vocabulary, and built-in reading lessons are cached
                        and ready to study offline.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center Zone (Desktop & Tablet >= md): Primary 5 Navigation Items */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex min-w-0 flex-1 items-center justify-center gap-4 lg:gap-6 text-xs lg:text-sm font-medium overflow-visible px-1"
        >
          <div className="relative flex flex-col items-center shrink-0" ref={levelRef}>
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => {
                  onSelectTab('lessons');
                }}
                title="الدروس · Lessons"
                className={`relative pt-2.5 pb-0.5 px-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] ${
                  isLessonsActive
                    ? 'text-[#FEF08A] font-bold'
                    : 'text-[#DCE5D3] hover:text-white'
                }`}
              >
                <span className="font-arabic-cairo">الدروس</span>
                <span className="hidden xl:inline ml-1.5 text-xs opacity-80">Lessons</span>
              </button>

              <button
                type="button"
                onClick={() => setLevelMenuOpen((prev) => !prev)}
                aria-expanded={levelMenuOpen}
                aria-label={`Selected level: ${activeLevelInfo.ar} (${activeLevelInfo.en}). Switch level`}
                className={`mb-1.5 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold leading-none transition-colors cursor-pointer ${
                  levelMenuOpen || isLessonsActive
                    ? 'border-[#FACC15]/70 bg-[#16200F] text-[#FACC15]'
                    : 'border-white/20 bg-[#16200F]/65 text-[#FEF08A] hover:border-[#FACC15]/60'
                }`}
              >
                <span dir="rtl" lang="ar" className="font-arabic-cairo">
                  {activeLevelInfo.ar}
                </span>
                <ChevronDown
                  className={`h-2.5 w-2.5 transition-transform duration-150 ${
                    levelMenuOpen ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>

            {isLessonsActive && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 left-0 right-0 h-0.5 bg-[#FACC15]"
              />
            )}

            {levelMenuOpen && (
              <div
                role="menu"
                aria-label="Switch Arabic proficiency level"
                className="animate-popover-in absolute left-1/2 top-full mt-1.5 z-50 w-72 -translate-x-1/2 rounded-2xl border border-[#3E522D] bg-[#24301B] p-2 text-[#FAFBF8] shadow-2xl"
              >
                <div className="px-2.5 py-1.5 border-b border-white/10 mb-1 flex items-center justify-between text-[11px] text-[#DCE5D3]">
                  <span>اختر المستوى · Switch Level</span>
                  <span className="font-arabic-cairo font-bold text-[#FACC15]">
                    {activeLevelInfo.ar}
                  </span>
                </div>
                <div className="space-y-1">
                  {NAVBAR_LEVEL_META.map((item) => {
                    const isSelected = selectedLevel === item.level;
                    const count = levelCounts?.[item.level];
                    return (
                      <button
                        key={item.level}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        onClick={() => {
                          onSelectLevel(item.level);
                          onSelectTab('lessons');
                          setLevelMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#3B4D2B] border border-[#FACC15]/65 text-white'
                            : 'border border-transparent hover:bg-white/10 text-[#DCE5D3]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              dir="rtl"
                              lang="ar"
                              className={`font-arabic-cairo text-xs font-bold ${
                                isSelected ? 'text-[#FACC15]' : 'text-white'
                              }`}
                            >
                              {item.ar}
                            </span>
                            <span className="text-xs font-semibold">{item.en}</span>
                          </div>
                          <p
                            dir="rtl"
                            lang="ar"
                            className="font-arabic-cairo text-[10px] text-[#DCE5D3]/80 truncate mt-0.5"
                          >
                            {item.descAr}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {typeof count === 'number' && (
                            <span className="font-mono text-[10px] font-bold text-[#FACC15] tabular-nums">
                              {count}
                            </span>
                          )}
                          {isSelected && (
                            <CheckCircle2
                              className="h-3.5 w-3.5 text-[#FACC15]"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => onSelectTab('vocabulary')}
            title="مفرداتي · Vocabulary"
            className={`relative py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] ${
              isVocabActive
                ? 'text-[#FEF08A] font-bold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#FACC15]'
                : 'text-[#DCE5D3] hover:text-white'
            }`}
          >
            <span className="font-arabic-cairo">مفرداتي</span>
            <span className="hidden xl:inline ml-1.5 text-xs opacity-80">Vocabulary</span>
            {vocabCount > 0 && (
              <span className="ml-1 font-mono text-[11px] tabular-nums text-[#FACC15] font-semibold">
                ({vocabCount})
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('exams')}
            title="الامتحانات · Exams"
            className={`relative py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] ${
              isExamsActive
                ? 'text-[#FEF08A] font-bold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#FACC15]'
                : 'text-[#DCE5D3] hover:text-white'
            }`}
          >
            <span className="font-arabic-cairo">الامتحانات</span>
            <span className="hidden xl:inline ml-1.5 text-xs opacity-80">Exams</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('conversation')}
            title="المحادثة · Conversation"
            className={`relative py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] ${
              isConversationActive
                ? 'text-[#FEF08A] font-bold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#FACC15]'
                : 'text-[#DCE5D3] hover:text-white'
            }`}
          >
            <span className="font-arabic-cairo">المحادثة</span>
            <span className="hidden xl:inline ml-1.5 text-xs opacity-80">Conversation</span>
          </button>

          <button
            type="button"
            onClick={onOpenNotes}
            title="ملاحظاتي · My Notes"
            className="relative py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation text-[#DCE5D3] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15]"
          >
            <span className="font-arabic-cairo">ملاحظاتي</span>
            <span className="hidden xl:inline ml-1.5 text-xs opacity-80">My Notes</span>
            {notesCount > 0 && (
              <span className="ml-1 font-mono text-[11px] tabular-nums text-[#FACC15] font-semibold">
                ({notesCount})
              </span>
            )}
          </button>
        </nav>

        {/* Right Zone: Brand Wordmark */}
        <button
          type="button"
          onClick={onSelectHome}
          aria-label="Qalam Arabic Home"
          className="inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] rounded-xl px-1 py-1"
        >
          <span
            dir="rtl"
            lang="ar"
            className="font-arabic-scheherazade text-xl sm:text-2xl font-bold text-[#FACC15] leading-none"
          >
            قَلَم
          </span>
          <span className="hidden sm:inline font-display text-lg font-bold tracking-tight text-white">
            Qalam
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#D4A338] to-[#E8B948] text-[#1F2718] shadow-xs">
            <Feather className="h-4 w-4" aria-hidden="true" />
          </span>
        </button>
      </div>

      {/* Responsive Mobile & Narrow-Screen Navigation Sub-Row (all 5 tabs cleanly visible without clipping) */}
      <nav
        aria-label="Mobile navigation"
        className="flex md:hidden items-center justify-between gap-1 border-t border-white/10 bg-[#16200F]/85 px-2.5 overflow-x-auto touch-pan-x no-scrollbar text-xs font-medium"
      >
        <div className="relative flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onSelectTab('lessons')}
            className={`relative py-2 px-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation flex flex-col items-center leading-tight ${
              isLessonsActive
                ? 'text-[#FEF08A] font-bold after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:bg-[#FACC15]'
                : 'text-[#DCE5D3] hover:text-white'
            }`}
          >
            <span className="font-arabic-cairo">الدروس</span>
            <span className="text-[10px] font-bold text-[#FACC15] leading-none mt-0.5">
              {activeLevelInfo.ar}
            </span>
          </button>

          <button
            ref={mobileLevelTriggerRef}
            type="button"
            onClick={() => setLevelMenuOpen((prev) => !prev)}
            aria-expanded={levelMenuOpen}
            aria-label={`Switch level (current: ${activeLevelInfo.ar})`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#FACC15]/45 bg-[#24301B] text-[#FACC15] cursor-pointer touch-manipulation"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-150 ${
                levelMenuOpen ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </button>
        </div>

        <button
          type="button"
          onClick={() => onSelectTab('vocabulary')}
          className={`relative py-2.5 px-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation ${
            isVocabActive
              ? 'text-[#FEF08A] font-bold after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:bg-[#FACC15]'
              : 'text-[#DCE5D3] hover:text-white'
          }`}
        >
          <span className="font-arabic-cairo">مفرداتي</span>
          {vocabCount > 0 && (
            <span className="ml-1 font-mono text-[10px] tabular-nums text-[#FACC15] font-semibold">
              ({vocabCount})
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('exams')}
          className={`relative py-2.5 px-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation ${
            isExamsActive
              ? 'text-[#FEF08A] font-bold after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:bg-[#FACC15]'
              : 'text-[#DCE5D3] hover:text-white'
          }`}
        >
          <span className="font-arabic-cairo">الامتحانات</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('conversation')}
          className={`relative py-2.5 px-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation ${
            isConversationActive
              ? 'text-[#FEF08A] font-bold after:absolute after:bottom-0 after:left-1 after:right-1 after:h-0.5 after:bg-[#FACC15]'
              : 'text-[#DCE5D3] hover:text-white'
          }`}
        >
          <span className="font-arabic-cairo">المحادثة</span>
        </button>

        <button
          type="button"
          onClick={onOpenNotes}
          className="relative py-2.5 px-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation text-[#DCE5D3] hover:text-white"
        >
          <span className="font-arabic-cairo">ملاحظاتي</span>
          {notesCount > 0 && (
            <span className="ml-1 font-mono text-[10px] tabular-nums text-[#FACC15] font-semibold">
              ({notesCount})
            </span>
          )}
        </button>
      </nav>

      {/* Mobile Non-Clipped Level Switcher Popover */}
      {levelMenuOpen && (
        <div
          ref={mobileLevelDropdownRef}
          role="menu"
          aria-label="Mobile level switcher"
          className="animate-popover-in md:hidden border-t border-[#FACC15]/30 bg-[#24301B] px-3 py-2.5 shadow-xl"
        >
          <div className="grid grid-cols-3 gap-2">
            {NAVBAR_LEVEL_META.map((item) => {
              const isSelected = selectedLevel === item.level;
              const count = levelCounts?.[item.level];
              return (
                <button
                  key={item.level}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={() => {
                    onSelectLevel(item.level);
                    onSelectTab('lessons');
                    setLevelMenuOpen(false);
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition-colors cursor-pointer touch-manipulation ${
                    isSelected
                      ? 'border-[#FACC15] bg-[#3B4D2B] text-white'
                      : 'border-white/15 bg-[#16200F]/60 text-[#DCE5D3] hover:bg-white/10'
                  }`}
                >
                  <span
                    dir="rtl"
                    lang="ar"
                    className={`font-arabic-cairo text-xs font-bold ${
                      isSelected ? 'text-[#FACC15]' : 'text-white'
                    }`}
                  >
                    {item.ar}
                  </span>
                  <span className="text-[10px] font-medium opacity-85">
                    {item.en}
                    {typeof count === 'number' ? ` (${count})` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
