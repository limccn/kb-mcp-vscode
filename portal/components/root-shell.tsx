import type { ReactNode } from "react";
import { getContent } from "@/content";
import type { Locale } from "@/content/types";
import { HTML_LANG } from "@/lib/site";
import { buildSoftwareApplicationJsonLd } from "@/lib/structured-data";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function RootShell({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const content = getContent(locale);
  const jsonLd = JSON.stringify(
    buildSoftwareApplicationJsonLd(locale),
  ).replace(/</g, "\\u003c");

  return (
    <html lang={HTML_LANG[locale]}>
      <body>
        <a className="skip-link" href="#main">
          {content.nav.skip}
        </a>
        <SiteHeader locale={locale} content={content} />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter content={content} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
      </body>
    </html>
  );
}