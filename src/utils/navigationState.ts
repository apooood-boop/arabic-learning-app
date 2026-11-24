import { ActiveTab } from '../types/arabic';

export type NavSection =
  | 'home'
  | 'history'
  | 'levels'
  | 'vocabulary'
  | 'exams'
  | 'conversation';

export interface AppNavigationRoute {
  tab: ActiveTab;
  navSection: NavSection;
  lessonId: string | null;
}

export interface ParsedHashResult {
  route: AppNavigationRoute;
  isValid: boolean;
}

export const DEFAULT_NAVIGATION_ROUTE: AppNavigationRoute = {
  tab: 'lessons',
  navSection: 'home',
  lessonId: null,
};

const VALID_TABS = new Set<ActiveTab>([
  'lessons',
  'vocabulary',
  'history',
  'exams',
  'conversation',
]);

const NAV_ROUTE_STORAGE_PREFIX = 'qalam_nav_route_v1::';
const NAV_SCROLL_STORAGE_PREFIX = 'qalam_nav_scroll_v1::';
const MAX_STORED_SCROLL_ENTRIES = 24;

export function serializeRouteToHash(route: AppNavigationRoute): string {
  if (route.tab === 'lessons') {
    if (route.lessonId) {
      return `#/lesson/${encodeURIComponent(route.lessonId)}`;
    }
    if (route.navSection === 'levels') {
      return '#/levels';
    }
    return '#/lessons';
  }
  if (route.tab === 'vocabulary') return '#/vocabulary';
  if (route.tab === 'history') return '#/history';
  if (route.tab === 'exams') return '#/exams';
  if (route.tab === 'conversation') return '#/conversation';
  return '#/lessons';
}

export function parseHashToRoute(rawHash: string): ParsedHashResult | null {
  const trimmed = rawHash.trim();
  if (!trimmed || trimmed === '#' || trimmed === '#/') {
    return null;
  }

  const normalized = trimmed.replace(/^#\/?/, '').split('?')[0].trim();
  if (!normalized) {
    return null;
  }

  if (normalized === 'lessons' || normalized === 'home') {
    return {
      route: { tab: 'lessons', navSection: 'home', lessonId: null },
      isValid: true,
    };
  }
  if (normalized === 'levels') {
    return {
      route: { tab: 'lessons', navSection: 'levels', lessonId: null },
      isValid: true,
    };
  }
  if (normalized === 'vocabulary') {
    return {
      route: { tab: 'vocabulary', navSection: 'vocabulary', lessonId: null },
      isValid: true,
    };
  }
  if (normalized === 'history') {
    return {
      route: { tab: 'history', navSection: 'history', lessonId: null },
      isValid: true,
    };
  }
  if (normalized === 'exams') {
    return {
      route: { tab: 'exams', navSection: 'exams', lessonId: null },
      isValid: true,
    };
  }
  if (normalized === 'conversation') {
    return {
      route: { tab: 'conversation', navSection: 'conversation', lessonId: null },
      isValid: true,
    };
  }

  if (normalized.startsWith('lesson/')) {
    const encodedId = normalized.slice('lesson/'.length);
    if (!encodedId) {
      return { route: DEFAULT_NAVIGATION_ROUTE, isValid: false };
    }
    try {
      const lessonId = decodeURIComponent(encodedId).trim();
      if (!lessonId) {
        return { route: DEFAULT_NAVIGATION_ROUTE, isValid: false };
      }
      return {
        route: { tab: 'lessons', navSection: 'home', lessonId },
        isValid: true,
      };
    } catch {
      return { route: DEFAULT_NAVIGATION_ROUTE, isValid: false };
    }
  }

  return { route: DEFAULT_NAVIGATION_ROUTE, isValid: false };
}

export function validateRouteAgainstLessons(
  route: AppNavigationRoute,
  validLessonIds: Set<string>
): { route: AppNavigationRoute; fellBack: boolean } {
  if (!VALID_TABS.has(route.tab)) {
    return { route: DEFAULT_NAVIGATION_ROUTE, fellBack: true };
  }

  if (route.tab === 'lessons') {
    if (route.lessonId) {
      if (validLessonIds.has(route.lessonId)) {
        return {
          route: { tab: 'lessons', navSection: 'home', lessonId: route.lessonId },
          fellBack: false,
        };
      }
      return { route: DEFAULT_NAVIGATION_ROUTE, fellBack: true };
    }

    const navSection: NavSection = route.navSection === 'levels' ? 'levels' : 'home';
    return {
      route: { tab: 'lessons', navSection, lessonId: null },
      fellBack: false,
    };
  }

  const navSection: NavSection = route.tab;
  return {
    route: { tab: route.tab, navSection, lessonId: null },
    fellBack: false,
  };
}

export function readSavedRoute(scope: string): AppNavigationRoute | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`${NAV_ROUTE_STORAGE_PREFIX}${scope}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppNavigationRoute>;
    if (!parsed || typeof parsed !== 'object' || !parsed.tab || !VALID_TABS.has(parsed.tab)) {
      return null;
    }
    const lessonId =
      parsed.tab === 'lessons' && typeof parsed.lessonId === 'string' && parsed.lessonId.trim()
        ? parsed.lessonId.trim()
        : null;
    const navSection: NavSection =
      parsed.tab === 'lessons'
        ? parsed.navSection === 'levels' && !lessonId
          ? 'levels'
          : 'home'
        : parsed.tab;
    return {
      tab: parsed.tab,
      navSection,
      lessonId,
    };
  } catch {
    return null;
  }
}

export function saveRouteToSession(scope: string, route: AppNavigationRoute): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      `${NAV_ROUTE_STORAGE_PREFIX}${scope}`,
      JSON.stringify({
        tab: route.tab,
        navSection: route.navSection,
        lessonId: route.lessonId,
      })
    );
  } catch {
    // Ignore storage errors (private browsing / quota)
  }
}

export function readSavedScrollY(scope: string, routeHash: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(`${NAV_SCROLL_STORAGE_PREFIX}${scope}`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return 0;
    const val = parsed[routeHash];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      return Math.round(val);
    }
    return 0;
  } catch {
    return 0;
  }
}

export function saveScrollY(scope: string, routeHash: string, scrollY: number): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${NAV_SCROLL_STORAGE_PREFIX}${scope}`;
    const raw = window.sessionStorage.getItem(key);
    let existing: Record<string, number> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
              existing[k] = v;
            }
          }
        }
      } catch {
        existing = {};
      }
    }

    const normalizedY = Math.max(0, Math.round(scrollY));
    delete existing[routeHash];
    existing[routeHash] = normalizedY;

    const entries = Object.entries(existing);
    if (entries.length > MAX_STORED_SCROLL_ENTRIES) {
      existing = Object.fromEntries(entries.slice(entries.length - MAX_STORED_SCROLL_ENTRIES));
    }

    window.sessionStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // Ignore storage errors
  }
}

export function clearUrlHash(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.hash) return;
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`
    );
  } catch {
    window.location.hash = '';
  }
}

export function syncUrlHash(targetHash: string, mode: 'push' | 'replace' = 'push'): void {
  if (typeof window === 'undefined') return;
  if (window.location.hash === targetHash) return;
  try {
    const nextUrl = `${window.location.pathname}${window.location.search}${targetHash}`;
    if (mode === 'replace') {
      window.history.replaceState(window.history.state, '', nextUrl);
    } else {
      window.history.pushState(window.history.state, '', nextUrl);
    }
  } catch {
    window.location.hash = targetHash;
  }
}

export function clearNavigationPersistence(scope?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (scope) {
      window.sessionStorage.removeItem(`${NAV_ROUTE_STORAGE_PREFIX}${scope}`);
      window.sessionStorage.removeItem(`${NAV_SCROLL_STORAGE_PREFIX}${scope}`);
    } else {
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const key = window.sessionStorage.key(i);
        if (
          key &&
          (key.startsWith(NAV_ROUTE_STORAGE_PREFIX) ||
            key.startsWith(NAV_SCROLL_STORAGE_PREFIX))
        ) {
          window.sessionStorage.removeItem(key);
        }
      }
    }
  } catch {
    // Ignore storage errors
  }
  clearUrlHash();
}

export function resolveInitialNavigation(
  isAuthenticated: boolean,
  scope: string,
  validLessonIds: Set<string>
): {
  route: AppNavigationRoute;
  restoreScrollY: number;
  shouldReplaceHash: boolean;
  shouldClearHash: boolean;
} {
  if (typeof window === 'undefined' || !isAuthenticated) {
    return {
      route: DEFAULT_NAVIGATION_ROUTE,
      restoreScrollY: 0,
      shouldReplaceHash: false,
      shouldClearHash: typeof window !== 'undefined' && Boolean(window.location.hash),
    };
  }

  const parsedHash = parseHashToRoute(window.location.hash);
  if (parsedHash) {
    if (!parsedHash.isValid) {
      return {
        route: DEFAULT_NAVIGATION_ROUTE,
        restoreScrollY: 0,
        shouldReplaceHash: true,
        shouldClearHash: false,
      };
    }
    const validated = validateRouteAgainstLessons(parsedHash.route, validLessonIds);
    const routeHash = serializeRouteToHash(validated.route);
    return {
      route: validated.route,
      restoreScrollY: validated.fellBack ? 0 : readSavedScrollY(scope, routeHash),
      shouldReplaceHash: validated.fellBack,
      shouldClearHash: false,
    };
  }

  const savedRoute = readSavedRoute(scope);
  if (savedRoute) {
    const validated = validateRouteAgainstLessons(savedRoute, validLessonIds);
    const routeHash = serializeRouteToHash(validated.route);
    return {
      route: validated.route,
      restoreScrollY: validated.fellBack ? 0 : readSavedScrollY(scope, routeHash),
      shouldReplaceHash: true,
      shouldClearHash: false,
    };
  }

  return {
    route: DEFAULT_NAVIGATION_ROUTE,
    restoreScrollY: readSavedScrollY(scope, serializeRouteToHash(DEFAULT_NAVIGATION_ROUTE)),
    shouldReplaceHash: false,
    shouldClearHash: false,
  };
}
