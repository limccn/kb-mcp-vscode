import type { PortalContent } from "@/content/types";
import { SectionHeading } from "./section-heading";

export function Positioning({
  content,
}: {
  content: PortalContent["positioning"];
}) {
  return (
    <section className="section">
      <div className="container-page">
        <SectionHeading title={content.title} subtitle={content.subtitle} />

        <div className="grid-3">
          {content.cards.map((card) => (
            <article key={card.title} className="card positioning-card">
              <h3 className="card-title">{card.title}</h3>
              <p className="card-body">{card.body}</p>
            </article>
          ))}
        </div>

        <p className="punchline">{content.punchline}</p>
      </div>
    </section>
  );
}