import type { Metadata } from "next";
import { getContent } from "@/content";
import type { Locale } from "@/content/types";
import {
  OG_LOCALE,
  LOCALE_PATH,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

const ALTERNATE_LOCALES: Record<Locale, string[]> = {
  zh: ["en_US", "ja_JP"],
  en: ["zh_CN", "ja_JP"],
  ja: ["zh_CN", "en_US"],
};

export function buildMetadata(locale: Locale): Metadata {
  const content = getContent(locale);
  const path = LOCALE_PATH[locale];

  return {
    metadataBase: new URL(SITE_URL),
    title: content.meta.title,
    description: content.meta.description,
    applicationName: SITE_NAME,
    category: "developer tools",
    alternates: {
      canonical: path,
      languages: {
        "zh-CN": "/",
        en: "/en/",
        ja: "/ja/",
        "x-default": "/",
      },
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: content.meta.title,
      description: content.meta.description,
      url: path,
      locale: OG_LOCALE[locale],
      alternateLocale: ALTERNATE_LOCALES[locale],
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: content.meta.ogAlt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: content.meta.title,
      description: content.meta.description,
      images: ["/og.png"],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}