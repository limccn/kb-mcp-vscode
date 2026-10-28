/** Persistent, per-vault search history stored in the extension's global state. */

export interface HistoryMemento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export const HISTORY_KEY = "kbmcp.searchHistory";
export const MAX_STORED = 20;
export const MAX_SHOWN = 8;

type HistoryMap = Record<string, string[]>;

/** Trim, drop blanks/duplicates, and cap one vault's list. */
function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_STORED) break;
  }
  return out;
}

/** Read the whole map, silently discarding corrupt entries. */
function readMap(state: HistoryMemento): HistoryMap {
  const raw = state.get<unknown>(HISTORY_KEY, {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: HistoryMap = {};
  for (const [vault, value] of Object.entries(raw as Record<string, unknown>)) {
    const items = normalizeList(value);
    if (items.length) out[vault] = items;
  }
  return out;
}

export class SearchHistoryStore {
  constructor(private readonly state: HistoryMemento) {}

  /** Newest first, at most MAX_SHOWN entries. */
  items(vault: string): string[] {
    return (readMap(this.state)[vault] ?? []).slice(0, MAX_SHOWN);
  }

  /** Record a successful search; returns the vault's new list. */
  async record(vault: string, query: string): Promise<string[]> {
    const text = query.trim();
    if (!vault || !text) return this.items(vault);
    const map = readMap(this.state);
    const key = text.toLowerCase();
    map[vault] = [
      text,
      ...(map[vault] ?? []).filter((item) => item.toLowerCase() !== key),
    ].slice(0, MAX_STORED);
    await this.state.update(HISTORY_KEY, map);
    return map[vault].slice(0, MAX_SHOWN);
  }

  async remove(vault: string, query: string): Promise<string[]> {
    const key = query.trim().toLowerCase();
    const map = readMap(this.state);
    if (!vault || !key || !map[vault]) return this.items(vault);
    const next = map[vault].filter((item) => item.toLowerCase() !== key);
    if (next.length) map[vault] = next;
    else delete map[vault];
    await this.state.update(HISTORY_KEY, map);
    return next.slice(0, MAX_SHOWN);
  }

  async clear(vault: string): Promise<string[]> {
    const map = readMap(this.state);
    if (!vault || !map[vault]) return [];
    delete map[vault];
    await this.state.update(HISTORY_KEY, map);
    return [];
  }
}