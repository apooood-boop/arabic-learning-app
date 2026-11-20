import { AuthUser, UserRole } from '../types/arabic';

const ACCOUNTS_KEY = 'qalam_accounts_v1';
const ACTIVE_USER_KEY = 'qalam_active_user_v1';

interface StoredAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  salt: string;
  passwordHash: string;
  createdAt: number;
}

function generateSalt(): string {
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const input = `${salt}:${password}`;
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(input);
    const buffer = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buffer), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
  }
  // Fallback deterministic digest if SubtleCrypto is unavailable
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function loadAccounts(): StoredAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

function saveAccounts(accounts: StoredAccount[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore quota errors
  }
}

export function getActiveUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function saveActiveUser(user: AuthUser | null) {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      window.localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(user));
    } else {
      window.localStorage.removeItem(ACTIVE_USER_KEY);
    }
  } catch {
    // Ignore quota errors
  }
}

export async function registerWithEmail(params: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}): Promise<AuthUser> {
  const name = params.name.trim();
  const email = params.email.trim().toLowerCase();
  const password = params.password;

  if (!name || name.length < 2) {
    throw new Error('Please enter your full name (at least 2 characters).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const accounts = loadAccounts();
  if (accounts.some((a) => a.email === email)) {
    throw new Error('An account with this email already exists. Please sign in instead.');
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const newAccount: StoredAccount = {
    id: `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    email,
    role: params.role,
    salt,
    passwordHash,
    createdAt: Date.now(),
  };

  saveAccounts([...accounts, newAccount]);

  const user: AuthUser = {
    id: newAccount.id,
    name: newAccount.name,
    email: newAccount.email,
    role: newAccount.role,
    createdAt: newAccount.createdAt,
  };
  saveActiveUser(user);
  return user;
}

export async function loginWithEmail(params: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  const email = params.email.trim().toLowerCase();
  const password = params.password;

  if (!email || !password) {
    throw new Error('Please enter both your email and password.');
  }

  const accounts = loadAccounts();
  const account = accounts.find((a) => a.email === email);
  if (!account) {
    throw new Error('No account found for that email. Try registering or using Guest Demo.');
  }

  const candidateHash = await hashPassword(password, account.salt);
  if (candidateHash !== account.passwordHash) {
    throw new Error('Incorrect password. Please try again.');
  }

  const user: AuthUser = {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    createdAt: account.createdAt,
  };
  saveActiveUser(user);
  return user;
}

export function loginAsGuest(): AuthUser {
  const guestUser: AuthUser = {
    id: 'guest-demo',
    name: 'Guest Learner',
    email: 'guest@qalam.local',
    role: 'student',
    isGuest: true,
    createdAt: Date.now(),
  };
  saveActiveUser(guestUser);
  return guestUser;
}

export function logoutUser() {
  saveActiveUser(null);
}

export function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Q';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
