import type { Locale, PortalContent } from "@/content/types";
import {
  GITHUB_URL,
  HTML_LANG,
  LOCALE_LABEL,
  LOCALE_PATH,
  MARKETPLACE_URL,
} from "@/lib/site";
import {
  CloseIcon,
  ExternalLinkIcon,
  GitHubIcon,
  MenuIcon,
  SeedlingMark,
} from "./icons";
import { MobileMenu } from "./mobile-menu";

const LANGUAGE_ORDER: Locale[] = ["zh", "en", "ja"];

const SECTION_LINKS = [
  { key: "features", href: "#features" },
  { key: "compare", href: "#compare" },
  { key: "quickstart", href: "#quickstart" },
] as const;

export function SiteHeader({
  locale,
  content,
}: {
  locale: Locale;
  content: PortalContent;
}) {
  return (
    <header className="site-header">
      <div className="container-page header-inner">
        <a
          className="brand"
          href={LOCALE_PATH[locale]}
          aria-label={`hyseed — ${content.footer.tagline}`}
        >
          <SeedlingMark className="brand-mark" />
          <span>hyseed</span>
        </a>

        <nav className="desktop-nav" aria-label="Main">
          {SECTION_LINKS.map(({ key, href }) => (
            <a key={key} className="nav-link" href={href}>
              {content.nav[key]}
            </a>
          ))}
          <a className="nav-link" href="#install">
            {content.nav.install}
          </a>
        </nav>

        <div className="header-actions">
          <a
            className="header-github"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="hyseed on GitHub"
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
          <nav className="lang-switch" aria-label="Language">
            {LANGUAGE_ORDER.map((language) => (
              <a
                key={language}
                className="lang-link"
                href={LOCALE_PATH[language]}
                hrefLang={HTML_LANG[language]}
                aria-current={language === locale ? "page" : undefined}
              >
                {LOCALE_LABEL[language]}
              </a>
            ))}
          </nav>
          <a
            className="btn btn-primary btn-sm"
            href={MARKETPLACE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {content.cta.primary}
            <ExternalLinkIcon className="icon" />
          </a>
        </div>

        <MobileMenu>
          <summary aria-label="Menu">
            <MenuIcon className="mobile-menu-icon-open h-5 w-5" />
            <CloseIcon className="mobile-menu-icon-close h-5 w-5" />
          </summary>
          <div className="mobile-panel">
            <nav aria-label="Mobile">
              {SECTION_LINKS.map(({ key, href }) => (
                <a key={key} className="mobile-nav-link" href={href}>
                  {content.nav[key]}
                </a>
              ))}
              <a className="mobile-nav-link" href="#install">
                {content.nav.install}
              </a>
            </nav>

            <a
              className="mobile-nav-link mobile-github-link"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon className="h-5 w-5" />
              GitHub
            </a>

            <nav className="mobile-lang-row" aria-label="Language">
              {LANGUAGE_ORDER.map((language) => (
                <a
                  key={language}
                  className="lang-link"
                  href={LOCALE_PATH[language]}
                  hrefLang={HTML_LANG[language]}
                  aria-current={language === locale ? "page" : undefined}
                >
                  {LOCALE_LABEL[language]}
                </a>
              ))}
            </nav>

            <a
              className="btn btn-primary mobile-cta"
              href={MARKETPLACE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {content.cta.primary}
              <ExternalLinkIcon className="icon" />
            </a>
          </div>
        </MobileMenu>
      </div>
    </header>
  );
}