import type { PortalContent } from "@/content/types";
import { MARKETPLACE_URL } from "@/lib/site";
import { ArrowRightIcon, ExternalLinkIcon } from "./icons";
import { TerminalDemo } from "./terminal-demo";

export function Hero({ content }: { content: PortalContent }) {
  return (
    <section className="hero">
      <div className="container-page hero-grid">
        <div>
          <span className="eyebrow">{content.hero.eyebrow}</span>
          <h1 className="hero-title">{content.hero.title}</h1>
          <p className="hero-subtitle">{content.hero.subtitle}</p>

          <div className="hero-actions">
            <a
              className="btn btn-primary"
              href={MARKETPLACE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {content.hero.primaryCta}
              <ExternalLinkIcon className="icon" />
            </a>
            <a className="btn btn-secondary" href="#features">
              {content.hero.secondaryCta}
              <ArrowRightIcon className="icon" />
            </a>
          </div>

          <p className="hero-note">{content.hero.note}</p>
        </div>

        <TerminalDemo terminal={content.terminal} />
      </div>
    </section>
  );
}