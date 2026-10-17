/**
 * useI18n — MnemoPlayer's translation hook (EN / FR / ES, doc 151).
 *
 * Same structure as Ember's and MnemoLingua's: one JSON file per language,
 * add the bundle to BUNDLES and the code to LangCode.
 */
import { useEffect, useState } from 'react';
import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';

export type LangCode = 'en' | 'fr' | 'es';

const BUNDLES: Record<LangCode, Record<string, unknown>> = { en, fr, es };

let _lang: LangCode = 'en';
const _listeners = new Set<() => void>();

function isLang(v: unknown): v is LangCode {
  return typeof v === 'string' && v in BUNDLES;
}

/** Take the shell's language if this cartridge ships it; otherwise stay put. */
export function adoptHostLang(lang: unknown): void {
  if (!isLang(lang) || lang === _lang) return;
  _lang = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  _listeners.forEach((fn) => fn());
}

function lookup(bundle: Record<string, unknown>, path: string): string | null {
  let cur: unknown = bundle;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : null;
}

/**
 * Missing keys fall back to English, then to the key itself (visibly wrong).
 * With `count: 1` a `<key>_one` variant is used when the bundle has one, so
 * "1 new comments" never reaches the screen; every other count uses `<key>`.
 */
export function translate(key: string, vars?: Record<string, string | number>): string {
  const one = vars?.count === 1 ? (lookup(BUNDLES[_lang], `${key}_one`) ?? lookup(BUNDLES.en, `${key}_one`)) : null;
  const raw = one ?? lookup(BUNDLES[_lang], key) ?? lookup(BUNDLES.en, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function useI18n(): { t: typeof translate; lang: LangCode } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);
  return { t: translate, lang: _lang };
}
