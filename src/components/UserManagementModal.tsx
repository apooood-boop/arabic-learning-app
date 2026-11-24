import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Crown,
  Database,
  Eye,
  EyeOff,
  FileCode,
  KeyRound,
  Languages,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  User as UserIcon,
  Users,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';
import {
  AdminManagedAccount,
  AuthUser,
  UserRole,
  VocabCard,
  WordAnalysis,
} from '../types/arabic';
import {
  formatDiagnosticReportText,
  pingGeminiApiStatus,
  pingSupabaseApiStatus,
  runAdminHealthCheck,
  runAutoDataAndCacheRepair,
  runFullAdminReScan,
  testAudioPlaybackTool,
  testTranslationTool,
  testVocabEditAndCacheTool,
  type AdminHealthSnapshot,
  type AutoRepairReport,
  type LiveToolTestResult,
} from '../utils/adminDiagnostics';
import { clearAllArabicAudioCaches, stopArabicSpeech } from '../utils/arabic';
import {
  getGeminiApiKeyInfo,
  setAdminGeminiApiKeyOverride,
  type GeminiApiKeyInfo,
} from '../utils/geminiAuth';
import {
  clearGeminiCooldowns,
  clearGeminiResponseCaches,
} from '../utils/geminiClient';
import {
  adminDeleteUser,
  adminResetUserPassword,
  adminUpdateUserRole,
  getActiveUser,
  getUserInitials,
  isAdminUser,
  listAccountsForAdmin,
  listAccountsForAdminAsync,
  MIN_PASSWORD_LENGTH,
} from '../utils/auth';
import { SUPABASE_SCHEMA_SQL } from '../db/supabaseSchemaString';

interface UserManagementModalProps {
  isOpen: boolean;
  currentUser: AuthUser | null;
  vocabCards: VocabCard[];
  analysisCache: Record<string, WordAnalysis>;
  onVocabRepaired: (nextCards: VocabCard[]) => void;
  onAnalysisCacheRepaired: (nextCache: Record<string, WordAnalysis>) => void;
  onClose: () => void;
  onCurrentUserSynced?: (user: AuthUser | null) => void;
}

type AdminTab = 'users' | 'diagnostics';

const ROLE_LABELS: Record<UserRole, { ar: string; en: string }> = {
  student: { ar: 'طالب', en: 'Student' },
  moderator: { ar: 'مشرف', en: 'Moderator' },
  admin: { ar: 'أدمن', en: 'Admin' },
};

export function UserManagementModal({
  isOpen,
  currentUser,
  vocabCards,
  analysisCache,
  onVocabRepaired,
  onAnalysisCacheRepaired,
  onClose,
  onCurrentUserSynced,
}: UserManagementModalProps) {
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('users');

  // Users & Roles state
  const [accounts, setAccounts] = useState<AdminManagedAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Inline password reset & delete confirmation per user row
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [savingReset, setSavingReset] = useState(false);

  // Primary Admin Gemini API Key Manager state
  const isPrimaryAdmin =
    currentUser?.email?.toLowerCase() === 'apooood@gmail.com' && currentUser?.role === 'admin';
  const [apiKeyInfo, setApiKeyInfo] = useState<GeminiApiKeyInfo>(() => getGeminiApiKeyInfo());
  const [customApiKeyInput, setCustomApiKeyInput] = useState('');
  const [showCustomApiKey, setShowCustomApiKey] = useState(false);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState<string | null>(null);

  const refreshApiKeyInfo = () => {
    setApiKeyInfo(getGeminiApiKeyInfo());
  };

  const handleSaveApiKeyOverride = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = customApiKeyInput.trim();
    if (!trimmed) {
      setApiKeyMessage('الرجاء إدخال مفتاح صالح · Please enter a valid API key.');
      return;
    }
    setSavingApiKey(true);
    setApiKeyMessage(null);
    try {
      setAdminGeminiApiKeyOverride(trimmed);
      clearGeminiCooldowns();
      clearAllArabicAudioCaches();
      refreshApiKeyInfo();
      setCustomApiKeyInput('');
      setApiKeyMessage('تم حفظ مفتاح Gemini المخصص بنجاح! · Custom Gemini API key saved successfully.');
      refreshHealth();
    } catch (err) {
      setApiKeyMessage(err instanceof Error ? err.message : 'Failed to save API key override.');
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleResetToEnvApiKey = () => {
    setApiKeyMessage(null);
    try {
      setAdminGeminiApiKeyOverride(null);
      clearGeminiCooldowns();
      clearAllArabicAudioCaches();
      refreshApiKeyInfo();
      setCustomApiKeyInput('');
      setApiKeyMessage('تم العودة إلى مفتاح البيئة الافتراضي · Reset to environment variable key.');
      refreshHealth();
    } catch (err) {
      setApiKeyMessage(err instanceof Error ? err.message : 'Failed to reset API key.');
    }
  };

  const handleResetCooldownAndTest = async () => {
    setApiKeyMessage(null);
    try {
      clearGeminiResponseCaches();
      clearAllArabicAudioCaches();
      refreshApiKeyInfo();
      setApiKeyMessage('تم مسح وقت الانتظار (Cooldown) وجاري اختبار الاتصال...');
      refreshHealth();
      await handleRunGeminiPing();
    } catch (err) {
      setApiKeyMessage(err instanceof Error ? err.message : 'Failed to reset cooldown & test.');
    }
  };

  // Smart Diagnostics & Repair state
  const [health, setHealth] = useState<AdminHealthSnapshot | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScannedAt, setLastScannedAt] = useState<number | null>(null);
  const [repairReport, setRepairReport] = useState<AutoRepairReport | null>(null);
  const [testWordInput, setTestWordInput] = useState('المَكْتَبَةِ');
  const [testResults, setTestResults] = useState<LiveToolTestResult[]>([]);
  const [runningTest, setRunningTest] = useState<
    'gemini_ping' | 'supabase_ping' | 'translation' | 'audio' | 'vocab_edit_cache' | null
  >(null);
  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [showSqlViewer, setShowSqlViewer] = useState(false);

  const loadList = async () => {
    if (!currentUser || !isAdminUser(currentUser)) {
      setAccounts([]);
      return;
    }
    try {
      // First populate instantly from local cache
      setAccounts(listAccountsForAdmin(currentUser));
      // Then sync fresh from cloud
      const cloudAccounts = await listAccountsForAdminAsync(currentUser);
      setAccounts(cloudAccounts);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load users.');
    }
  };

  const refreshHealth = () => {
    if (!currentUser || !isAdminUser(currentUser)) return;
    try {
      const snap = runAdminHealthCheck(currentUser, vocabCards, analysisCache);
      setHealth(snap);
      setLastScannedAt(snap.checkedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to inspect system health.');
    }
  };

  const handleFullReScan = async () => {
    if (!currentUser || !isAdminUser(currentUser) || isScanning) return;
    setIsScanning(true);
    setError(null);
    try {
      const snap = await runFullAdminReScan(currentUser, vocabCards, analysisCache);
      setHealth(snap);
      setLastScannedAt(snap.checkedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-scan diagnostics.');
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !isAdminUser(currentUser)) return;
    setSearchQuery('');
    setNotice(null);
    setError(null);
    setResetTargetId(null);
    setDeleteConfirmId(null);
    setNewPassword('');
    setConfirmPassword('');
    setResetError(null);
    setRepairReport(null);
    setCopiedReport(false);
    setIsScanning(false);
    loadList();
    refreshHealth();
    refreshApiKeyInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (acc) =>
        acc.name.toLowerCase().includes(q) ||
        acc.email.toLowerCase().includes(q) ||
        acc.role.toLowerCase().includes(q) ||
        ROLE_LABELS[acc.role].ar.includes(q)
    );
  }, [accounts, searchQuery]);

  // Strictly block rendering for non-admin users (students, moderators, guests, unauthenticated)
  if (!isOpen || !isAdminUser(currentUser)) return null;

  const adminCount = accounts.filter((a) => a.role === 'admin').length;
  const moderatorCount = accounts.filter((a) => a.role === 'moderator').length;
  const studentCount = accounts.filter((a) => a.role === 'student').length;

  const handleRoleChange = (account: AdminManagedAccount, nextRole: UserRole) => {
    if (account.isPrimaryOwner) {
      setError(
        'حساب المالك الرئيسي الدائم محمي ولا يمكن تغيير صلاحيته · Primary Owner Admin role is immutable.'
      );
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const updatedList = adminUpdateUserRole({
        actorUser: currentUser,
        targetUserId: account.id,
        nextRole,
      });
      setAccounts(updatedList);
      setNotice(
        `تم تحديث دور ${account.name} (${account.email}) إلى ${ROLE_LABELS[nextRole].ar} (${ROLE_LABELS[nextRole].en}).`
      );
      if (onCurrentUserSynced) {
        onCurrentUserSynced(getActiveUser());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role.');
    }
  };

  const handleConfirmDelete = (account: AdminManagedAccount) => {
    if (account.isPrimaryOwner) {
      setError(
        'لا يمكن حذف حساب المالك الرئيسي الدائم · Primary Owner account cannot be deleted.'
      );
      setDeleteConfirmId(null);
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const updatedList = adminDeleteUser({
        actorUser: currentUser,
        targetUserId: account.id,
      });
      setAccounts(updatedList);
      setDeleteConfirmId(null);
      setNotice(`تم حذف الحساب ${account.name} (${account.email}) بنجاح.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user.');
      setDeleteConfirmId(null);
    }
  };

  const openInlineReset = (accountId: string) => {
    setDeleteConfirmId(null);
    setResetTargetId((prev) => (prev === accountId ? null : accountId));
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setResetError(null);
    setNotice(null);
  };

  const handleSubmitAdminReset = async (e: FormEvent, account: AdminManagedAccount) => {
    e.preventDefault();
    setResetError(null);
    setNotice(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setResetError(
        `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل · Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('كلمتا المرور غير متطابقتين · Passwords do not match.');
      return;
    }

    setSavingReset(true);
    try {
      const res = await adminResetUserPassword({
        actorUser: currentUser,
        targetUserId: account.id,
        newPassword,
        confirmPassword,
      });
      setResetTargetId(null);
      setNewPassword('');
      setConfirmPassword('');
      setNotice(
        `تم تعيين كلمة مرور جديدة للحساب ${res.name} (${res.email}) مع الحفاظ على كافة بياناته.`
      );
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset user password.');
    } finally {
      setSavingReset(false);
    }
  };

  const handleRunAutoRepair = () => {
    setError(null);
    try {
      const report = runAutoDataAndCacheRepair({
        actorUser: currentUser,
        activeVocabCards: vocabCards,
        analysisCache,
        onVocabRepaired,
        onAnalysisCacheRepaired,
      });
      setRepairReport(report);
      // Re-run health check immediately against fresh state
      const freshHealth = runAdminHealthCheck(currentUser, vocabCards, analysisCache);
      const updatedSnap: AdminHealthSnapshot = {
        ...freshHealth,
        wordCachePlaceholders: 0,
        vocabCardsWithPlaceholders: 0,
        vocabCardsNeedingNormalization: 0,
        geminiText: {
          ...freshHealth.geminiText,
          cooldownActive: false,
          cooldownRemainingSec: 0,
          quotaReason: null,
          memoryCacheEntries: 0,
          persistentCacheEntries: 0,
          placeholderEntriesInResponseCache: 0,
        },
        audio: {
          ...freshHealth.audio,
          memoryCachedClips: 0,
          persistentCachedClips: 0,
          geminiAudioCooldownActive: false,
          geminiAudioCooldownRemainingSec: 0,
          geminiAudioRejectedReason: null,
          staticApiTtsUnavailable: false,
        },
      };
      setHealth(updatedSnap);
      setLastScannedAt(updatedSnap.checkedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-repair failed.');
    }
  };

  const recordTestResult = (res: LiveToolTestResult) => {
    setTestResults((prev) => [res, ...prev.filter((item) => item.tool !== res.tool)]);
    refreshHealth();
  };

  const handleRunGeminiPing = async () => {
    setRunningTest('gemini_ping');
    try {
      const res = await pingGeminiApiStatus(currentUser);
      recordTestResult(res);
    } finally {
      setRunningTest(null);
    }
  };

  const handleRunSupabasePing = async () => {
    setRunningTest('supabase_ping');
    try {
      const res = await pingSupabaseApiStatus(currentUser);
      recordTestResult(res);
    } finally {
      setRunningTest(null);
    }
  };

  const handleCopySqlSchema = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SCHEMA_SQL);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      setError('Could not copy SQL schema to clipboard.');
    }
  };

  const handleRunTranslationTest = async () => {
    setRunningTest('translation');
    try {
      const res = await testTranslationTool(currentUser, testWordInput);
      recordTestResult(res);
    } finally {
      setRunningTest(null);
    }
  };

  const handleRunAudioTest = async () => {
    setRunningTest('audio');
    try {
      const res = await testAudioPlaybackTool(currentUser, testWordInput);
      recordTestResult(res);
    } finally {
      setRunningTest(null);
    }
  };

  const handleRunEditCacheTest = () => {
    setRunningTest('vocab_edit_cache');
    try {
      const res = testVocabEditAndCacheTool(currentUser, testWordInput);
      recordTestResult(res);
    } finally {
      setRunningTest(null);
    }
  };

  const handleCopyReport = async () => {
    const snap = health ?? runAdminHealthCheck(currentUser, vocabCards, analysisCache);
    const text = formatDiagnosticReportText({
      health: snap,
      repair: repairReport,
      testResults,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedReport(true);
      window.setTimeout(() => setCopiedReport(false), 2500);
    } catch {
      setError('Could not copy report to clipboard.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#182111]/65 p-3 sm:p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-panel-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-popover-in w-full max-w-4xl rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] shadow-2xl overflow-hidden flex flex-col max-h-[92dvh]">
        {/* Dark Olive Green Header with Lemon-Gold Accent */}
        <div className="relative overflow-hidden flex items-center justify-between gap-3 border-b border-[#3E522D] bg-[linear-gradient(135deg,#24301B_0%,#3B4D2B_100%)] px-5 sm:px-6 py-4 text-[#FAFBF8] shrink-0">
          <div className="islamic-geo-pattern pointer-events-none absolute inset-0 opacity-30" />
          <div className="relative flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#FACC15]/60 bg-[#16200F] text-[#FACC15] shadow-xs">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="admin-panel-title"
                className="font-display text-base sm:text-lg font-bold text-white flex flex-wrap items-center gap-2"
              >
                <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#FEF08A]">
                  لوحة الإدارة والفحص الذكي
                </span>
                <span className="text-xs font-normal text-[#DCE5D3]">· Admin Panel</span>
              </h2>
              <p className="text-xs text-[#DCE5D3] truncate">
                Role-based user management, password recovery, smart diagnostics &amp; cache repair.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close admin panel"
            className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#DCE5D3] hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Admin Sub-Navigation Tabs */}
        <div className="border-b border-[#DCE5D3] bg-white px-4 sm:px-6 pt-3 pb-0 shrink-0">
          <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-2">
            <button
              type="button"
              role="tab"
              aria-selected={activeAdminTab === 'users'}
              onClick={() => setActiveAdminTab('users')}
              className={`inline-flex items-center gap-2 rounded-t-xl border-b-2 px-3.5 py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                activeAdminTab === 'users'
                  ? 'border-[#FACC15] bg-[#FAFBF8] text-[#2D3B22]'
                  : 'border-transparent text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              <Users className="h-4 w-4 text-[#D4A338]" aria-hidden="true" />
              <span dir="rtl" lang="ar" className="font-arabic-cairo">
                إدارة المستخدمين والأدوار
              </span>
              <span className="rounded-full bg-[#EEF2E9] px-2 py-0.5 font-mono text-[10px] text-[#2D3B22]">
                {accounts.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeAdminTab === 'diagnostics'}
              onClick={() => {
                setActiveAdminTab('diagnostics');
                void handleFullReScan();
              }}
              className={`inline-flex items-center gap-2 rounded-t-xl border-b-2 px-3.5 py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                activeAdminTab === 'diagnostics'
                  ? 'border-[#FACC15] bg-[#FAFBF8] text-[#2D3B22]'
                  : 'border-transparent text-[#5A6552] hover:text-[#1F2718]'
              }`}
            >
              <Wrench className="h-4 w-4 text-[#D4A338]" aria-hidden="true" />
              <span dir="rtl" lang="ar" className="font-arabic-cairo">
                الأداة الذكية للفحص والإصلاح والاختبار
              </span>
            </button>
          </div>
        </div>

        {/* Alerts */}
        {(notice || error) && (
          <div className="border-b border-[#DCE5D3] bg-[#FAFBF8] px-5 sm:px-6 py-2.5 space-y-2 shrink-0">
            {notice && (
              <div className="flex items-start gap-2 rounded-xl border border-[#3B4D2B]/30 bg-[#EEF2E9] px-3.5 py-2 text-xs font-medium text-[#2D3B22]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#3B4D2B]" aria-hidden="true" />
                <span dir="auto">{notice}</span>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-[#FEF7E6] px-3.5 py-2 text-xs font-medium text-[#7C4A03]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <span dir="auto">{error}</span>
              </div>
            )}
          </div>
        )}

        {/* TAB 1: User & Role Management */}
        {activeAdminTab === 'users' && (
          <>
            <div className="border-b border-[#DCE5D3] bg-white px-5 sm:px-6 py-3.5 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#FACC15]/50 bg-[#16200F] px-2.5 py-1 font-semibold text-[#FEF08A]">
                    <Shield className="h-3 w-3 text-[#FACC15]" aria-hidden="true" />
                    <span>{adminCount} Admin</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#DCE5D3] bg-[#FBF3DC] px-2.5 py-1 font-semibold text-[#7A560B]">
                    <span>{moderatorCount} Moderator</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#DCE5D3] bg-[#EEF2E9] px-2.5 py-1 font-semibold text-[#2D3B22]">
                    <span>{studentCount} Student</span>
                  </span>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7861]"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name, email, or role..."
                    className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-8 pr-3 py-1.5 text-xs text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FACC15]/40"
                  />
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-3">
              {filteredAccounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#DCE5D3] bg-white p-8 text-center text-xs text-[#5A6552]">
                  No matching registered accounts found.
                </div>
              ) : (
                filteredAccounts.map((acc) => {
                  const isSelf = acc.id === currentUser?.id;
                  const isResetOpen = resetTargetId === acc.id;
                  const isDeleteConfirm = deleteConfirmId === acc.id;

                  return (
                    <div
                      key={acc.id}
                      className={`rounded-2xl border bg-white p-4 transition-all ${
                        acc.isPrimaryOwner
                          ? 'border-[#3B4D2B]/50 shadow-xs'
                          : 'border-[#DCE5D3]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${
                              acc.isPrimaryOwner
                                ? 'bg-[#16200F] text-[#FACC15] border border-[#FACC15]/60'
                                : acc.role === 'admin'
                                  ? 'bg-[#2D3B22] text-[#FEF08A]'
                                  : acc.role === 'moderator'
                                    ? 'bg-[#FBF3DC] text-[#9A6F14]'
                                    : 'bg-[#EEF2E9] text-[#2D3B22]'
                            }`}
                          >
                            {getUserInitials(acc.name)}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-sm font-bold text-[#1F2718] truncate">
                                {acc.name}
                              </p>
                              {isSelf && (
                                <span className="rounded-md bg-[#EEF2E9] px-1.5 py-0.5 text-[10px] font-semibold text-[#2D3B22]">
                                  You · أنت
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[#5A6552] truncate">{acc.email}</p>
                          </div>
                        </div>

                        {/* Role Badge */}
                        <div className="flex flex-wrap items-center gap-2">
                          {acc.isPrimaryOwner ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FACC15]/65 bg-[#16200F] px-3 py-1 text-[11px] font-bold text-[#FACC15]">
                              <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>المالك الرئيسي / Primary Admin</span>
                            </span>
                          ) : acc.role === 'admin' ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#3B4D2B]/35 bg-[#EEF2E9] px-2.5 py-1 text-[11px] font-semibold text-[#2D3B22]">
                              <Shield className="h-3 w-3 text-[#3B4D2B]" aria-hidden="true" />
                              <span>أدمن / Admin</span>
                            </span>
                          ) : acc.role === 'moderator' ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#E8D7A7] bg-[#FBF3DC] px-2.5 py-1 text-[11px] font-semibold text-[#9A6F14]">
                              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                              <span>مشرف / Moderator</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#DCE5D3] bg-[#FAFBF8] px-2.5 py-1 text-[11px] font-medium text-[#5A6552]">
                              <UserIcon className="h-3 w-3" aria-hidden="true" />
                              <span>طالب / Student</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Role Selector & Actions */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2E9] pt-3">
                        <span className="text-[11px] text-[#6B7861]">
                          Registered {new Date(acc.createdAt).toLocaleDateString()}
                        </span>

                        <div className="flex flex-wrap items-center gap-2">
                          {acc.isPrimaryOwner ? (
                            <span className="inline-flex items-center gap-1 rounded-xl border border-[#3B4D2B]/25 bg-[#FAFBF8] px-2.5 py-1 text-[11px] font-semibold text-[#2D3B22]">
                              <Lock className="h-3 w-3 text-[#D4A338]" aria-hidden="true" />
                              <span>Immutable Primary Admin · محمي دائمًا</span>
                            </span>
                          ) : (
                            <>
                              <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#5A6552]">
                                <span>Role:</span>
                                <select
                                  aria-label={`Change role for ${acc.email}`}
                                  value={acc.role}
                                  disabled={isSelf}
                                  onChange={(e) =>
                                    handleRoleChange(acc, e.target.value as UserRole)
                                  }
                                  className="rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-2.5 py-1 text-xs font-semibold text-[#2D3B22] focus:border-[#3B4D2B] focus:outline-none focus:ring-2 focus:ring-[#FACC15]/40 disabled:opacity-60 cursor-pointer"
                                >
                                  <option value="student">طالب · Student</option>
                                  <option value="moderator">مشرف · Moderator</option>
                                  <option value="admin">أدمن · Admin</option>
                                </select>
                              </label>

                              {!isSelf && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResetTargetId(null);
                                    setDeleteConfirmId((prev) =>
                                      prev === acc.id ? null : acc.id
                                    );
                                  }}
                                  aria-label={`Delete user ${acc.email}`}
                                  className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50/70 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>حذف</span>
                                </button>
                              )}
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => openInlineReset(acc.id)}
                            className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                              isResetOpen
                                ? 'bg-[#2D3B22] text-[#FACC15]'
                                : 'border border-[#3B4D2B]/30 bg-[#EEF2E9] text-[#2D3B22] hover:bg-[#DCE5D3]/70'
                            }`}
                          >
                            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>إعادة تعيين كلمة المرور</span>
                          </button>
                        </div>
                      </div>

                      {/* Inline Delete Confirmation (Protected against Primary Owner) */}
                      {isDeleteConfirm && !acc.isPrimaryOwner && !isSelf && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs">
                          <span className="font-semibold text-rose-900">
                            Confirm removing <strong>{acc.email}</strong>?
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="rounded-lg border border-[#DCE5D3] bg-white px-2.5 py-1 font-semibold text-[#5A6552] hover:bg-[#FAFBF8] cursor-pointer"
                            >
                              إلغاء · Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfirmDelete(acc)}
                              className="rounded-lg bg-rose-700 px-2.5 py-1 font-semibold text-white hover:bg-rose-800 cursor-pointer"
                            >
                              تأكيد الحذف · Delete
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Inline Admin Password Reset Form */}
                      {isResetOpen && (
                        <form
                          onSubmit={(e) => handleSubmitAdminReset(e, acc)}
                          className="mt-3 rounded-xl border border-[#3B4D2B]/30 bg-[#FAFBF8] p-3.5 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-[#2D3B22]">
                              Reset password for <span className="underline">{acc.email}</span>
                            </p>
                            <button
                              type="button"
                              onClick={() => setShowNewPassword((prev) => !prev)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5A6552] hover:text-[#2D3B22] cursor-pointer"
                            >
                              {showNewPassword ? (
                                <>
                                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Hide</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Show</span>
                                </>
                              )}
                            </button>
                          </div>

                          {resetError && (
                            <p className="rounded-lg border border-amber-300 bg-[#FEF7E6] px-3 py-1.5 text-xs font-medium text-[#7C4A03]">
                              {resetError}
                            </p>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div className="relative">
                              <Lock
                                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7861]"
                                aria-hidden="true"
                              />
                              <input
                                type={showNewPassword ? 'text' : 'password'}
                                required
                                minLength={MIN_PASSWORD_LENGTH}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder={`New password (min ${MIN_PASSWORD_LENGTH})`}
                                className="w-full rounded-xl border border-[#DCE5D3] bg-white pl-8 pr-3 py-2 text-xs text-[#1F2718] focus:border-[#3B4D2B] focus:outline-none focus:ring-2 focus:ring-[#FACC15]/40"
                              />
                            </div>
                            <div className="relative">
                              <Lock
                                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7861]"
                                aria-hidden="true"
                              />
                              <input
                                type={showNewPassword ? 'text' : 'password'}
                                required
                                minLength={MIN_PASSWORD_LENGTH}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm new password"
                                className="w-full rounded-xl border border-[#DCE5D3] bg-white pl-8 pr-3 py-2 text-xs text-[#1F2718] focus:border-[#3B4D2B] focus:outline-none focus:ring-2 focus:ring-[#FACC15]/40"
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setResetTargetId(null)}
                              className="rounded-xl border border-[#DCE5D3] bg-white px-3 py-1.5 text-xs font-semibold text-[#5A6552] hover:bg-[#EEF2E9] cursor-pointer"
                            >
                              إلغاء · Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={savingReset}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-3.5 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60 cursor-pointer"
                            >
                              <KeyRound className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
                              <span>
                                {savingReset
                                  ? 'جاري التحديث...'
                                  : 'حفظ كلمة المرور · Save Password'}
                              </span>
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* TAB 2: Smart Diagnostics, Data Repair & Live Tool Tester */}
        {activeAdminTab === 'diagnostics' && health && (
          <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 space-y-5">
            {/* Header Bar with Re-Scan + Last Scanned Timestamp + Copy Report */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#2D3B22]" aria-hidden="true" />
                  <h3 className="text-sm font-bold text-[#1F2718]">
                    Fault Diagnostics &amp; System Health
                  </h3>
                </div>
                <p className="mt-0.5 text-[11px] text-[#5A6552]" aria-live="polite">
                  {isScanning ? (
                    <span className="font-semibold text-[#2D3B22]">
                      جاري الفحص... · Scanning all checks...
                    </span>
                  ) : lastScannedAt ? (
                    <span>
                      آخر فحص · Last scanned at{' '}
                      <span className="font-mono font-semibold text-[#1F2718]">
                        {new Date(lastScannedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </span>
                  ) : (
                    <span>Ready to scan</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isScanning}
                  onClick={() => {
                    void handleFullReScan();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-white px-3 py-1.5 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] disabled:opacity-70 cursor-pointer"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D4A338]" aria-hidden="true" />
                      <span>جاري الفحص... · Scanning...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>فحص الآن · Re-Scan</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleCopyReport}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#3B4D2B]/35 bg-[#16200F] px-3 py-1.5 text-xs font-semibold text-[#FACC15] hover:bg-[#233018] cursor-pointer"
                >
                  {copiedReport ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>تم النسخ! · Copied Report</span>
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>نسخ التقرير · Copy Report</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Health Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Gemini API Key & Quota Card */}
              <div className="rounded-2xl border border-[#DCE5D3] bg-white p-3.5 space-y-1.5 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#2D3B22]">Gemini API &amp; Quota</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        health.checkErrors?.gemini
                          ? 'bg-rose-100 text-rose-800'
                          : !health.apiKeyConfigured
                            ? 'bg-rose-100 text-rose-800'
                            : health.geminiText.cooldownActive
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-[#EEF2E9] text-[#2D3B22]'
                      }`}
                    >
                      {health.checkErrors?.gemini
                        ? 'Check Error'
                        : !health.apiKeyConfigured
                          ? 'Missing Key'
                          : health.geminiText.cooldownActive
                            ? `Cooldown (${health.geminiText.cooldownRemainingSec}s)`
                            : 'Ready'}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-[#1F2718] break-all">
                    {health.apiKeyMasked}
                  </p>
                  <p className="text-[11px] text-[#5A6552]">{health.geminiStatusSummary}</p>
                  {health.geminiText.quotaReason && (
                    <p className="text-[11px] text-amber-800 leading-snug">
                      {health.geminiText.quotaReason}
                    </p>
                  )}
                  {health.checkErrors?.gemini && (
                    <p className="text-[11px] text-rose-700 leading-snug">
                      {health.checkErrors.gemini}
                    </p>
                  )}
                </div>
              </div>

              {/* Supabase Cloud Database Card */}
              <div className="rounded-2xl border border-[#DCE5D3] bg-white p-3.5 space-y-1.5 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#2D3B22] flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-[#3B4D2B]" aria-hidden="true" />
                      <span>Supabase Cloud DB</span>
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        health.supabase.isConfigured
                          ? health.checkErrors?.supabase
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-[#EEF2E9] text-[#2D3B22]'
                          : 'bg-[#FBF3DC] text-[#7A560B]'
                      }`}
                    >
                      {health.supabase.isConfigured ? 'Connected' : 'Local Fallback'}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-[#1F2718] truncate" title={health.supabase.url || 'Not configured'}>
                    {health.supabase.url || 'VITE_SUPABASE_URL missing'}
                  </p>
                  <p className="text-[11px] text-[#5A6552]">
                    Anon Key: <span className="font-mono">{health.supabase.maskedKey}</span>
                  </p>
                  <p className="text-[11px] text-[#5A6552] leading-snug">
                    {health.supabase.statusSummary}
                  </p>
                  {health.checkErrors?.supabase && (
                    <p className="text-[11px] text-amber-800 leading-snug">
                      {health.checkErrors.supabase}
                    </p>
                  )}
                </div>
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopySqlSchema}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3B4D2B] hover:underline cursor-pointer"
                  >
                    <ClipboardCopy className="h-3 w-3" aria-hidden="true" />
                    <span>{copiedSql ? 'تم النسخ!' : 'نسخ سكيما SQL'}</span>
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => setShowSqlViewer(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3B4D2B] hover:underline cursor-pointer"
                  >
                    <FileCode className="h-3 w-3" aria-hidden="true" />
                    <span>عرض السكيما</span>
                  </button>
                </div>
              </div>

              {/* Audio & SpeechSynthesis Card */}
              <div className="rounded-2xl border border-[#DCE5D3] bg-white p-3.5 space-y-1.5 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#2D3B22]">Speech &amp; Audio</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        health.checkErrors?.voices || health.checkErrors?.audioPath
                          ? 'bg-rose-100 text-rose-800'
                          : health.audio.arabicVoices.length > 0
                            ? 'bg-[#EEF2E9] text-[#2D3B22]'
                            : 'bg-[#FBF3DC] text-[#9A6F14]'
                      }`}
                    >
                      {health.audio.arabicVoices.length} ar-* voices
                    </span>
                  </div>
                  <p className="text-[11px] text-[#5A6552]">
                    Total voices: {health.audio.totalVoices} · TTS clips (mem/disk):{' '}
                    {health.audio.memoryCachedClips}/{health.audio.persistentCachedClips}
                  </p>
                  <p className="text-[11px] text-[#5A6552] truncate">
                    {health.audio.arabicVoices.length > 0
                      ? health.audio.arabicVoices
                          .slice(0, 2)
                          .map((v) => `${v.name} (${v.lang})`)
                          .join(', ')
                      : `AudioContext: ${health.audioContextState} (Web/Gemini fallback)`}
                  </p>
                  {(health.checkErrors?.voices || health.checkErrors?.audioPath) && (
                    <p className="text-[11px] text-rose-700 leading-snug">
                      {health.checkErrors?.voices || health.checkErrors?.audioPath}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    stopArabicSpeech();
                    void handleFullReScan();
                  }}
                  className="text-[11px] font-semibold text-[#3B4D2B] hover:underline cursor-pointer text-left"
                >
                  Reset Audio Playback Lock
                </button>
              </div>

              {/* Data & Cache Scan Card */}
              <div className="rounded-2xl border border-[#DCE5D3] bg-white p-3.5 space-y-1.5 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#2D3B22]">Cards &amp; Cache Scan</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        health.checkErrors?.cardsAndCache
                          ? 'bg-rose-100 text-rose-800'
                          : health.vocabCardsWithPlaceholders +
                                health.wordCachePlaceholders +
                                health.vocabCardsNeedingNormalization >
                              0
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-[#EEF2E9] text-[#2D3B22]'
                      }`}
                    >
                      {health.checkErrors?.cardsAndCache
                        ? 'Check Error'
                        : `${
                            health.vocabCardsWithPlaceholders +
                            health.wordCachePlaceholders +
                            health.vocabCardsNeedingNormalization
                          } issues`}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#5A6552]">
                    Placeholders: {health.vocabCardsWithPlaceholders} cards ·{' '}
                    {health.wordCachePlaceholders} cached
                  </p>
                  <p className="text-[11px] text-[#5A6552]">
                    To normalize: {health.vocabCardsNeedingNormalization} (Custom: {health.vocabCardsCustomEdited})
                  </p>
                  {health.checkErrors?.cardsAndCache && (
                    <p className="text-[11px] text-rose-700 leading-snug">
                      {health.checkErrors.cardsAndCache}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Automatic Data & Cache Repair Box */}
            <div className="rounded-2xl border border-[#3B4D2B]/30 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-[#1F2718] flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-[#D4A338]" aria-hidden="true" />
                    <span>Automatic Data &amp; Cache Repair · الفحص والإصلاح التلقائي</span>
                  </h4>
                  <p className="mt-0.5 text-[11px] text-[#5A6552]">
                    Cleans &ldquo;Contextual Arabic word&rdquo; placeholders, normalizes standalone
                    cards (preserving manual edits), and clears stale audio/translation caches.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleRunAutoRepair}
                  className="inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-4 py-2 text-xs font-bold text-white hover:brightness-110 shadow-xs cursor-pointer"
                >
                  <Wrench className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
                  <span>تشغيل الإصلاح التلقائي · Run Auto-Repair</span>
                </button>
              </div>

              {repairReport && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl border border-[#3B4D2B]/25 bg-[#EEF2E9]/70 p-3 text-[11px] text-[#2D3B22]">
                  <div>
                    <span className="block font-bold font-mono text-sm">
                      {repairReport.cleanedVocabPlaceholders +
                        repairReport.removedWordCachePlaceholders +
                        repairReport.repairedOtherAccountCards}
                    </span>
                    <span>Placeholders cleaned</span>
                  </div>
                  <div>
                    <span className="block font-bold font-mono text-sm">
                      {repairReport.normalizedVocabCards}
                    </span>
                    <span>Cards normalized</span>
                  </div>
                  <div>
                    <span className="block font-bold font-mono text-sm">
                      {repairReport.preservedCustomEditedCards}
                    </span>
                    <span>Custom edits kept</span>
                  </div>
                  <div>
                    <span className="block font-bold font-mono text-sm">
                      {repairReport.clearedGeminiCacheEntries +
                        repairReport.clearedAudioCacheEntries}
                    </span>
                    <span>Stale caches cleared</span>
                  </div>
                </div>
              )}
            </div>

            {/* Live Tool Testers + Primary Admin Gemini API Key Manager Side-by-Side */}
            <div className={isPrimaryAdmin ? 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start' : ''}>
              {/* Live Tool Testers */}
              <div className="rounded-2xl border border-[#DCE5D3] bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-[#1F2718]">
                    Live Tool Testers · اختبار الأدوات مباشرة
                  </h4>
                  <div className="flex items-center gap-2">
                    <label htmlFor="diag-sample-word" className="text-[11px] text-[#5A6552]">
                      Test Arabic Input:
                    </label>
                    <input
                      id="diag-sample-word"
                      dir="rtl"
                      lang="ar"
                      type="text"
                      value={testWordInput}
                      onChange={(e) => setTestWordInput(e.target.value)}
                      className="w-32 rounded-lg border border-[#DCE5D3] bg-[#FAFBF8] px-2.5 py-1 font-arabic-scheherazade text-base text-[#1F2718] focus:border-[#3B4D2B] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={runningTest !== null}
                    onClick={handleRunSupabasePing}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] disabled:opacity-60 cursor-pointer"
                  >
                    {runningTest === 'supabase_ping' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Database className="h-3.5 w-3.5 text-[#3B4D2B]" aria-hidden="true" />
                    )}
                    <span>Ping Supabase · فحص سوبابيز</span>
                  </button>

                  <button
                    type="button"
                    disabled={runningTest !== null}
                    onClick={handleRunGeminiPing}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] disabled:opacity-60 cursor-pointer"
                  >
                    {runningTest === 'gemini_ping' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Activity className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                    )}
                    <span>Ping Gemini API · فحص الاتصال</span>
                  </button>

                  <button
                    type="button"
                    disabled={runningTest !== null}
                    onClick={handleRunTranslationTest}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] disabled:opacity-60 cursor-pointer"
                  >
                    {runningTest === 'translation' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Languages className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                    )}
                    <span>Test Translation · اختبار الترجمة</span>
                  </button>

                  <button
                    type="button"
                    disabled={runningTest !== null}
                    onClick={handleRunAudioTest}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] disabled:opacity-60 cursor-pointer"
                  >
                    {runningTest === 'audio' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                    )}
                    <span>Test Audio Path · اختبار الصوت</span>
                  </button>

                  <button
                    type="button"
                    disabled={runningTest !== null}
                    onClick={handleRunEditCacheTest}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] disabled:opacity-60 cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                    <span>Test Edit &amp; Cache · اختبار التعديل والكاش</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowSqlViewer(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#3B4D2B]/35 bg-[#16200F] px-3 py-2 text-xs font-semibold text-[#FACC15] hover:bg-[#233018] cursor-pointer"
                  >
                    <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>سكيما سوبابيز SQL Schema</span>
                  </button>
                </div>

                {testResults.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {testResults.map((res) => (
                      <div
                        key={res.tool}
                        className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                          res.ok
                            ? 'border-[#3B4D2B]/30 bg-[#EEF2E9]/60 text-[#1F2718]'
                            : 'border-amber-300 bg-[#FEF7E6] text-[#7C4A03]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-bold">
                          <span>{res.summary}</span>
                          <span className="font-mono text-[10px] opacity-80">{res.durationMs}ms</span>
                        </div>
                        <p className="mt-1 text-[11px] opacity-90">{res.details}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Primary Admin Only: Gemini API Key Manager Card (Side-by-Side Next to Diagnostic Tool) */}
              {isPrimaryAdmin && (
                <div className="rounded-2xl border-2 border-[#D4A338]/60 bg-gradient-to-br from-white via-[#FAFBF8] to-[#FBF3DC]/40 p-4 space-y-3.5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#DCE5D3] pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#16200F] text-[#FACC15] shadow-2xs">
                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div>
                        <h4 className="text-xs sm:text-sm font-bold text-[#1F2718] flex flex-wrap items-center gap-1.5">
                          <span>Gemini API Key Manager</span>
                          <span className="rounded-md bg-[#16200F] px-2 py-0.5 font-mono text-[10px] text-[#FEF08A]">
                            Primary Admin Only
                          </span>
                        </h4>
                        <p className="text-[11px] text-[#5A6552]">
                          Source: <strong className="text-[#2D3B22]">{apiKeyInfo.source}</strong> · Length:{' '}
                          <span className="font-mono font-semibold">{apiKeyInfo.length}</span> chars
                        </p>
                      </div>
                    </div>

                    <span className="rounded-lg bg-[#EEF2E9] px-2.5 py-1 font-mono text-[11px] font-bold text-[#2D3B22] border border-[#DCE5D3]">
                      {apiKeyInfo.masked}
                    </span>
                  </div>

                  {apiKeyMessage && (
                    <div className="rounded-xl border border-[#3B4D2B]/30 bg-[#EEF2E9] px-3 py-2 text-xs font-medium text-[#2D3B22]">
                      {apiKeyMessage}
                    </div>
                  )}

                  <form onSubmit={handleSaveApiKeyOverride} className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="custom-gemini-key" className="text-xs font-semibold text-[#1F2718]">
                        Custom API Key Override (localStorage):
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowCustomApiKey((prev) => !prev)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5A6552] hover:text-[#2D3B22] cursor-pointer"
                      >
                        {showCustomApiKey ? (
                          <>
                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Hide</span>
                          </>
                        ) : (
                          <>
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Show</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <div className="relative flex-1 min-w-0">
                        <KeyRound
                          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7861]"
                          aria-hidden="true"
                        />
                        <input
                          id="custom-gemini-key"
                          type={showCustomApiKey ? 'text' : 'password'}
                          value={customApiKeyInput}
                          onChange={(e) => setCustomApiKeyInput(e.target.value)}
                          placeholder="Paste Gemini API key (e.g. AIza... or AQ...)"
                          className="w-full rounded-xl border border-[#DCE5D3] bg-white pl-8 pr-3 py-2 font-mono text-xs text-[#1F2718] focus:border-[#3B4D2B] focus:outline-none focus:ring-2 focus:ring-[#FACC15]/40"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={savingApiKey || !customApiKeyInput.trim()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-3.5 py-2 text-xs font-bold text-white hover:brightness-110 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
                        <span>{savingApiKey ? 'Saving...' : 'Save Key'}</span>
                      </button>
                    </div>
                  </form>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#DCE5D3]/80 pt-3">
                    <div>
                      {apiKeyInfo.hasOverride && (
                        <button
                          type="button"
                          onClick={handleResetToEnvApiKey}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-[#FEF7E6] px-3 py-1.5 text-xs font-semibold text-[#7C4A03] hover:bg-amber-100 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Reset to Env</span>
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={runningTest !== null}
                      onClick={() => {
                        void handleResetCooldownAndTest();
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#2D3B22] px-3.5 py-1.5 text-xs font-bold text-[#FACC15] hover:brightness-110 disabled:opacity-60 shadow-xs cursor-pointer"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${runningTest === 'gemini_ping' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      <span>Reset Cooldown &amp; Test</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Supabase SQL Schema Viewer & Copy Modal */}
      {showSqlViewer && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-[#182111]/75 p-3 sm:p-5 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="supabase-schema-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSqlViewer(false);
          }}
        >
          <div className="animate-popover-in w-full max-w-4xl rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#3E522D] bg-[linear-gradient(135deg,#24301B_0%,#3B4D2B_100%)] px-5 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <Database className="h-5 w-5 text-[#FACC15]" aria-hidden="true" />
                <div>
                  <h3 id="supabase-schema-modal-title" className="text-sm sm:text-base font-bold text-white">
                    Supabase SQL Schema &amp; Row Level Security (RLS)
                  </h3>
                  <p className="text-xs text-[#DCE5D3]">
                    انسخ هذا النص وضعه في Supabase SQL Editor لإنشاء الجداول وسياسات الأمان
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSqlViewer(false)}
                className="rounded-lg p-1 text-[#DCE5D3] hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Code Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-[#121A0D] text-[#FAFBF8]">
              <pre className="font-mono text-xs leading-relaxed overflow-x-auto p-3 rounded-xl bg-[#0B1107] text-[#DCE5D3] border border-[#2D3B22]">
                <code>{SUPABASE_SCHEMA_SQL}</code>
              </pre>
            </div>

            {/* Footer Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#DCE5D3] bg-white px-5 py-3.5">
              <span className="text-xs text-[#5A6552]">
                Includes: <span className="font-semibold">profiles</span>, <span className="font-semibold">vocabulary_cards</span>, <span className="font-semibold">study_notes</span>, <span className="font-semibold">user_progress</span> + Primary Owner Triggers
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSqlViewer(false)}
                  className="rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#5A6552] hover:bg-[#EEF2E9] cursor-pointer"
                >
                  إغلاق · Close
                </button>
                <button
                  type="button"
                  onClick={handleCopySqlSchema}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-4 py-1.5 text-xs font-bold text-white hover:brightness-110 shadow-xs cursor-pointer"
                >
                  {copiedSql ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
                      <span>تم النسخ بنجاح!</span>
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
                      <span>نسخ السكيما كاملة · Copy Full SQL</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
