import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

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
  const [storedValue, setStoredValue] = useState<T>(() => readFromStorage(key, initialValue));
  const prevKeyRef = useRef(key);

  if (prevKeyRef.current !== key) {
    prevKeyRef.current = key;
    const nextVal = readFromStorage(key, initialValue);
    setStoredValue(nextVal);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch {
      // Ignore storage quota errors
    }
  }, [key, storedValue]);

  const setValue = useCallback(
    (updater: SetStateAction<T>) => {
      setStoredValue((prev) =>
        typeof updater === 'function'
          ? (updater as (prevState: T) => T)(prev)
          : updater
      );
    },
    []
  );

  return [storedValue, setValue] as const;
}
