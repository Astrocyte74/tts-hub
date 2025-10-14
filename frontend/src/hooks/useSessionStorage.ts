import { useCallback, useEffect, useRef, useState } from 'react';

export function useSessionStorage<T>(key: string, initialValue: T): [T, (next: T) => void] {
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
    (next: T) => {
      setValue(next);
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(key, JSON.stringify(next));
        } catch {
          // ignore quota errors
        }
      }
    },
    [key],
  );

  return [value, persist];
}

