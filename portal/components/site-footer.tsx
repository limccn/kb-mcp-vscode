import type { PortalContent } from "@/content/types";
import { GITHUB_URL, MARKETPLACE_URL, OPEN_VSX_URL } from "@/lib/site";
import { ExternalLinkIcon, GitHubIcon, SeedlingMark } from "./icons";

export function SiteFooter({ content }: { content: PortalContent }) {
  return (
    <footer className="site-footer">
      <div className="container-page footer-grid">
        <div>
          <a className="footer-brand" href="#main">
            <SeedlingMark className="brand-mark" />
            <span>hyseed</span>
          </a>
          <p className="footer-tagline">{content.footer.tagline}</p>
          <p className="footer-meta">
            {content.footer.license} · {content.footer.copyright}
          </p>
        </div>

        <div>
          <div className="footer-links">
            <a
              className="footer-link"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon className="mr-1 h-4 w-4" />
              GitHub
            </a>
            <a
              className="footer-link"
              href={MARKETPLACE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              VS Code Marketplace
              <ExternalLinkIcon className="ml-1 h-3.5 w-3.5" />
            </a>
            <a
              className="footer-link"
              href={OPEN_VSX_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open VSX
              <ExternalLinkIcon className="ml-1 h-3.5 w-3.5" />
            </a>
          </div>
          <p className="footer-meta">Windows x64 · VS Code 1.101+</p>
        </div>
      </div>
    </footer>
  );
}