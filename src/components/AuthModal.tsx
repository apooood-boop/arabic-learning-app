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
  MailCheck,
  RefreshCw,
  ShieldCheck,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { AuthUser } from '../types/arabic';
import {
  completeSupabasePasswordRecovery,
  EmailNotConfirmedError,
  loginAsGuest,
  loginWithEmail,
  MIN_PASSWORD_LENGTH,
  registerWithEmail,
  resendSignupVerificationEmail,
  resetPasswordByEmail,
  sendPasswordResetEmail,
  verifySignupOtp,
  type VerifiedPasswordResetAccount,
} from '../utils/auth';

export type AuthModalMode = 'login' | 'register' | 'verify_email' | 'forgot' | 'recovery';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register' | 'forgot' | 'recovery';
  initialEmail?: string;
  initialNotice?: string | null;
  initialError?: string | null;
  onClose: () => void;
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthModal({
  isOpen,
  initialMode = 'login',
  initialEmail = '',
  initialNotice = null,
  initialError = null,
  onClose,
  onAuthenticated,
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [successMessage, setSuccessMessage] = useState<string | null>(initialNotice);

  // Email verification / OTP state
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [resendingEmail, setResendingEmail] = useState(false);
  const [needsConfirmationPromptEmail, setNeedsConfirmationPromptEmail] = useState<string | null>(
    null
  );

  // Forgot-password state (Supabase email link + offline fallback)
  const [resetEmail, setResetEmail] = useState('');
  const [resetLinkSent, setResetLinkSent] = useState(false);
  const [verifiedAccount, setVerifiedAccount] =
    useState<VerifiedPasswordResetAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      if (initialEmail) {
        setEmail(initialEmail);
        setResetEmail(initialEmail);
      }
      setError(initialError ?? null);
      setSuccessMessage(initialNotice ?? null);
      setVerifiedAccount(null);
      setResetLinkSent(false);
      setNeedsConfirmationPromptEmail(null);
      setOtpCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      setShowPassword(false);
      setShowNewPassword(false);
      setShowConfirmNewPassword(false);
    }
  }, [isOpen, initialMode, initialEmail, initialNotice, initialError]);

  if (!isOpen) return null;

  const openForgotPasswordFlow = () => {
    setError(null);
    setSuccessMessage(null);
    setVerifiedAccount(null);
    setResetLinkSent(false);
    setNeedsConfirmationPromptEmail(null);
    setResetEmail(email.trim());
    setNewPassword('');
    setConfirmNewPassword('');
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
    setMode('forgot');
  };

  const openVerifyEmailFlow = (targetEmail: string, notice?: string) => {
    setError(null);
    setNeedsConfirmationPromptEmail(null);
    setPendingVerifyEmail(targetEmail.trim().toLowerCase());
    setOtpCode('');
    setSuccessMessage(
      notice ??
        'تم إرسال رسالة تأكيد إلى بريدك الإلكتروني. اضغط على رابط التفعيل أو أدخل رمز التحقق أدناه.'
    );
    setMode('verify_email');
  };

  const returnToLogin = (prefillEmail?: string, notice?: string) => {
    setMode('login');
    if (prefillEmail !== undefined) {
      setEmail(prefillEmail);
    }
    setPassword('');
    setShowPassword(false);
    setVerifiedAccount(null);
    setResetLinkSent(false);
    setNeedsConfirmationPromptEmail(null);
    setOtpCode('');
    setNewPassword('');
    setConfirmNewPassword('');
    setError(null);
    setSuccessMessage(notice ?? null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setNeedsConfirmationPromptEmail(null);

    if (mode === 'register') {
      if (email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
        setError(
          'البريد الإلكتروني وتأكيد البريد الإلكتروني غير متطابقين · Email addresses must match.'
        );
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === 'register') {
        const result = await registerWithEmail({
          name,
          email,
          confirmEmail,
          password,
        });

        if (result.requiresEmailVerification || !result.user) {
          openVerifyEmailFlow(result.email, result.message);
          setPassword('');
          return;
        }

        onAuthenticated(result.user);
        setName('');
        setEmail('');
        setConfirmEmail('');
        setPassword('');
        onClose();
        return;
      }

      const user = await loginWithEmail({ email, password });
      onAuthenticated(user);
      setName('');
      setEmail('');
      setConfirmEmail('');
      setPassword('');
      onClose();
    } catch (err) {
      if (err instanceof EmailNotConfirmedError) {
        setNeedsConfirmationPromptEmail(err.email);
      }
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const user = await verifySignupOtp({
        email: pendingVerifyEmail,
        token: otpCode,
      });
      onAuthenticated(user);
      setName('');
      setEmail('');
      setConfirmEmail('');
      setPassword('');
      setOtpCode('');
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذّر التحقق من الرمز · Invalid or expired verification code.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = (pendingVerifyEmail || email).trim();
    if (!targetEmail || resendingEmail) return;
    setError(null);
    setResendingEmail(true);
    try {
      const msg = await resendSignupVerificationEmail(targetEmail);
      setSuccessMessage(msg);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذّر إعادة إرسال رسالة التأكيد · Unable to resend verification email.'
      );
    } finally {
      setResendingEmail(false);
    }
  };

  const handleSendResetEmail = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const res = await sendPasswordResetEmail(resetEmail);
      if (res.mode === 'supabase_email') {
        setResetLinkSent(true);
        setVerifiedAccount(null);
        setSuccessMessage(res.message);
      } else if (res.verifiedAccount) {
        setVerifiedAccount(res.verifiedAccount);
        setResetLinkSent(false);
        setNewPassword('');
        setConfirmNewPassword('');
      }
    } catch (err) {
      setVerifiedAccount(null);
      setResetLinkSent(false);
      setError(
        err instanceof Error
          ? err.message
          : 'تعذّر إرسال رابط استعادة كلمة المرور · Unable to send password reset email.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmLocalPasswordReset = async (e: FormEvent) => {
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

  const handleCompleteSupabaseRecovery = async (e: FormEvent) => {
    e.preventDefault();
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
      const res = await completeSupabasePasswordRecovery({
        newPassword,
        confirmPassword: confirmNewPassword,
      });

      if (res.user) {
        onAuthenticated(res.user);
        onClose();
        return;
      }

      returnToLogin(
        res.email,
        'تم تحديث كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.'
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'تعذّر تعيين كلمة المرور الجديدة · Failed to update password.'
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

  const isAuthTabMode = mode === 'login' || mode === 'register';

  const headerTitle =
    mode === 'login'
      ? 'Sign In to Qalam · تسجيل الدخول'
      : mode === 'register'
        ? 'Create Account · إنشاء حساب'
        : mode === 'verify_email'
          ? 'Verify Email · تأكيد البريد الإلكتروني'
          : mode === 'recovery'
            ? 'Set New Password · تعيين كلمة مرور جديدة'
            : 'Reset Password · استعادة كلمة المرور';

  const headerSubtitle =
    mode === 'verify_email'
      ? 'تحقق من بريدك الإلكتروني لإكمال تفعيل حسابك في قلم.'
      : mode === 'recovery'
        ? 'أدخل كلمة المرور الجديدة لتأمين حسابك واستئناف التعلّم.'
        : mode === 'forgot'
          ? 'أدخل بريدك الإلكتروني المسجّل لإرسال رابط إعادة تعيين كلمة المرور.'
          : 'احفظ مفرداتك وملاحظاتك وسجلّ قراءتك في مكان واحد.';

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
              {headerTitle}
            </h2>
            <p dir="rtl" lang="ar" className="font-arabic-cairo text-xs text-[#DCE5D3] mt-0.5">
              {headerSubtitle}
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
          {/* Mode Tabs (Sign In / Register) or Back Header */}
          {isAuthTabMode ? (
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
                  setNeedsConfirmationPromptEmail(null);
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
                  setNeedsConfirmationPromptEmail(null);
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
                onClick={() => returnToLogin(pendingVerifyEmail || resetEmail || email)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-[#D4A338]" aria-hidden="true" />
                <span>Back to Sign In · العودة للدخول</span>
              </button>

              <span className="inline-flex items-center gap-1 rounded-full border border-[#FACC15]/60 bg-[#16200F] px-2.5 py-0.5 text-[10px] font-semibold text-[#FACC15]">
                {mode === 'verify_email' ? (
                  <>
                    <MailCheck className="h-3 w-3" aria-hidden="true" />
                    <span>تأكيد البريد</span>
                  </>
                ) : mode === 'recovery' ? (
                  <>
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    <span>تعيين كلمة المرور</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="h-3 w-3" aria-hidden="true" />
                    <span>{verifiedAccount ? 'Step 2/2' : 'استعادة الحساب'}</span>
                  </>
                )}
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
            <div className="rounded-xl border border-amber-300 bg-[#FEF7E6] px-3.5 py-2.5 text-xs font-medium text-[#7C4A03] space-y-2">
              <p dir="auto" className="leading-relaxed">
                {error}
              </p>
              {needsConfirmationPromptEmail && (
                <button
                  type="button"
                  onClick={() => openVerifyEmailFlow(needsConfirmationPromptEmail)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2D3B22] px-3 py-1.5 text-[11px] font-bold text-[#FACC15] hover:bg-[#3B4D2B] transition-colors cursor-pointer"
                >
                  <MailCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>تأكيد البريد / إدخال رمز التحقق · Verify Email</span>
                </button>
              )}
            </div>
          )}

          {isAuthTabMode && (
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
          )}

          {mode === 'verify_email' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="rounded-xl border border-[#3B4D2B]/35 bg-[#EEF2E9]/70 p-3.5 text-xs text-[#2D3B22] space-y-1.5">
                <div className="flex items-center gap-2 font-bold">
                  <MailCheck className="h-4 w-4 text-[#3B4D2B] shrink-0" aria-hidden="true" />
                  <span dir="rtl" lang="ar" className="font-arabic-cairo">
                    بانتظار تأكيد البريد الإلكتروني
                  </span>
                </div>
                <p className="font-mono text-[11px] font-semibold text-[#1F2718] break-all">
                  {pendingVerifyEmail}
                </p>
                <p dir="rtl" lang="ar" className="font-arabic-cairo text-[11px] text-[#3B4D2B] leading-relaxed">
                  افتح رسالة التأكيد في بريدك واضغط على رابط التفعيل، أو أدخل رمز التحقق (OTP) المكون من 6 أرقام أدناه إذا وصلك رمز تحقق.
                </p>
              </div>

              <div>
                <label
                  htmlFor="auth-otp-code"
                  className="flex items-center justify-between text-xs font-semibold text-[#2D3B22] mb-1.5"
                >
                  <span>Verification Code (OTP)</span>
                  <span dir="rtl" lang="ar" className="font-arabic-cairo text-[#3B4D2B]">
                    رمز التحقق (إن وُجد)
                  </span>
                </label>
                <input
                  id="auth-otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\s+/g, ''))}
                  placeholder="123456"
                  className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-4 py-2.5 text-center font-mono text-base tracking-[0.35em] font-bold text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FACC15]/45"
                />
              </div>

              <button
                type="submit"
                disabled={loading || otpCode.trim().length < 6}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-55 shadow-sm transition-all cursor-pointer"
              >
                <ShieldCheck className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
                <span>
                  {loading
                    ? 'جاري التحقق · Verifying...'
                    : 'تأكيد الرمز وتفعيل الحساب · Verify Code'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendingEmail}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-4 py-2 text-xs font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] disabled:opacity-60 transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-[#D4A338] ${resendingEmail ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {resendingEmail
                    ? 'جاري إعادة الإرسال...'
                    : 'إعادة إرسال رسالة التأكيد · Resend Confirmation Email'}
                </span>
              </button>
            </form>
          )}

          {mode === 'forgot' && !verifiedAccount && (
            /* Forgot Password: Send Supabase Reset Email (or fallback verify) */
            <form onSubmit={handleSendResetEmail} className="space-y-4">
              <div className="rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] p-3.5 text-xs text-[#5A6552] leading-relaxed">
                <p dir="rtl" lang="ar" className="font-arabic-cairo font-semibold text-[#2D3B22]">
                  أدخل بريدك الإلكتروني المسجّل وسنرسل لك رابطًا آمنًا لإعادة تعيين كلمة المرور.
                </p>
                <p className="mt-1 text-[11px]">
                  Enter your registered email address to receive a secure password reset link.
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
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FACC15]/45"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
              >
                <KeyRound className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
                <span>
                  {loading
                    ? 'جاري الإرسال · Sending...'
                    : resetLinkSent
                      ? 'إعادة إرسال رابط الاستعادة · Resend Reset Link'
                      : 'إرسال رابط استعادة كلمة المرور · Send Reset Link'}
                </span>
              </button>
            </form>
          )}

          {mode === 'forgot' && verifiedAccount && (
            /* Offline/Local Fallback Step 2: Set & Confirm New Password */
            <form onSubmit={handleConfirmLocalPasswordReset} className="space-y-4">
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

          {mode === 'recovery' && (
            /* Supabase Auth PASSWORD_RECOVERY handler */
            <form onSubmit={handleCompleteSupabaseRecovery} className="space-y-4">
              <div className="rounded-xl border border-[#3B4D2B]/35 bg-[#EEF2E9]/75 p-3.5 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#2D3B22]">
                  <ShieldCheck className="h-4 w-4 text-[#3B4D2B] shrink-0" aria-hidden="true" />
                  <span dir="rtl" lang="ar" className="font-arabic-cairo">
                    تم التحقق من رابط استعادة كلمة المرور بنجاح
                  </span>
                </div>
                {initialEmail && (
                  <p className="font-mono text-[11px] font-semibold text-[#1F2718]">
                    {initialEmail}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="auth-recovery-password"
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
                    id="auth-recovery-password"
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
                  htmlFor="auth-recovery-confirm"
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
                    id="auth-recovery-confirm"
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
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#2D3B22_0%,#3B4D2B_100%)] px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60 shadow-sm transition-all active:scale-[0.99] cursor-pointer"
              >
                <KeyRound className="h-4 w-4 text-[#FACC15]" aria-hidden="true" />
                <span>
                  {loading
                    ? 'جاري الحفظ · Saving Password...'
                    : 'حفظ كلمة المرور الجديدة · Save New Password'}
                </span>
              </button>
            </form>
          )}

          {isAuthTabMode && (
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
