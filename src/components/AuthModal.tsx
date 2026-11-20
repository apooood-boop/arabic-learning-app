import { useEffect, useState, type FormEvent } from 'react';
import { GraduationCap, LogIn, UserCheck, UserPlus, X } from 'lucide-react';
import { AuthUser, UserRole } from '../types/arabic';
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
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('student');
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
    setLoading(true);

    try {
      const user =
        mode === 'register'
          ? await registerWithEmail({ name, email, password, role })
          : await loginWithEmail({ email, password });

      onAuthenticated(user);
      setName('');
      setEmail('');
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F1035]/55 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#ECE8EF] bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#581C87] bg-gradient-to-r from-[#3B0764] to-[#4C1D95] px-6 py-4 text-white">
          <div>
            <h2 id="auth-modal-title" className="font-display text-lg font-bold">
              {mode === 'login' ? 'Sign In to Qalam' : 'Create Learner Account'}
            </h2>
            <p className="text-xs text-purple-200 mt-0.5">
              Save your personal vocabulary deck, streak, and uploaded texts.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-purple-200 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Mode Tabs */}
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="grid grid-cols-2 gap-1 rounded-xl border border-[#ECE8EF] bg-[#F7F4F9] p-1"
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
                  ? 'bg-white text-[#241734] shadow-xs'
                  : 'text-zinc-600 hover:text-[#241734]'
              }`}
            >
              <LogIn className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
              <span>Sign In</span>
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
                  ? 'bg-white text-[#241734] shadow-xs'
                  : 'text-zinc-600 hover:text-[#241734]'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5 text-[#E11D48]" aria-hidden="true" />
              <span>Register</span>
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-semibold text-zinc-800 mb-1.5">
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Layla Hassan"
                    className="w-full rounded-xl border border-[#ECE8EF] bg-white px-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#241734] focus:border-[#E11D48] focus:outline-none focus:ring-2 focus:ring-[#E11D48]/20"
                  />
                </div>

                <div>
                  <span className="block text-xs font-semibold text-zinc-800 mb-1.5">
                    Account Role
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole('student')}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        role === 'student'
                          ? 'border-[#E11D48] bg-rose-50 text-rose-900'
                          : 'border-[#ECE8EF] bg-white text-zinc-600 hover:bg-[#F7F4F9]'
                      }`}
                    >
                      <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Student · طالب</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('teacher')}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        role === 'teacher'
                          ? 'border-[#4C1D95] bg-purple-50 text-[#4C1D95]'
                          : 'border-[#ECE8EF] bg-white text-zinc-600 hover:bg-[#F7F4F9]'
                      }`}
                    >
                      <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Teacher · معلّم</span>
                    </button>
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-semibold text-zinc-800 mb-1.5">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-[#ECE8EF] bg-white px-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#241734] focus:border-[#E11D48] focus:outline-none focus:ring-2 focus:ring-[#E11D48]/20"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-semibold text-zinc-800 mb-1.5">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'At least 6 characters' : 'Enter your password'}
                className="w-full rounded-xl border border-[#ECE8EF] bg-white px-3.5 py-2.5 sm:py-2 text-base sm:text-sm text-[#241734] focus:border-[#E11D48] focus:outline-none focus:ring-2 focus:ring-[#E11D48]/20"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-[#E11D48] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#BE123C] disabled:opacity-60 transition-colors cursor-pointer"
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="grow border-t border-[#ECE8EF]" />
            <span className="mx-3 shrink text-[11px] font-medium text-zinc-400">
              or try instantly
            </span>
            <div className="grow border-t border-[#ECE8EF]" />
          </div>

          <button
            type="button"
            onClick={handleGuestDemo}
            className="w-full rounded-xl border border-[#ECE8EF] bg-[#F7F4F9] px-4 py-2.5 text-xs font-semibold text-[#241734] hover:bg-purple-50/70 transition-colors cursor-pointer"
          >
            Continue in Guest Demo Mode (No Password Needed)
          </button>
        </div>
      </div>
    </div>
  );
}
