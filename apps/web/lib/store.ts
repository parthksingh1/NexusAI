"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Persistent local collection — backs CRUD UI without needing a backend.
 * Each item must have a stable `id`. State is serialized to localStorage,
 * so create/update/delete persist across reloads.
 */
export function useLocalCollection<T extends { id: string }>(
  key: string,
  initial: T[],
): {
  items: T[];
  add: (item: T) => void;
  update: (id: string, patch: Partial<T>) => void;
  remove: (id: string) => void;
  reset: () => void;
} {
  const [items, setItems] = useState<T[]>(initial);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setItems(parsed as T[]);
      }
    } catch { /* ignore corrupted state */ }
    setHydrated(true);
  }, [key]);

  // Persist on change (after hydration so we don't clobber existing state).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch { /* quota or private mode */ }
  }, [key, items, hydrated]);

  const add    = useCallback((item: T) => setItems((arr) => [item, ...arr]), []);
  const update = useCallback((id: string, patch: Partial<T>) =>
    setItems((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x))), []);
  const remove = useCallback((id: string) =>
    setItems((arr) => arr.filter((x) => x.id !== id)), []);
  const reset  = useCallback(() => {
    setItems(initial);
    if (typeof window !== "undefined") localStorage.removeItem(key);
  }, [initial, key]);

  return { items, add, update, remove, reset };
}

/**
 * Persisted scalar / object value (e.g. a settings form).
 */
export function useLocalValue<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch { /* ignore */ }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* */ }
  }, [key, value, hydrated]);

  return [value, setValue];
}
