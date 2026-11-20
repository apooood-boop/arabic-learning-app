import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Feather,
  History,
  LogIn,
  LogOut,
  NotebookPen,
  Plus,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { ActiveTab, AuthUser } from '../types/arabic';
import { getUserInitials } from '../utils/auth';
import { PWAInstallButton } from './PWAInstallButton';

interface NavbarProps {
  activeTab: ActiveTab;
  activeNavSection: 'home' | 'history' | 'levels' | 'vocabulary' | 'practice';
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
  onLogout: () => void;
  notesCount: number;
  onOpenNotes: () => void;
}

export function Navbar({
  activeTab,
  activeNavSection,
  onSelectHome,
  onSelectHistory,
  onSelectLevels,
  onSelectTab,
  vocabCount,
  historyCount,
  currentUser,
  canAddContent,
  onOpenAuth,
  onOpenAddLesson,
  onLogout,
  notesCount,
  onOpenNotes,
}: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [statusNoteOpen, setStatusNoteOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

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
    if (!menuOpen && !statusNoteOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusNoteOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        setStatusNoteOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen, statusNoteOpen]);

  const isHomeActive = activeTab === 'lessons' && activeNavSection === 'home';
  const isHistoryActive = activeTab === 'history' || activeNavSection === 'history';
  const isLevelsActive = activeTab === 'lessons' && activeNavSection === 'levels';
  const isVocabActive = activeTab === 'vocabulary';
  const isPracticeActive = activeTab === 'practice';

  if (!currentUser) {
    return (
      <header
        dir="ltr"
        className="sticky top-0 z-40 pt-[env(safe-area-inset-top)] border-b border-[#581C87] bg-gradient-to-r from-[#3B0764] via-[#4C1D95] to-[#581C87] text-[#FDFBFC] shadow-[0_2px_14px_-4px_rgba(76,29,149,0.35)]"
      >
        <div className="mx-auto flex h-14 sm:h-16 max-w-6xl items-center justify-between gap-3 sm:gap-8 px-3 sm:px-6 lg:px-8">
          {/* Left: Auth Actions + Optional PWA Install */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuth('register')}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#E11D48] to-[#F43F5E] px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white transition-all hover:from-[#BE123C] hover:to-[#E11D48] shadow-2xs whitespace-nowrap shrink-0 cursor-pointer touch-manipulation"
            >
              <span>Get Started</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenAuth('login')}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs sm:text-sm font-medium text-purple-100 hover:bg-white/15 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation"
            >
              <LogIn className="h-3.5 w-3.5 text-rose-200" aria-hidden="true" />
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
              className="text-purple-100/85 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-purple-100/85 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
          </nav>

          {/* Right: Brand Wordmark */}
          <button
            type="button"
            onClick={onSelectHome}
            aria-label="Qalam Arabic Home"
            className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] rounded-xl px-1.5 py-1"
          >
            <span
              dir="rtl"
              lang="ar"
              className="hidden sm:inline font-arabic-scheherazade text-2xl font-bold text-rose-200 leading-none"
            >
              قَلَم
            </span>
            <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-white">
              Qalam
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#E11D48] to-[#F43F5E] text-white shadow-2xs">
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
      className="sticky top-0 z-40 pt-[env(safe-area-inset-top)] border-b border-[#581C87] bg-gradient-to-r from-[#3B0764] via-[#4C1D95] to-[#581C87] text-[#FDFBFC] shadow-[0_2px_14px_-4px_rgba(76,29,149,0.35)]"
    >
      <div className="mx-auto flex h-14 sm:h-16 max-w-6xl items-center justify-between gap-2 sm:gap-4 px-3 sm:px-6 lg:px-8">
        {/* Far Left: User Auth / Profile Button + Connection Dot Indicator */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <div className="relative flex items-center" ref={menuRef}>
            {currentUser ? (
              <>
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-sm font-medium text-[#FDFBFC] hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E]"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#E11D48] to-[#F43F5E] text-xs font-bold text-white shadow-2xs">
                    {getUserInitials(currentUser.name)}
                  </span>
                  <span className="hidden sm:inline max-w-[125px] truncate font-semibold text-white">
                    {currentUser.name}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-purple-200" aria-hidden="true" />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="animate-popover-in absolute left-0 top-12 z-50 w-64 rounded-2xl border border-[#ECE8EF] bg-white p-2 text-[#241734] shadow-xl"
                  >
                    <div className="border-b border-[#ECE8EF] px-3 py-2.5">
                      <p className="text-sm font-bold text-[#241734] truncate">
                        {currentUser.name}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">{currentUser.email}</p>
                      <p className="mt-1 text-[11px] font-semibold text-[#E11D48]">
                        {currentUser.isGuest
                          ? 'Guest Demo Session'
                          : currentUser.role === 'teacher'
                            ? 'Teacher Account'
                            : 'Student Account'}
                      </p>
                    </div>

                    <div className="pt-1.5 space-y-1">
                      {canAddContent && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            onOpenAddLesson();
                          }}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-[#E11D48] hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
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
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-[#F7F4F9] transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <NotebookPen className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
                          <span>ملاحظاتي (My Notes)</span>
                        </span>
                        {notesCount > 0 && (
                          <span className="font-mono text-[11px] font-bold text-[#4C1D95]">
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
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-[#F7F4F9] transition-colors cursor-pointer"
                      >
                        <History className="h-3.5 w-3.5 text-[#4C1D95]" aria-hidden="true" />
                        <span>Reading History</span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenAuth('login');
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-[#F7F4F9] transition-colors cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-[#4C1D95]" aria-hidden="true" />
                        <span>Switch Account</span>
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onLogout();
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#E11D48] to-[#F43F5E] px-3.5 py-2 text-xs sm:text-sm font-semibold text-white transition-all hover:from-[#BE123C] hover:to-[#E11D48] shadow-2xs whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              >
                <LogIn className="h-4 w-4 shrink-0 text-white" aria-hidden="true" />
                <span>Sign In</span>
              </button>
            )}
          </div>

          {/* My Notes Quick-Access Button */}
          <button
            type="button"
            onClick={onOpenNotes}
            title="ملاحظاتي · My Notes"
            aria-label={`Open My Notes (${notesCount} saved)`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-purple-100 hover:bg-white/15 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation"
          >
            <NotebookPen className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
            <span className="hidden lg:inline">ملاحظاتي</span>
            {notesCount > 0 && (
              <span className="font-mono text-[11px] tabular-nums text-rose-200 font-bold">
                ({notesCount})
              </span>
            )}
          </button>

          {/* In-app PWA Install Prompt (hidden in standalone mode) */}
          <PWAInstallButton variant="header" />

          {/* Subtle Connection Status Dot */}
          <div className="relative flex items-center" ref={statusRef}>
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
                  ? 'Online · AI features ready'
                  : 'Offline · AI features are currently unavailable (offline cache active)'
              }
              className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
                isOnline
                  ? 'text-purple-200 hover:bg-white/10'
                  : 'bg-amber-500/20 text-amber-200 border border-amber-400/60 hover:bg-amber-500/30'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full shrink-0 ${
                  isOnline
                    ? 'bg-purple-200/80'
                    : 'bg-amber-400 ring-2 ring-amber-400/35 animate-pulse'
                }`}
              />
              {!isOnline && (
                <span className="hidden md:inline whitespace-nowrap font-semibold text-amber-200">
                  Offline · Cached
                </span>
              )}
            </button>

            {statusNoteOpen && (
              <div
                role="status"
                aria-live="polite"
                className={`animate-popover-in absolute left-0 top-10 z-50 w-72 rounded-xl border p-3.5 text-xs shadow-xl ${
                  isOnline
                    ? 'border-[#ECE8EF] bg-white text-zinc-700'
                    : 'border-amber-300 bg-[#FFFBEB] text-amber-950'
                }`}
              >
                {isOnline ? (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#E11D48] shrink-0" aria-hidden="true" />
                    <span>Connected — Live AI translations and quizzes are active.</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5">
                    <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="font-bold text-amber-900">Offline Cache Active</p>
                      <p className="text-[11px] leading-relaxed text-zinc-600">
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

        {/* Middle: Primary Navigation Links (Home, Reading History, My Vocabulary, Levels) */}
        <nav
          aria-label="Primary navigation"
          className="flex items-center justify-start sm:justify-center gap-3.5 sm:gap-7 text-xs sm:text-sm font-medium overflow-x-auto touch-pan-x no-scrollbar"
        >
          <button
            type="button"
            onClick={onSelectHome}
            className={`relative py-4 sm:py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
              isHomeActive
                ? 'text-rose-200 font-bold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#F43F5E]'
                : 'text-purple-100/85 hover:text-white'
            }`}
          >
            Home
          </button>

          <button
            type="button"
            onClick={onSelectHistory}
            className={`relative py-4 sm:py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
              isHistoryActive
                ? 'text-rose-200 font-bold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#F43F5E]'
                : 'text-purple-100/85 hover:text-white'
            }`}
          >
            <span>Reading History</span>
            {historyCount > 0 && (
              <span className="ml-1.5 font-mono text-xs tabular-nums text-rose-200 font-semibold">
                ({historyCount})
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('vocabulary')}
            className={`relative py-4 sm:py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
              isVocabActive
                ? 'text-rose-200 font-bold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#F43F5E]'
                : 'text-purple-100/85 hover:text-white'
            }`}
          >
            <span>My Vocabulary</span>
            {vocabCount > 0 && (
              <span className="ml-1.5 font-mono text-xs tabular-nums text-rose-200 font-semibold">
                ({vocabCount})
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('practice')}
            className={`relative py-4 sm:py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
              isPracticeActive
                ? 'text-rose-200 font-bold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#F43F5E]'
                : 'text-purple-100/85 hover:text-white'
            }`}
          >
            Practice
          </button>

          <button
            type="button"
            onClick={onSelectLevels}
            className={`relative py-4 sm:py-5 transition-colors whitespace-nowrap shrink-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] ${
              isLevelsActive
                ? 'text-rose-200 font-bold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-[#F43F5E]'
                : 'text-purple-100/85 hover:text-white'
            }`}
          >
            Levels
          </button>
        </nav>

        {/* Far Right: Branding / Logo */}
        <button
          type="button"
          onClick={onSelectHome}
          aria-label="Qalam Arabic Home"
          className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F43F5E] rounded-xl px-1.5 py-1"
        >
          <span
            dir="rtl"
            lang="ar"
            className="hidden sm:inline font-arabic-scheherazade text-2xl font-bold text-rose-200 leading-none"
          >
            قَلَم
          </span>
          <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-white">
            Qalam
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#E11D48] to-[#F43F5E] text-white shadow-2xs">
            <Feather className="h-4 w-4" aria-hidden="true" />
          </span>
        </button>
      </div>
    </header>
  );
}
