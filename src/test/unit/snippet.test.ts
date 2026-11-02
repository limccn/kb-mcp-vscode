import * as assert from "node:assert/strict";
import { buildSnippetView } from "../../snippet";

const plainText = (segments: { text: string }[]): string =>
  segments.map((segment) => segment.text).join("");
const matchTexts = (segments: { text: string; match: boolean }[]): string[] =>
  segments.filter((segment) => segment.match).map((segment) => segment.text);

describe("buildSnippetView", () => {
  it("keeps the original spelling in match segments", () => {
    const view = buildSnippetView("alpha", "The ALPHA beta gamma.", "");
    assert.deepEqual(view.collapsed, [
      { text: "The ", match: false },
      { text: "ALPHA", match: true },
      { text: " beta gamma.", match: false },
    ]);
    assert.equal(view.plain, "The ALPHA beta gamma.");
    assert.equal(view.expandable, false);
  });

  it("shows context on both sides of the match and expands further", () => {
    const body = "start " + "word ".repeat(100) + "needle " + "tail ".repeat(100);
    const view = buildSnippetView("needle", body, "");

    assert.ok(view.plain.startsWith("…"));
    assert.ok(view.plain.endsWith("…"));
    assert.ok(view.plain.includes("word"));
    assert.ok(view.plain.includes("needle"));
    assert.deepEqual(matchTexts(view.collapsed), ["needle"]);
    assert.equal(view.expandable, true);
    assert.ok(plainText(view.expanded).length > view.plain.length);
  });

  it("snaps window edges to word boundaries", () => {
    const tokens = Array.from({ length: 300 }, (_, i) => `p${i}`);
    const body = tokens.slice(0, 150).join(" ") + " needle " + tokens.slice(150).join(" ");
    const view = buildSnippetView("needle", body, "");

    const firstToken = view.plain.replace(/^…/, "").split(" ")[0];
    assert.ok(tokens.includes(firstToken), `cut mid-word: ${firstToken}`);
  });

  it("does not mark anything when the body has no match", () => {
    const view = buildSnippetView("zzz", "plain body text", "");
    assert.deepEqual(view.collapsed, [{ text: "plain body text", match: false }]);
    assert.equal(view.expandable, false);
  });

  it("highlights CJK queries without whitespace", () => {
    const body = "前言".repeat(300) + "知识库检索" + "后记".repeat(300);
    const view = buildSnippetView("知识库", body, "");

    assert.deepEqual(matchTexts(view.collapsed), ["知识库"]);
    assert.ok(view.plain.includes("知识库检索"));
    assert.equal(view.expandable, true);
  });

  it("falls back to the marked snippet when the body is empty", () => {
    const view = buildSnippetView("needle", "", "pre <b>needle</b> post");
    assert.equal(view.plain, "pre needle post");
    assert.deepEqual(matchTexts(view.collapsed), ["needle"]);
    assert.ok(!view.plain.includes("<b>"));
    assert.equal(view.expandable, false);
  });

  it("highlights the FTS-marked words in addition to the query", () => {
    const view = buildSnippetView(
      "run",
      "They were running quickly.",
      "They were <b>running</b> quickly."
    );
    assert.deepEqual(matchTexts(view.collapsed), ["running"]);
  });

  it("returns an empty view for an empty hit", () => {
    assert.deepEqual(buildSnippetView("anything", "", ""), {
      collapsed: [],
      expanded: [],
      expandable: false,
      plain: "",
    });
  });
});