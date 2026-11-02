import { getContent } from "@/content";
import type { Locale } from "@/content/types";
import {
  GITHUB_URL,
  HTML_LANG,
  LICENSE_NAME,
  LOCALE_PATH,
  MARKETPLACE_URL,
  PUBLIC_VERSION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

export function buildSoftwareApplicationJsonLd(locale: Locale) {
  const content = getContent(locale);

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: content.meta.description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Windows 10, Windows 11",
    processorRequirements: "x64",
    softwareVersion: PUBLIC_VERSION,
    license: `https://opensource.org/licenses/${LICENSE_NAME}`,
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    downloadUrl: MARKETPLACE_URL,
    installUrl: MARKETPLACE_URL,
    codeRepository: GITHUB_URL,
    sameAs: [GITHUB_URL],
    inLanguage: HTML_LANG[locale],
    url: `${SITE_URL}${LOCALE_PATH[locale]}`,
  };
}