import type { PortalContent } from "@/content/types";
import { SectionHeading } from "./section-heading";

export function StatusStrip({
  content,
}: {
  content: PortalContent["status"];
}) {
  return (
    <section className="section" aria-labelledby="status-title">
      <div className="container-page">
        <SectionHeading id="status-title" title={content.title} />
        <p className="status-intro">{content.body}</p>

        <div className="status-grid">
          {content.items.map((item) => (
            <div key={item.label} className="status-item">
              <p className="status-label">{item.label}</p>
              <p className="status-value">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}