import type { PortalContent } from "@/content/types";
import { SectionHeading } from "./section-heading";

export function ComparisonTable({
  content,
}: {
  content: PortalContent["comparison"];
}) {
  return (
    <section
      className="section"
      id="compare"
      aria-labelledby="compare-title"
    >
      <div className="container-page">
        <SectionHeading
          id="compare-title"
          title={content.title}
          subtitle={content.subtitle}
        />

        <div className="comparison-wrap">
          <table className="comparison-table">
            <caption className="sr-only">{content.title}</caption>
            <thead>
              <tr>
                <th scope="col">{content.dimensionLabel}</th>
                {content.columns.map((column, index) => (
                  <th
                    key={column}
                    scope="col"
                    className={index === 3 ? "is-hyseed" : undefined}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {content.rows.map((row) => (
                <tr key={row.dimension}>
                  <th scope="row">{row.dimension}</th>
                  {row.values.map((value, index) => (
                    <td
                      key={content.columns[index]}
                      data-label={content.columns[index]}
                      className={index === 3 ? "is-hyseed" : undefined}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}