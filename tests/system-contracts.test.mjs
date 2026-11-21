import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../modules/shared/instrument-catalog.js");
const { INSTRUMENTS, GATE_CONTRACTS } = await import("../modules/shared/universe-v6.js");
const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("catalog contains 22 unique instruments", () => {
  assert.equal(INSTRUMENTS.length, 22);
  assert.equal(new Set(INSTRUMENTS.map(item => item.symbol)).size, 22);
});
test("instrument categories are explicit and preserve the existing 18/4 grouping", () => {
  assert.equal(INSTRUMENTS.filter(item => item.category === "美股巨头").length, 18);
  assert.equal(INSTRUMENTS.filter(item => item.category === "核心能源").length, 4);
  assert.ok(INSTRUMENTS.every(item => item.category === "美股巨头" || item.category === "核心能源"));
  for (const item of INSTRUMENTS) {
    assert.equal(GATE_CONTRACTS[item.symbol], item.contract.replace(/USDT$/, "_USDT"));
  }
});

test("cards expose only batch quote updates and direct card ordering", async () => {
  const cards = await source("cards/rolling-cards.js");
  assert.match(cards, /window\.updateQuotes=function/);
  assert.match(cards, /window\.setCardOrder=function/);
  assert.doesNotMatch(cards, /window\.updateQuote\s*=/);
  assert.doesNotMatch(cards, /VEGAS_SET_CARD_ORDER/);
  assert.match(cards, /VEGAS_CARD_INTERACTION/);
  assert.match(cards, /VEGAS_CARD_SELECT/);
});

test("logo consumes catalog-owned identity", async () => {
  const logo = await source("modules/logo/logo.js");
  assert.match(logo, /CATALOG\.map\(item=>\[item\.symbol/);
  assert.match(logo, /ROOT\+entry\[1\]/);
});

test("five timeframe controls and the full-screen stylesheet own the outer iframe geometry", async () => {
  const html = await source("modules/timeframe-switch/index.html");
  const host = await source("modules/timeframe-switch/host.css");
  const full = await source("assets/css/full-screen-dynamic.css");
  const buttons = [...html.matchAll(/<button aria-pressed="(?:true|false)">([^<]+)<\/button>/g)].map(match => match[1]);
  assert.deepEqual(buttons, ["1H", "2H", "4H", "8H", "D"]);
  assert.match(html, /height:\s*20%/);
  assert.match(html, /flex:\s*0\s+0\s+20%/);
  assert.doesNotMatch(host, /#app\s+#timeframe-frame\s*\{[^}]*\bheight\s*:/);
  assert.match(full, /#timeframe-frame\{[^}]*height:calc\(100vh/);
  assert.match(full, /#timeframe-frame\{height:calc\(100dvh/);
});

test("lifecycle scope disposes owned resources once, including child scopes", async () => {
  const { createLifecycleScope } = await import("../modules/shared/lifecycle.js");
  const parent = createLifecycleScope();
  let disposed = 0;
  const release = parent.own(() => disposed++);
  const child = parent.child();
  child.own(() => disposed++);
  release(); parent.destroy(); parent.destroy();
  assert.equal(disposed, 2);
  assert.equal(parent.disposed, true);
  assert.equal(child.disposed, true);
});

test("page lifecycle suspends and resumes once across visibility and BFCache events", async () => {
  const { createPageLifecycle } = await import("../modules/shared/page-lifecycle-v6.js");
  const documentRef = new EventTarget(), windowRef = new EventTarget();
  documentRef.hidden = false;
  let suspended = 0, resumed = 0;
  const lifecycle = createPageLifecycle({
    documentRef, windowRef,
    onSuspend: () => suspended++, onResume: () => resumed++
  });
  documentRef.hidden = true;
  documentRef.dispatchEvent(new Event("visibilitychange"));
  documentRef.dispatchEvent(new Event("visibilitychange"));
  documentRef.hidden = false;
  documentRef.dispatchEvent(new Event("visibilitychange"));
  const hide = new Event("pagehide");
  Object.defineProperty(hide, "persisted", { value: true });
  windowRef.dispatchEvent(hide);
  windowRef.dispatchEvent(new Event("pageshow"));
  assert.equal(suspended, 2);
  assert.equal(resumed, 2);
  lifecycle.destroy();
  assert.equal(lifecycle.isSuspended(), true);
});


test("operating-flow documentation matches the current catalog and card interfaces", async () => {
  const docs = await source("OPERATING-FLOWS.md").catch(() => source("docs/SEVEN-SYSTEMS.md"));
  assert.match(docs, /modules\/shared\/instrument-catalog\.js/);
  assert.match(docs, /modules\/shared\/universe-v6\.js/);
  assert.doesNotMatch(docs, /gate-universe\.js/);
  assert.match(docs, /window\.updateQuotes/);
  assert.match(docs, /window\.setCardOrder/);
  assert.doesNotMatch(docs, /updateQuote\s*\/\s*updateQuotes/);
});

test("responsive layout contracts retain dynamic viewport and safe-area handling", async () => {
  const full = await source("assets/css/full-screen-dynamic.css");
  const cards = await source("cards/rolling-cards.css");
  assert.match(full, /100dvh/);
  assert.match(full, /safe-area-inset/);
  assert.match(full, /orientation|landscape|portrait/i);
  assert.match(cards, /ResizeObserver|touch-action|pointer-events|overflow/i);
});


test("all 22 catalog logos resolve to real local SVG assets", async () => {
  for (const item of INSTRUMENTS) {
    assert.ok(item.logo && item.logoGroup, `missing logo mapping for ${item.symbol}`);
    const svg = await source(`assets/logos/${item.logoGroup}/${item.logo}.svg`);
    assert.match(svg, /<svg[\s>]/i);
  }
});

test("host, cards, timeframe and Logo retain their message integration contracts", async () => {
  const runtime = await source("modules/v6-runtime.js");
  const cards = await source("cards/rolling-cards.js");
  const timeframe = await source("modules/timeframe-switch/index.html");
  const logo = await source("modules/logo/logo.js");
  assert.match(runtime, /event\.origin!==location\.origin/);
  assert.match(runtime, /event\.source===timeframeFrame\?\.contentWindow/);
  assert.match(runtime, /VEGAS_CARD_INTERACTION/);
  assert.match(runtime, /VEGAS_CARD_SELECT/);
  assert.match(runtime, /VEGAS_LOGO_SET_SYMBOL/);
  assert.match(runtime, /VEGAS_TIMEFRAME_SET/);
  assert.match(cards, /VEGAS_CARD_INTERACTION/);
  assert.match(cards, /VEGAS_CARD_SELECT/);
  assert.match(timeframe, /VEGAS_TIMEFRAME_SELECT/);
  assert.match(logo, /VEGAS_LOGO_SET_SYMBOL/);
  assert.match(logo, /VEGAS_LOGO_SET_TIMEFRAME/);
});

test("Gate quotes retain bounded foreground refresh and failure handling", async () => {
  const runtime = await source("modules/v6-runtime.js");
  assert.match(runtime, /300000/);
  assert.match(runtime, /api\.gateio\.ws\/api\/v4\/futures\/usdt\/tickers/);
  assert.match(runtime, /attempt<3/);
  assert.match(runtime, /new AbortController\(\)/);
});
