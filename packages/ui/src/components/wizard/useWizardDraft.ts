/**
 * useWizardDraft — Auto-save wizard state to localStorage and restore on mount.
 *
 * Usage:
 *   const draft = useWizardDraft<MyState>('ai-provider', { /* defaults * / });
 *   draft.update({ apiKey: 'sk-...' });   // saves immediately (debounced)
 *   draft.clear();                         // call on successful complete
 *   draft.hasSavedDraft                    // true if a draft existed at mount
 *   draft.state                            // current state
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'ownpilot-wizard-draft:';
const DEBOUNCE_MS = 400;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Stored<T> {
  state: T;
  savedAt: number;
}

export interface WizardDraft<T> {
  state: T;
  update: (partial: Partial<T> | ((prev: T) => T)) => void;
  set: (next: T) => void;
  clear: () => void;
  hasSavedDraft: boolean;
}

export function useWizardDraft<T extends object>(
  wizardId: string,
  defaults: T,
  options: { sensitiveKeys?: (keyof T)[] } = {}
): WizardDraft<T> {
  const key = STORAGE_PREFIX + wizardId;
  const sensitive = options.sensitiveKeys ?? [];

  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Stored<T>;
      if (!parsed || typeof parsed !== 'object') return defaults;
      if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
        localStorage.removeItem(key);
        return defaults;
      }
      return { ...defaults, ...parsed.state };
    } catch {
      return defaults;
    }
  });

  const [hasSavedDraft] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const payload: Partial<T> = { ...state };
        for (const k of sensitive) {
          delete payload[k];
        }
        const stored: Stored<Partial<T>> = { state: payload, savedAt: Date.now() };
        localStorage.setItem(key, JSON.stringify(stored));
      } catch {
        // Quota or disabled storage — silently ignore.
      }
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, key]);

  const update = useCallback((partial: Partial<T> | ((prev: T) => T)) => {
    setState((prev) =>
      typeof partial === 'function' ? (partial as (p: T) => T)(prev) : { ...prev, ...partial }
    );
  }, []);

  const set = useCallback((next: T) => setState(next), []);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
    setState(defaults);
  }, [key, defaults]);

  return { state, update, set, clear, hasSavedDraft };
}

/** Remove a saved draft without instantiating the hook. */
export function clearWizardDraft(wizardId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + wizardId);
  } catch {
    /* noop */
  }
}

/**
 * Lightweight draft sync — works with existing `useState` calls.
 * On mount, applies any saved snapshot via `applySnapshot`. While the wizard
 * is open, snapshots from `getSnapshot()` are saved (debounced).
 */
export function useWizardDraftSync<T extends object>(
  wizardId: string,
  opts: {
    getSnapshot: () => T;
    applySnapshot: (s: Partial<T>) => void;
    /** Disable auto-save while in this state — e.g. final completion step. */
    paused?: boolean;
  }
): { clear: () => void; restored: boolean } {
  const key = STORAGE_PREFIX + wizardId;
  const { getSnapshot, applySnapshot, paused = false } = opts;
  const appliedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restored, setRestored] = useState(false);

  // Apply saved snapshot once on mount
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Stored<T>;
      if (!parsed || typeof parsed !== 'object') return;
      if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
        localStorage.removeItem(key);
        return;
      }
      applySnapshot(parsed.state);
      setRestored(true);
    } catch {
      /* noop */
    }
  }, [key]);

  // Debounced auto-save
  const snapshot = getSnapshot();
  useEffect(() => {
    if (paused) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const stored: Stored<T> = { state: snapshot, savedAt: Date.now() };
        localStorage.setItem(key, JSON.stringify(stored));
      } catch {
        /* noop */
      }
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [JSON.stringify(snapshot), paused, key]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  }, [key]);

  return { clear, restored };
}
