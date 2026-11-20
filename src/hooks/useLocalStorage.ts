import { useCallback, useEffect, useState, type SetStateAction } from 'react';

function readFromStorage<T>(key: string, initialValue: T): T {
  if (typeof window === 'undefined') {
    return initialValue;
  }
  try {
    const item = window.localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : initialValue;
  } catch {
    return initialValue;
  }
}

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key,
    value: readFromStorage(key, initialValue),
  }));

  // Reload value synchronously when storage key changes (e.g. user logs in/out)
  if (state.key !== key) {
    const nextValue = readFromStorage(key, initialValue);
    setState({ key, value: nextValue });
  }

  useEffect(() => {
    if (state.key !== key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state.value));
    } catch {
      // Ignore storage quota errors
    }
  }, [key, state]);

  const setValue = useCallback(
    (updater: SetStateAction<T>) => {
      setState((prev) => {
        const current = prev.key === key ? prev.value : readFromStorage(key, initialValue);
        const nextValue =
          typeof updater === 'function'
            ? (updater as (prevState: T) => T)(current)
            : updater;
        return { key, value: nextValue };
      });
    },
    [key, initialValue]
  );

  const activeValue = state.key === key ? state.value : readFromStorage(key, initialValue);

  return [activeValue, setValue] as const;
}
