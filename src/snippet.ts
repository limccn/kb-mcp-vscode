/**
 * Search-result context windows for the sidebar webview.
 *
 * The admin API returns the highlight-marked FTS snippet plus the full document
 * body. The snippet alone is only a dozen tokens, which reads as a single
 * clipped line in the sidebar, so the webview receives a window of the body
 * around the first match instead: a short window by default and a longer one
 * behind the "Show more" toggle. Segments are plain text plus a `match` flag —
 * the webview never inserts HTML.
 */

export interface SnippetSegment {
  text: string;
  match: boolean;
}

export interface SnippetView {
  collapsed: SnippetSegment[];
  expanded: SnippetSegment[];
  expandable: boolean;
  plain: string;
}

const COLLAPSED_BEFORE = 160;
const COLLAPSED_AFTER = 340;
const EXPANDED_BEFORE = 900;
const EXPANDED_AFTER = 1500;
const SNAP = 40;

function stripTags(value: string): string {
  return String(value || "").replace(/<[^>]*>/g, "");
}

/** Compare terms case-insensitively while keeping the display spelling. */
function dedupe(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** FTS actually matched these words; use them in addition to the raw query. */
function markedTerms(snippetMarkup: string): string[] {
  const terms: string[] = [];
  const pattern = /<b>([\s\S]*?)<\/b>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(snippetMarkup || ""))) !== null) {
    terms.push(stripTags(match[1]));
  }
  return terms;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBody(value: string): string {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstMatchIndex(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  let best = -1;
  for (const term of terms) {
    const index = haystack.indexOf(term.toLowerCase());
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function isBoundary(char: string | undefined): boolean {
  return char === undefined || char === "\n" || /\s/.test(char);
}

function windowText(
  text: string,
  anchor: number,
  before: number,
  after: number
): { start: number; end: number; text: string } {
  let start = Math.max(0, anchor - before);
  let end = Math.min(text.length, anchor + after);

  if (start > 0) {
    const limit = Math.min(start + SNAP, end);
    for (let i = start; i < limit; i += 1) {
      if (isBoundary(text[i])) {
        start = i + 1;
        break;
      }
    }
  }
  if (end < text.length) {
    const limit = Math.max(end - SNAP, start);
    for (let i = end - 1; i >= limit; i -= 1) {
      if (isBoundary(text[i])) {
        end = i;
        break;
      }
    }
  }
  if (end <= start) end = Math.min(text.length, start + 1);

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return { start, end, text: prefix + text.slice(start, end) + suffix };
}

function highlight(text: string, terms: string[]): SnippetSegment[] {
  if (!terms.length) return [{ text, match: false }];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  const segments: SnippetSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), match: false });
    segments.push({ text: match[0], match: true });
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments.length ? segments : [{ text, match: false }];
}

/** Build the collapsed and expanded context windows for one search hit. */
export function buildSnippetView(
  query: string,
  body: string,
  snippetMarkup: string
): SnippetView {
  const terms = dedupe([...query.split(/\s+/), ...markedTerms(snippetMarkup)]);
  const text = normalizeBody(body) || stripTags(snippetMarkup).trim();
  if (!text) {
    return { collapsed: [], expanded: [], expandable: false, plain: "" };
  }

  const anchor = Math.max(0, firstMatchIndex(text, terms));
  const collapsedWindow = windowText(text, anchor, COLLAPSED_BEFORE, COLLAPSED_AFTER);
  const expandedWindow = windowText(text, anchor, EXPANDED_BEFORE, EXPANDED_AFTER);
  const collapsed = highlight(collapsedWindow.text, terms);
  const expanded = highlight(expandedWindow.text, terms);

  return {
    collapsed,
    expanded,
    expandable:
      expandedWindow.start !== collapsedWindow.start ||
      expandedWindow.end !== collapsedWindow.end,
    plain: collapsed.map((segment) => segment.text).join(""),
  };
}