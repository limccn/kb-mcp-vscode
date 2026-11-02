import { en } from "./en";
import { ja } from "./ja";
import { zh } from "./zh";
import type { Locale, PortalContent } from "./types";

export const INTL_LOCALES = ["en", "ja"] as const;

export const LOCALES = ["zh", "en", "ja"] as const;

const dictionaries: Record<Locale, PortalContent> = { zh, en, ja };

export function getContent(locale: Locale): PortalContent {
  return dictionaries[locale];
}

export function isLocale(value: string): value is Locale {
  return value === "zh" || value === "en" || value === "ja";
}

export type { Locale, PortalContent } from "./types";