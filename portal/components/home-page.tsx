import type { PortalContent } from "@/content/types";
import { ComparisonTable } from "./comparison-table";
import { Cta } from "./cta";
import { FeatureGrid } from "./feature-grid";
import { Hero } from "./hero";
import { Positioning } from "./positioning";
import { QuickStart } from "./quick-start";
import { StatusStrip } from "./status-strip";

export function HomePage({ content }: { content: PortalContent }) {
  return (
    <>
      <Hero content={content} />
      <Positioning content={content.positioning} />
      <FeatureGrid content={content.features} />
      <ComparisonTable content={content.comparison} />
      <QuickStart content={content.quickstart} />
      <StatusStrip content={content.status} />
      <Cta content={content.cta} />
    </>
  );
}