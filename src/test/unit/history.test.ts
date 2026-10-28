import * as assert from "node:assert/strict";
import {
  HISTORY_KEY,
  MAX_SHOWN,
  MAX_STORED,
  SearchHistoryStore,
  type HistoryMemento,
} from "../../history";

function memoryMemento(
  initial: Record<string, unknown> = {},
  failWrites = false
): HistoryMemento & { snapshot(): Record<string, unknown>; writes(): number } {
  let data = structuredClone(initial);
  let writes = 0;
  return {
    get<T>(key: string, defaultValue: T): T {
      return (key in data ? data[key] : defaultValue) as T;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (failWrites) throw new Error("storage unavailable");
      writes += 1;
      data[key] = structuredClone(value);
    },
    snapshot() {
      return data;
    },
    writes() {
      return writes;
    },
  };
}

function stored(state: HistoryMemento & { snapshot(): Record<string, unknown> }): Record<string, string[]> {
  return state.snapshot()[HISTORY_KEY] as Record<string, string[]>;
}

describe("search history store", () => {
  it("keeps histories separate per vault, newest first", async () => {
    const state = memoryMemento();
    const history = new SearchHistoryStore(state);
    await history.record("alpha", "first");
    await history.record("alpha", "second");
    await history.record("beta", "other");

    assert.deepEqual(history.items("alpha"), ["second", "first"]);
    assert.deepEqual(history.items("beta"), ["other"]);
    assert.deepEqual(history.items("missing"), []);
  });

  it("trims and dedupes case-insensitively, keeping the newest spelling", async () => {
    const state = memoryMemento();
    const history = new SearchHistoryStore(state);
    await history.record("v", "  Alpha  ");
    await history.record("v", "beta");
    await history.record("v", "ALPHA");

    assert.deepEqual(history.items("v"), ["ALPHA", "beta"]);
    assert.deepEqual(stored(state).v, ["ALPHA", "beta"]);
  });

  it("ignores blank queries and empty vaults without writing", async () => {
    const state = memoryMemento();
    const history = new SearchHistoryStore(state);
    assert.deepEqual(await history.record("v", "   "), []);
    assert.deepEqual(await history.record("", "query"), []);
    assert.equal(state.writes(), 0);
  });

  it("stores at most 20 entries but shows at most 8", async () => {
    const state = memoryMemento();
    const history = new SearchHistoryStore(state);
    for (let i = 1; i <= 25; i += 1) await history.record("v", `q${i}`);

    const items = history.items("v");
    assert.equal(items.length, MAX_SHOWN);
    assert.equal(items[0], "q25");
    assert.equal(items.at(-1), "q18");
    assert.equal(stored(state).v.length, MAX_STORED);
    assert.equal(stored(state).v[0], "q25");
    assert.equal(stored(state).v.at(-1), "q6");
  });

  it("removes one query and clears only one vault", async () => {
    const state = memoryMemento();
    const history = new SearchHistoryStore(state);
    await history.record("a", "keep");
    await history.record("a", "drop");
    await history.record("b", "other");

    assert.deepEqual(await history.remove("a", "DROP"), ["keep"]);
    assert.deepEqual(history.items("a"), ["keep"]);
    assert.deepEqual(await history.clear("a"), []);
    assert.deepEqual(history.items("a"), []);
    assert.deepEqual(history.items("b"), ["other"]);
    assert.deepEqual(stored(state), { b: ["other"] });
  });

  it("discards corrupt state instead of throwing", () => {
    const rootArray = memoryMemento({ [HISTORY_KEY]: ["nope"] });
    assert.deepEqual(new SearchHistoryStore(rootArray).items("v"), []);

    const messy = memoryMemento({
      [HISTORY_KEY]: {
        mixed: [" B ", "b", 7, "", "A"],
        scalar: "not a list",
        empty: [],
      },
    });
    const history = new SearchHistoryStore(messy);
    assert.deepEqual(history.items("mixed"), ["B", "A"]);
    assert.deepEqual(history.items("scalar"), []);
    assert.deepEqual(history.items("empty"), []);
  });

  it("propagates storage failures so the caller can log them", async () => {
    const state = memoryMemento({}, true);
    const history = new SearchHistoryStore(state);
    await assert.rejects(history.record("v", "query"), /storage unavailable/);
    assert.deepEqual(history.items("v"), []);
  });
});