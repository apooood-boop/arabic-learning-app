import { useEffect, useState, type FormEvent } from 'react';
import { LogIn, Mail, Lock, User, UserPlus, X } from 'lucide-react';
import { AuthUser } from '../types/arabic';
import {
  loginAsGuest,
  loginWithEmail,
  registerWithEmail,
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
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

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

  const handleGuestDemo = () => {
    const guest = loginAsGuest();
    onAuthenticated(guest);
    setError(null);
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
              {mode === 'login' ? 'Sign In to Qalam · تسجيل الدخول' : 'Create Account · إنشاء حساب'}
            </h2>
            <p className="font-arabic-cairo text-xs text-[#DCE5D3] mt-0.5">
              احفظ مفرداتك وملاحظاتك وسجلّ قراءتك في مكان واحد.
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
          {/* Mode Tabs */}
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

          {error && (
            <div className="rounded-xl border border-amber-300 bg-[#FEF7E6] px-3.5 py-2.5 text-xs font-medium text-[#7C4A03]">
              {error}
            </div>
          )}

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
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === 'register'
                      ? '6 characters minimum · 6 أحرف على الأقل'
                      : 'Enter your password'
                  }
                  className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] pl-9 pr-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#1F2718] focus:border-[#3B4D2B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#D4A338]/30"
                />
              </div>
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
        </div>
      </div>
    </div>
  );
}
