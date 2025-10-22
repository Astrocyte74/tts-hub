import { useCallback, useEffect, useRef, useState } from 'react';

export function useSessionStorage<T>(key: string, initialValue: T): [T, (next: T | ((prev: T) => T)) => void] {
  const initialRef = useRef(initialValue);

  useEffect(() => {
    initialRef.current = initialValue;
  }, [initialValue]);

  const readValue = useCallback((): T => {
    if (typeof window === 'undefined') {
      return initialRef.current;
    }
    try {
      const stored = window.sessionStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initialRef.current;
    } catch {
      return initialRef.current;
    }
  }, [key]);

  const [value, setValue] = useState<T>(() => readValue());

  const persist = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem(key, JSON.stringify(resolved));
          } catch {
            // ignore quota errors
          }
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, persist];
}
