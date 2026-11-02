import type { MetadataRoute } from "next";
import type { Locale } from "@/content/types";
import { LOCALE_PATH, SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

const LOCALE_ORDER: Locale[] = ["zh", "en", "ja"];

export default function sitemap(): MetadataRoute.Sitemap {
  return LOCALE_ORDER.map((locale) => ({
    url: `${SITE_URL}${LOCALE_PATH[locale]}`,
    changeFrequency: "weekly",
    priority: locale === "zh" ? 1 : 0.8,
    alternates: {
      languages: {
        "zh-CN": `${SITE_URL}/`,
        en: `${SITE_URL}/en/`,
        ja: `${SITE_URL}/ja/`,
      },
    },
  }));
}