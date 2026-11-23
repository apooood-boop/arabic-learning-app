import { AdminManagedAccount, AuthUser, UserRole } from '../types/arabic';
import {
  deleteProfileFromCloud,
  fetchAllProfilesFromCloud,
  fetchProfileFromCloudByEmail,
  syncRegisterProfileToCloud,
  updatePasswordInCloud,
  updateProfileRoleInCloud,
} from './supabaseSync';

const ACCOUNTS_KEY = 'qalam_accounts_v1';
const ACTIVE_USER_KEY = 'qalam_active_user_v1';

export const PRIMARY_OWNER_EMAIL = 'apooood@gmail.com';
export const MIN_PASSWORD_LENGTH = 6;

const ENV_OWNER_EMAIL = (() => {
  try {
    const metaEnv =
      typeof import.meta !== 'undefined'
        ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
        : undefined;
    return (metaEnv?.VITE_OWNER_EMAIL || '').trim().toLowerCase();
  } catch {
    return '';
  }
})();

interface StoredAccount {
  id: string;
  name: string;
  email: string;
  role?: UserRole | 'member';
  salt: string;
  passwordHash: string;
  createdAt: number;
}

export function isPrimaryOwnerEmail(email?: string | null): boolean {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === PRIMARY_OWNER_EMAIL ||
    (Boolean(ENV_OWNER_EMAIL) && normalized === ENV_OWNER_EMAIL)
  );
}

export function resolveAccountRole(email: string, storedRole?: string): UserRole {
  if (isPrimaryOwnerEmail(email)) {
    return 'admin';
  }
  if (storedRole === 'admin' || storedRole === 'moderator' || storedRole === 'student') {
    return storedRole;
  }
  // Migrate legacy 'member' accounts cleanly to default 'student' role
  return 'student';
}

export function isAdminUser(user: AuthUser | null | undefined): boolean {
  if (!user || user.isGuest) return false;
  return user.role === 'admin' || isPrimaryOwnerEmail(user.email);
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

function normalizeStoredAccount(account: StoredAccount): StoredAccount {
  const normalizedEmail = account.email.trim().toLowerCase();
  const role = resolveAccountRole(normalizedEmail, account.role);
  return {
    ...account,
    email: normalizedEmail,
    role,
  };
}

function loadAccounts(): StoredAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredAccount[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredAccount);
  } catch {
    return [];
  }
}

function saveAccounts(accounts: StoredAccount[]) {
  if (typeof window === 'undefined') return;
  try {
    const normalized = accounts.map(normalizeStoredAccount);
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore quota errors
  }
}

function toPublicAuthUser(account: StoredAccount): AuthUser {
  const normalized = normalizeStoredAccount(account);
  const role = resolveAccountRole(normalized.email, normalized.role);
  return {
    id: normalized.id,
    name: normalized.name,
    email: normalized.email,
    role,
    isPrimaryOwner: isPrimaryOwnerEmail(normalized.email),
    createdAt: normalized.createdAt,
  };
}

export function getActiveUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (parsed.isGuest) {
      return {
        id: parsed.id,
        name: parsed.name,
        email: parsed.email,
        isGuest: true,
        createdAt: parsed.createdAt,
      };
    }

    // Sync latest persisted role & permanent Primary Owner status while preserving user ID
    const accounts = loadAccounts();
    const matched = accounts.find(
      (a) =>
        a.id === parsed.id ||
        a.email.toLowerCase() === (parsed.email || '').trim().toLowerCase()
    );
    const email = (matched?.email || parsed.email || '').trim().toLowerCase();
    const role = resolveAccountRole(email, matched?.role ?? parsed.role);
    const isPrimaryOwner = isPrimaryOwnerEmail(email);

    return {
      id: parsed.id,
      name: matched?.name || parsed.name,
      email,
      role,
      isPrimaryOwner,
      isGuest: parsed.isGuest,
      createdAt: parsed.createdAt,
    };
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
  confirmEmail: string;
  password: string;
}): Promise<AuthUser> {
  const name = params.name.trim();
  const email = params.email.trim().toLowerCase();
  const confirmEmail = params.confirmEmail.trim().toLowerCase();
  const password = params.password;

  if (!name || name.length < 2) {
    throw new Error('يرجى إدخال اسم المستخدم (حرفين على الأقل) · Please enter a username.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('يرجى إدخال بريد إلكتروني صحيح · Please enter a valid email address.');
  }
  if (email !== confirmEmail) {
    throw new Error('البريد الإلكتروني وتأكيده غير متطابقين · Email addresses do not match.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل · Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  const accounts = loadAccounts();
  if (accounts.some((a) => a.email === email)) {
    throw new Error('يوجد حساب مسجّل بهذا البريد الإلكتروني بالفعل · An account with this email already exists.');
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const newAccount: StoredAccount = {
    id: `usr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    email,
    role: resolveAccountRole(email),
    salt,
    passwordHash,
    createdAt: Date.now(),
  };

  saveAccounts([...accounts, newAccount]);
  void syncRegisterProfileToCloud(newAccount);

  const user = toPublicAuthUser(newAccount);
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
    throw new Error('يرجى إدخال البريد الإلكتروني وكلمة المرور · Please enter both email and password.');
  }

  const accounts = loadAccounts();
  let account = accounts.find((a) => a.email === email);

  // If not in local cache, attempt to fetch from cloud
  if (!account) {
    const cloudProfile = await fetchProfileFromCloudByEmail(email);
    if (cloudProfile && cloudProfile.passwordHash) {
      account = {
        id: cloudProfile.id,
        name: cloudProfile.name,
        email: cloudProfile.email,
        role: cloudProfile.role,
        salt: cloudProfile.salt,
        passwordHash: cloudProfile.passwordHash,
        createdAt: cloudProfile.createdAt,
      };
      saveAccounts([...accounts, account]);
    }
  }

  if (!account) {
    throw new Error('لم يتم العثور على حساب بهذا البريد · No account found for that email.');
  }

  const candidateHash = await hashPassword(password, account.salt);
  if (candidateHash !== account.passwordHash) {
    throw new Error('كلمة المرور غير صحيحة · Incorrect password. Please try again.');
  }

  // Persist normalized role (ensuring Primary Owner always stores role = 'admin')
  saveAccounts(accounts);
  void syncRegisterProfileToCloud(account);

  const user = toPublicAuthUser(account);
  saveActiveUser(user);
  return user;
}

export interface VerifiedPasswordResetAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isPrimaryOwner: boolean;
}

export function verifyAccountForPasswordReset(emailInput: string): VerifiedPasswordResetAccount {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('يرجى إدخال بريد إلكتروني صحيح · Please enter a valid email address.');
  }

  const accounts = loadAccounts();
  const account = accounts.find((a) => a.email === email);
  if (!account) {
    throw new Error(
      'لم يتم العثور على حساب مسجّل بهذا البريد الإلكتروني · No registered account found for that email.'
    );
  }

  const role = resolveAccountRole(account.email, account.role);
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role,
    isPrimaryOwner: isPrimaryOwnerEmail(account.email),
  };
}

export async function resetPasswordByEmail(params: {
  email: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<VerifiedPasswordResetAccount> {
  const email = params.email.trim().toLowerCase();
  const { newPassword, confirmPassword } = params;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('يرجى إدخال بريد إلكتروني صحيح · Please enter a valid email address.');
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `كلمة المرور الجديدة يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل · New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
  if (newPassword !== confirmPassword) {
    throw new Error(
      'كلمتا المرور غير متطابقتين · New password and confirmation do not match.'
    );
  }

  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.email === email);
  if (idx === -1) {
    throw new Error(
      'لم يتم العثور على حساب مسجّل بهذا البريد الإلكتروني · No registered account found for that email.'
    );
  }

  const existing = accounts[idx];
  const salt = generateSalt();
  const passwordHash = await hashPassword(newPassword, salt);
  const preservedRole = resolveAccountRole(existing.email, existing.role);

  // Strictly preserve existing id, name, email, createdAt, and Primary Owner/admin role
  // so all saved vocabulary cards, notes, and reading history keyed by id remain intact.
  const updatedAccount: StoredAccount = {
    ...existing,
    email: existing.email,
    role: preservedRole,
    salt,
    passwordHash,
  };

  const nextAccounts = [...accounts];
  nextAccounts[idx] = updatedAccount;
  saveAccounts(nextAccounts);
  void updatePasswordInCloud({ email: updatedAccount.email, salt, passwordHash });

  const active = getActiveUser();
  if (active && !active.isGuest && (active.id === updatedAccount.id || active.email === updatedAccount.email)) {
    saveActiveUser(toPublicAuthUser(updatedAccount));
  }

  return {
    id: updatedAccount.id,
    name: updatedAccount.name,
    email: updatedAccount.email,
    role: preservedRole,
    isPrimaryOwner: isPrimaryOwnerEmail(updatedAccount.email),
  };
}

function toAdminManagedAccount(account: StoredAccount): AdminManagedAccount {
  const normalized = normalizeStoredAccount(account);
  return {
    id: normalized.id,
    name: normalized.name,
    email: normalized.email,
    role: resolveAccountRole(normalized.email, normalized.role),
    isPrimaryOwner: isPrimaryOwnerEmail(normalized.email),
    createdAt: normalized.createdAt,
  };
}

export function listAccountsForAdmin(actorUser: AuthUser | null): AdminManagedAccount[] {
  if (!isAdminUser(actorUser)) {
    throw new Error('صلاحيات المشرف العام (Admin) مطلوبة · Admin privileges are required.');
  }
  return loadAccounts()
    .map(toAdminManagedAccount)
    .sort((a, b) => {
      if (a.isPrimaryOwner !== b.isPrimaryOwner) return a.isPrimaryOwner ? -1 : 1;
      const rank: Record<UserRole, number> = { admin: 0, moderator: 1, student: 2 };
      if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role];
      return b.createdAt - a.createdAt;
    });
}

export async function listAccountsForAdminAsync(
  actorUser: AuthUser | null
): Promise<AdminManagedAccount[]> {
  if (!isAdminUser(actorUser)) {
    throw new Error('صلاحيات المشرف العام (Admin) مطلوبة · Admin privileges are required.');
  }

  try {
    const cloudAccounts = await fetchAllProfilesFromCloud();
    if (cloudAccounts && cloudAccounts.length > 0) {
      const local = loadAccounts();
      const localMap = new Map(local.map((a) => [a.id, a]));

      for (const ca of cloudAccounts) {
        if (!localMap.has(ca.id)) {
          local.push({
            id: ca.id,
            name: ca.name,
            email: ca.email,
            role: ca.role,
            salt: '',
            passwordHash: '',
            createdAt: ca.createdAt,
          });
        } else {
          const existing = localMap.get(ca.id)!;
          existing.name = ca.name;
          existing.role = ca.role;
        }
      }
      saveAccounts(local);

      return cloudAccounts.sort((a, b) => {
        if (a.isPrimaryOwner !== b.isPrimaryOwner) return a.isPrimaryOwner ? -1 : 1;
        const rank: Record<UserRole, number> = { admin: 0, moderator: 1, student: 2 };
        if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role];
        return b.createdAt - a.createdAt;
      });
    }
  } catch (err) {
    console.warn('[Qalam Supabase] Failed to fetch accounts async, falling back to local:', err);
  }

  return listAccountsForAdmin(actorUser);
}

export function adminUpdateUserRole(params: {
  actorUser: AuthUser | null;
  targetUserId: string;
  nextRole: UserRole;
}): AdminManagedAccount[] {
  if (!isAdminUser(params.actorUser)) {
    throw new Error('صلاحيات الأدمن مطلوبة · Admin privileges are required.');
  }

  if (params.nextRole !== 'student' && params.nextRole !== 'moderator' && params.nextRole !== 'admin') {
    throw new Error('دور غير صالح · Invalid role specified.');
  }

  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === params.targetUserId);
  if (idx === -1) {
    throw new Error('المستخدم غير موجود · User account not found.');
  }

  const target = accounts[idx];
  if (isPrimaryOwnerEmail(target.email) && params.nextRole !== 'admin') {
    throw new Error(
      'لا يمكن تخفيض رتبة المالك الرئيسي الدائم · The Primary Owner Admin role is immutable and cannot be downgraded.'
    );
  }
  if (params.actorUser && target.id === params.actorUser.id && params.nextRole !== 'admin') {
    throw new Error(
      'لا يمكنك تغيير صلاحيتك من أدمن أثناء جلستك النشطة · You cannot downgrade your own active admin session.'
    );
  }

  const updated: StoredAccount = {
    ...target,
    role: isPrimaryOwnerEmail(target.email) ? 'admin' : params.nextRole,
  };

  const nextAccounts = [...accounts];
  nextAccounts[idx] = updated;
  saveAccounts(nextAccounts);
  void updateProfileRoleInCloud(target.id, target.email, params.nextRole);

  const active = getActiveUser();
  if (active && !active.isGuest && active.id === updated.id) {
    saveActiveUser(toPublicAuthUser(updated));
  }

  return listAccountsForAdmin(params.actorUser);
}

export function adminDeleteUser(params: {
  actorUser: AuthUser | null;
  targetUserId: string;
}): AdminManagedAccount[] {
  if (!isAdminUser(params.actorUser)) {
    throw new Error('صلاحيات الأدمن مطلوبة · Admin privileges are required.');
  }

  const accounts = loadAccounts();
  const target = accounts.find((a) => a.id === params.targetUserId);
  if (!target) {
    throw new Error('المستخدم غير موجود · User account not found.');
  }

  if (isPrimaryOwnerEmail(target.email)) {
    throw new Error(
      'لا يمكن حذف حساب المالك الرئيسي الدائم · The Primary Owner account cannot be deleted.'
    );
  }
  if (params.actorUser && target.id === params.actorUser.id) {
    throw new Error(
      'لا يمكنك حذف حسابك النشط حاليًا · You cannot delete your own currently signed-in account.'
    );
  }

  const nextAccounts = accounts.filter((a) => a.id !== params.targetUserId);
  saveAccounts(nextAccounts);
  void deleteProfileFromCloud(target.id, target.email);

  return listAccountsForAdmin(params.actorUser);
}

export async function adminResetUserPassword(params: {
  actorUser: AuthUser | null;
  targetUserId: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ id: string; name: string; email: string }> {
  if (!isAdminUser(params.actorUser)) {
    throw new Error('صلاحيات الأدمن مطلوبة · Admin privileges are required.');
  }

  const { newPassword, confirmPassword } = params;
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل · Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
  if (newPassword !== confirmPassword) {
    throw new Error(
      'كلمتا المرور غير متطابقتين · Password and confirmation do not match.'
    );
  }

  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === params.targetUserId);
  if (idx === -1) {
    throw new Error('المستخدم غير موجود · User account not found.');
  }

  const target = accounts[idx];
  const salt = generateSalt();
  const passwordHash = await hashPassword(newPassword, salt);

  const updated: StoredAccount = {
    ...target,
    role: resolveAccountRole(target.email, target.role),
    salt,
    passwordHash,
  };

  const nextAccounts = [...accounts];
  nextAccounts[idx] = updated;
  saveAccounts(nextAccounts);
  void updatePasswordInCloud({ email: target.email, salt, passwordHash });

  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
  };
}

export function loginAsGuest(): AuthUser {
  const guestUser: AuthUser = {
    id: 'guest-demo',
    name: 'Guest Learner',
    email: 'guest@qalam.local',
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
