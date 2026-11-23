import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { AuthUser } from '../types/arabic';
import {
  loginAsGuest,
  loginWithEmail,
  MIN_PASSWORD_LENGTH,
  registerWithEmail,
  resetPasswordByEmail,
  verifyAccountForPasswordReset,
  type VerifiedPasswordResetAccount,
} from '../utils/auth';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register';
  onClose: () => void;
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthModal({
  isOpen,
  initialMode = 'login',
  onClose,
  onAuthenticated,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Forgot-password two-step state
  const [resetEmail, setResetEmail] = useState('');
  const [verifiedAccount, setVerifiedAccount] =
    useState<VerifiedPasswordResetAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setSuccessMessage(null);
      setVerifiedAccount(null);
      setNewPassword('');
      setConfirmNewPassword('');
      setShowPassword(false);
      setShowNewPassword(false);
      setShowConfirmNewPassword(false);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const openForgotPasswordFlow = () => {
    setError(null);
    setSuccessMessage(null);
    setVerifiedAccount(null);
    setResetEmail(email.trim());
    setNewPassword('');
    setConfirmNewPassword('');
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
    setMode('forgot');
  };

  const returnToLogin = (prefillEmail?: string, notice?: string) => {
    setMode('login');
    if (prefillEmail !== undefined) {
      setEmail(prefillEmail);
    }
    setPassword('');
    setShowPassword(false);
    setVerifiedAccount(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setError(null);
    setSuccessMessage(notice ?? null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (mode === 'register') {
      if (email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
        setError('البريد الإلكتروني وتأكيد البريد الإلكتروني غير متطابقين · Email addresses must match.');
        return;
      }
    }

    setLoading(true);

    try {
      const user =
        mode === 'register'
          ? await registerWithEmail({
              name,
              email,
              confirmEmail,
              password,
            })
          : await loginWithEmail({ email, password });

      onAuthenticated(user);
      setName('');
      setEmail('');
      setConfirmEmail('');
      setPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyResetEmail = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    try {
      const verified = verifyAccountForPasswordReset(resetEmail);
      setVerifiedAccount(verified);
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      setVerifiedAccount(null);
      setError(
        err instanceof Error
          ? err.message
          : 'تعذّر التحقق من البريد الإلكتروني · Unable to verify account.'
      );
    }
  };

  const handleConfirmPasswordReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!verifiedAccount) return;

    setError(null);
    setSuccessMessage(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(
        `كلمة المرور الجديدة يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل · Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError(
        'كلمتا المرور غير متطابقتين · New password and confirmation do not match.'
      );
      return;
    }

    setLoading(true);
    try {
      const updated = await resetPasswordByEmail({
        email: verifiedAccount.email,
        newPassword,
        confirmPassword: confirmNewPassword,
      });

      const ownerNote = updated.isPrimaryOwner
        ? ' تم الحفاظ على صلاحيات المالك الرئيسي (Admin) وجميع مفرداتك وملاحظاتك المحفوظة.'
        : ' جميع مفرداتك وملاحظاتك المحفوظة بقيت كما هي.';

      returnToLogin(
        updated.email,
        `تم تحديث كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.${ownerNote}`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذّر تحديث كلمة المرور · Failed to update password.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGuestDemo = () => {
    const guest = loginAsGuest();
    onAuthenticated(guest);
    setError(null);
    setSuccessMessage(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#182111]/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-popover-in w-full max-w-md rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] shadow-2xl overflow-hidden max-h-[94dvh] overflow-y-auto">
        <div className="relative overflow-hidden flex items-center justify-between border-b border-[#3E522D] bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-6 py-4 text-[#FAFBF8]">
          <div className="islamic-geo-pattern pointer-events-none absolute inset-0 opacity-30" />
          <div className="relative">
            <h2 id="auth-modal-title" className="font-display text-lg font-bold text-white">
              {mode === 'login'
                ? 'Sign In to Qalam · تسجيل الدخول'
                : mode === 'register'
                  ? 'Create Account · إنشاء حساب'
                  : 'Reset Password · استعادة كلمة المرور'}
            </h2>
            <p className="font-arabic-cairo text-xs text-[#DCE5D3] mt-0.5">
              {mode === 'forgot'
                ? 'أدخل بريدك الإلكتروني المسجّل للتحقق وتعيين كلمة مرور جديدة.'
                : 'احفظ مفرداتك وملاحظاتك وسجلّ قراءتك في مكان واحد.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#DCE5D3] hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5 bg-white">
          {/* Mode Tabs (Sign In / Register) */}
          {mode !== 'forgot' ? (
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#DCE5D3] bg-[#EEF2E9] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  mode === 'login'
                    ? 'bg-white text-[#2D3B22] shadow-xs'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
                }`}
              >
                <LogIn className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                <span>Sign In · دخول</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setSuccessMessage(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  mode === 'register'
                    ? 'bg-white text-[#2D3B22] shadow-xs'
                    : 'text-[#5A6552] hover:text-[#1F2718]'
                }`}
              >
                <UserPlus className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                <span>Register · حساب جديد</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => returnToLogin(resetEmail || email)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                <span>Back to Sign In · العودة للدخول</span>
              </button>

              <span className="inline-flex items-center gap-1 rounded-full border border-[#FACC15]/60 bg-[#16200F] px-2.5 py-0.5 text-[10px] font-semibold text-[#FACC15]">
                <KeyRound className="h-3 w-3" aria-hidden="true" />
                <span>{verifiedAccount ? 'Step 2/2' : 'Step 1/2'}</span>
              </span>
            </div>
          )}

          {successMessage && (
            <div className="flex items-start gap-2.5 rounded-xl border border-[#3B4D2B]/35 bg-[#EEF2E9] px-3.5 py-2.5 text-xs font-medium text-[#2D3B22]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#3B4D2B]" aria-hidden="true" />
              <span dir="auto" className="leading-relaxed">
                {successMessage}
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-amber-300 bg-[#FEF7E6] px-3.5 py-2.5 text-xs font-medium text-[#7C4A03]">
              <span dir="auto">{error}</span>
            </div>
          )}

          {mode !== 'forgot' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-name"
                    className="flex items-center justify-between text-xs font-semibold text-[#2D3B22] mb-1.5"
                  >
                    <span>Username</span>
                    <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#3B4D2B]">
                      اسم المستخدم
                    </span>
                  </label>
                  <div className="relative">
                    <User
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7861]"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-name"
                      type="text"
                      required
                      minLength={2}
                      dir="auto"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="اسم المستخدم · e.g. Layla Hassan"
                      className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4A338]/30"
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="flex items-center justify-between text-xs font-semibold text-[#2D3B22] mb-1.5"
                >
                  <span>Email</span>
                  <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#3B4D2B]">
                    البريد الإلكتروني
                  </span>
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7861]"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4A338]/30"
                  />
                </div>
              </div>

              {mode === 'register' && (
                <div>
                  <label
                    htmlFor="auth-confirm-email"
                    className="flex items-center justify-between text-xs font-semibold text-[#2D3B22] mb-1.5"
                  >
                    <span>Confirm Email</span>
                    <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#3B4D2B]">
                      تأكيد البريد الإلكتروني
                    </span>
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7861]"
                      aria-hidden="true"
                    />
                    <input
                      id="auth-confirm-email"
                      type="email"
                      required
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                      placeholder="Re-enter your email · أعد إدخال البريد الإلكتروني"
                      className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4A338]/30"
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="auth-password"
                  className="flex items-center justify-between text-xs font-semibold text-[#2D3B22] mb-1.5"
                >
                  <span>Password</span>
                  <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#3B4D2B]">
                    كلمة المرور
                  </span>
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7861]"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === 'register'
                        ? `${MIN_PASSWORD_LENGTH} characters minimum · ${MIN_PASSWORD_LENGTH} أحرف على الأقل`
                        : 'Enter your password'
                    }
                    className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-10 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4A338]/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#6B7861] hover:bg-[#EEF2E9] hover:text-[#2D3B22] cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                {mode === 'login' && (
                  <div className="mt-1.5 flex justify-end">
                    <button
                      type="button"
                      onClick={openForgotPasswordFlow}
                      className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-semibold text-[#3B4D2B] hover:text-[#2D3B22] hover:underline decoration-[#FACC15] decoration-2 underline-offset-4 transition-colors cursor-pointer"
                    >
                      <KeyRound className="h-3 w-3 text-[#D4A338]" aria-hidden="true" />
                      <span dir="rtl" lang="ar" className="font-arabic-cairo">
                        نسيت كلمة المرور؟
                      </span>
                      <span className="text-[#5A6552]">/</span>
                      <span>Forgot Password?</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-[linear-gradient(135deg,#24301B_0%,#3E522D_100%)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
              >
                {loading
                  ? 'جاري المعالجة · Please wait...'
                  : mode === 'login'
                    ? 'Sign In · تسجيل الدخول'
                    : 'Create Account · إنشاء الحساب'}
              </button>
            </form>
          ) : !verifiedAccount ? (
            /* Forgot Password — Step 1: Verify Registered Email */
            <form onSubmit={handleVerifyResetEmail} className="space-y-4">
              <div className="rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] p-3.5 text-xs text-[#5A6552] leading-relaxed">
                <p className="font-arabic-cairo font-semibold text-[#2D3B22]">
                  أدخل بريدك الإلكتروني المسجّل للتحقق من وجود الحساب وتعيين كلمة مرور جديدة مباشرةً.
                </p>
                <p className="mt-1 text-[11px]">
                  Enter your registered email address to verify your account and set a new password directly.
                </p>
              </div>

              <div>
                <label
                  htmlFor="auth-reset-email"
                  className="flex items-center justify-between text-xs font-semibold text-[#2D3B22] mb-1.5"
                >
                  <span>Registered Email</span>
                  <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#3B4D2B]">
                    البريد الإلكتروني المسجّل
                  </span>
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7861]"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-reset-email"
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="apooood@gmail.com"
                    className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FACC15]/45"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
              >
                <ShieldCheck className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
                <span>تحقق من الحساب · Verify Account</span>
              </button>
            </form>
          ) : (
            /* Forgot Password — Step 2: Set & Confirm New Password */
            <form onSubmit={handleConfirmPasswordReset} className="space-y-4">
              <div className="rounded-xl border border-[#3B4D2B]/35 bg-[#EEF2E9]/75 p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#2D3B22]">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#3B4D2B] shrink-0" aria-hidden="true" />
                      <span>Account Verified · تم التحقق من الحساب</span>
                    </div>
                    <p className="mt-1 text-sm font-bold text-[#1F2718] truncate">
                      {verifiedAccount.name}
                    </p>
                    <p className="text-xs text-[#5A6552] truncate">{verifiedAccount.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVerifiedAccount(null);
                      setError(null);
                    }}
                    className="shrink-0 rounded-lg border border-[#DCE5D3] bg-white px-2 py-1 text-[11px] font-semibold text-[#2D3B22] hover:bg-[#FAFBF8] cursor-pointer"
                  >
                    تغيير · Change
                  </button>
                </div>

                {verifiedAccount.isPrimaryOwner && (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-[#FACC15]/70 bg-[#16200F] px-2.5 py-1 text-[11px] font-semibold text-[#FEF08A]">
                    <Crown className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
                    <span>Primary Owner · المالك الرئيسي (Admin Role &amp; Data Preserved)</span>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="auth-new-password"
                  className="flex items-center justify-between text-xs font-semibold text-[#2D3B22] mb-1.5"
                >
                  <span>New Password</span>
                  <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#3B4D2B]">
                    كلمة المرور الجديدة
                  </span>
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7861]"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={`${MIN_PASSWORD_LENGTH} characters minimum · ${MIN_PASSWORD_LENGTH} أحرف على الأقل`}
                    className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-10 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FACC15]/45"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#6B7861] hover:bg-[#EEF2E9] hover:text-[#2D3B22] cursor-pointer"
                  >
                    {showNewPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="auth-confirm-new-password"
                  className="flex items-center justify-between text-xs font-semibold text-[#2D3B22] mb-1.5"
                >
                  <span>Confirm New Password</span>
                  <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#3B4D2B]">
                    تأكيد كلمة المرور الجديدة
                  </span>
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7861]"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-confirm-new-password"
                    type={showConfirmNewPassword ? 'text' : 'password'}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter new password · أعد إدخال كلمة المرور"
                    className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-10 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FACC15]/45"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmNewPassword((prev) => !prev)}
                    aria-label={
                      showConfirmNewPassword ? 'Hide confirm password' : 'Show confirm password'
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#6B7861] hover:bg-[#EEF2E9] hover:text-[#2D3B22] cursor-pointer"
                  >
                    {showConfirmNewPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH && (
                  <p className="mt-1 text-[11px] font-medium text-amber-800">
                    يجب أن تتكون كلمة المرور من {MIN_PASSWORD_LENGTH} أحرف على الأقل · Minimum {MIN_PASSWORD_LENGTH} characters.
                  </p>
                )}
                {confirmNewPassword.length > 0 && newPassword !== confirmNewPassword && (
                  <p className="mt-1 text-[11px] font-medium text-amber-800">
                    كلمتا المرور غير متطابقتين · Passwords do not match.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
              >
                <KeyRound className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
                <span>
                  {loading
                    ? 'جاري الحفظ · Updating Password...'
                    : 'تعيين كلمة المرور الجديدة · Update Password'}
                </span>
              </button>
            </form>
          )}

          {mode !== 'forgot' && (
            <>
              <div className="relative flex items-center py-0.5">
                <div className="grow border-t border-[#DCE5D3]" />
                <span className="mx-3 shrink text-[11px] font-medium text-[#6B7861]">
                  or try instantly · أو جرّب فورًا
                </span>
                <div className="grow border-t border-[#DCE5D3]" />
              </div>

              <button
                type="button"
                onClick={handleGuestDemo}
                className="w-full rounded-xl border border-[#DCE5D3] bg-[#EEF2E9] px-4 py-2.5 text-xs font-semibold text-[#2D3B22] hover:bg-[#DCE5D3]/70 transition-colors cursor-pointer active:scale-[0.99]"
              >
                Continue in Guest Demo Mode (No Password Needed)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
