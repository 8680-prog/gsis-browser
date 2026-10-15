import { useEffect, useState } from 'react';

/**
 * localStorage helpers. Storage can be unavailable (private mode, blocked
 * site data) or full, so every access is guarded and the app keeps working
 * with in-memory state.
 */

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled: keep the in-memory value only.
  }
}

export function usePersistentState<T>(key: string, initial: T, validate?: (value: T) => T) {
  const [value, setValue] = useState<T>(() => {
    const stored = readJson<T>(key, initial);
    return validate ? validate(stored) : stored;
  });

  useEffect(() => {
    writeJson(key, value);
  }, [key, value]);

  // Keep several open copies of the app in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || event.newValue === null) return;
      try {
        const next = JSON.parse(event.newValue) as T;
        setValue(validate ? validate(next) : next);
      } catch {
        // Ignore malformed values written by something else.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, validate]);

  return [value, setValue] as const;
}


let counter = 0;
export function createId(prefix = 'id'): string {
  counter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}-${counter}`;
}
