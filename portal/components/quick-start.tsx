import type { PortalContent } from "@/content/types";
import { SectionHeading } from "./section-heading";

export function QuickStart({
  content,
}: {
  content: PortalContent["quickstart"];
}) {
  return (
    <section
      className="section section-alt"
      id="quickstart"
      aria-labelledby="quickstart-title"
    >
      <div className="container-page">
        <SectionHeading
          id="quickstart-title"
          title={content.title}
          subtitle={content.subtitle}
        />

        <div className="quickstart-grid">
          {content.steps.map((step, index) => (
            <article key={step.title} className="card">
              <div className="step-header">
                <span className="step-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="card-title">{step.title}</h3>
              </div>
              <p className="card-body">{step.body}</p>
              {step.code ? (
                <pre className="code-block">
                  <code>{step.code}</code>
                </pre>
              ) : null}
            </article>
          ))}
        </div>

        <p className="quickstart-note">{content.note}</p>
      </div>
    </section>
  );
}