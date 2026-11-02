import type { PortalContent } from "@/content/types";
import { GITHUB_URL, MARKETPLACE_URL } from "@/lib/site";
import { ExternalLinkIcon, GitHubIcon } from "./icons";

export function Cta({ content }: { content: PortalContent["cta"] }) {
  return (
    <section className="section" id="install" aria-labelledby="install-title">
      <div className="container-page">
        <div className="cta-band">
          <h2 className="cta-title" id="install-title">
            {content.title}
          </h2>
          <p className="cta-body">{content.body}</p>

          <div className="cta-actions">
            <a
              className="btn btn-primary"
              href={MARKETPLACE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {content.primary}
              <ExternalLinkIcon className="icon" />
            </a>
            <a
              className="btn btn-secondary"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {content.secondary}
              <GitHubIcon className="icon" />
            </a>
          </div>

          <p className="cta-note">{content.note}</p>
        </div>
      </div>
    </section>
  );
}