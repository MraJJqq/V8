import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("../modules/shared/instrument-catalog.js");
const { INSTRUMENTS, GATE_CONTRACTS } = await import("../modules/shared/universe-v6.js");
const { V12_SCAN_SYMBOLS, validateV12Payload, beijingSignalDay } = await import("../modules/signal-ticker/v12-feed.js");
const root = new URL("../", import.meta.url);
const source = path => readFile(new URL(path, root), "utf8");

test("catalog and independent V12 whitelist contain the same 22 unique feed symbols", () => {
  const catalogSymbols = INSTRUMENTS.map(item => item.signalSymbol);
  assert.equal(INSTRUMENTS.length, 22);
  assert.equal(new Set(INSTRUMENTS.map(item => item.symbol)).size, 22);
  assert.equal(new Set(catalogSymbols).size, 22);
  assert.deepEqual([...catalogSymbols].sort(), [...V12_SCAN_SYMBOLS].sort());
  assert.equal(INSTRUMENTS.find(item => item.symbol === "SKHYNIX").signalSymbol, "SKHY");
});

test("instrument categories are explicit and preserve the existing 18/4 grouping", () => {
  assert.equal(INSTRUMENTS.filter(item => item.category === "美股巨头").length, 18);
  assert.equal(INSTRUMENTS.filter(item => item.category === "核心能源").length, 4);
  assert.ok(INSTRUMENTS.every(item => item.category === "美股巨头" || item.category === "核心能源"));
  for (const item of INSTRUMENTS) {
    assert.equal(GATE_CONTRACTS[item.symbol], item.contract.replace(/USDT$/, "_USDT"));
  }
});

test("V12 feed accepts the complete pool and rejects missing or duplicate symbols", () => {
  const payload = {
    source: "VEGAS V12", schema_version: 1, signal_day: beijingSignalDay(),
    scan_status: "complete", symbols_ok: 22, symbols_total: 22,
    symbols: [...V12_SCAN_SYMBOLS], signals: []
  };
  assert.equal(validateV12Payload(payload), payload);
  assert.throws(() => validateV12Payload({ ...payload, symbols: payload.symbols.slice(1) }), /complete V12 instrument universe|all 22/);
  assert.throws(() => validateV12Payload({ ...payload, symbols: [...payload.symbols.slice(1), payload.symbols[1]] }), /complete V12 instrument universe/);
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

test("logo and ticker consume catalog-owned identity and categories", async () => {
  const logo = await source("modules/logo/logo.js");
  const ticker = await source("modules/signal-ticker/ticker.js");
  assert.match(logo, /CATALOG\.map\(item=>\[item\.symbol/);
  assert.match(logo, /ROOT\+entry\[1\]/);
  assert.match(ticker, /item\.category === "美股巨头"/);
  assert.match(ticker, /item\.category === "核心能源"/);
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
