import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/core/store';
import ar from './ar.json';
import en from './en.json';

const translations = { ar, en } as const;

export function useTranslation() {
  const language = useAppStore((state) => state.language);
  const currentTranslations = useMemo(
    () => translations[language] as Record<string, unknown>,
    [language]
  );

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const keys = key.split('.');
    let value: unknown = currentTranslations;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key;
      }
    }
    if (typeof value !== 'string') return key;
    if (!params) return value;
    return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey) =>
      paramKey in params ? String(params[paramKey]) : `{{${paramKey}}}`
    );
  }, [currentTranslations]);

  return { t, language };
}

export type Lang = 'ar' | 'en';
