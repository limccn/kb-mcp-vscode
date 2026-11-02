export type Locale = "zh" | "en" | "ja";

export type IconName = "mcp" | "schema" | "section" | "history" | "graph" | "git";

export type TerminalTone = "normal" | "accent" | "muted";

export interface PortalContent {
  meta: {
    title: string;
    description: string;
    ogAlt: string;
  };
  nav: {
    features: string;
    compare: string;
    quickstart: string;
    install: string;
    skip: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
    note: string;
  };
  terminal: {
    command: string;
    lines: Array<{ label: string; value: string; tone: TerminalTone }>;
    note: string;
  };
  positioning: {
    title: string;
    subtitle: string;
    cards: Array<{ title: string; body: string }>;
    punchline: string;
  };
  features: {
    title: string;
    subtitle: string;
    items: Array<{ icon: IconName; title: string; body: string }>;
  };
  comparison: {
    title: string;
    subtitle: string;
    dimensionLabel: string;
    columns: [string, string, string, string];
    rows: Array<{
      dimension: string;
      values: [string, string, string, string];
    }>;
  };
  quickstart: {
    title: string;
    subtitle: string;
    steps: Array<{ title: string; body: string; code?: string }>;
    note: string;
  };
  status: {
    title: string;
    body: string;
    items: Array<{ label: string; value: string }>;
  };
  cta: {
    title: string;
    body: string;
    primary: string;
    secondary: string;
    note: string;
  };
  footer: {
    tagline: string;
    license: string;
    copyright: string;
  };
}