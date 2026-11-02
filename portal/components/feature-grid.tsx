import type { PortalContent } from "@/content/types";
import { Icon } from "./icons";
import { SectionHeading } from "./section-heading";

export function FeatureGrid({
  content,
}: {
  content: PortalContent["features"];
}) {
  return (
    <section
      className="section section-alt"
      id="features"
      aria-labelledby="features-title"
    >
      <div className="container-page">
        <SectionHeading
          id="features-title"
          title={content.title}
          subtitle={content.subtitle}
        />

        <div className="grid-3">
          {content.items.map((item) => (
            <article key={item.title} className="card">
              <div className="icon-tile">
                <Icon name={item.icon} className="icon" />
              </div>
              <h3 className="card-title">{item.title}</h3>
              <p className="card-body">{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}