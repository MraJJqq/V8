import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "fake-indexeddb/auto";

const source = await readFile(new URL("../kline/gate-kline-controller.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { aggregate2H, createGateKlineController, expectedLatestCandleTimestamp, findCandleGaps, GATE_REQUEST_TIMEOUT_MS, hasLatestCoverage, historyRetryDelay } = await import(moduleUrl);
const hour = 3600;
const candle = (t, close = 100) => ({ t, o: close, h: close + 2, l: close - 2, c: close + 1 });
const utc = value => Math.floor(Date.parse(value) / 1000);
globalThis.window = { indexedDB: globalThis.indexedDB };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => ({ usage: 1, quota: 100 }) } } });

function response(rows) { return { ok: true, status: 200, json: async () => rows }; }
function waitForState(expected, timeoutMs = 6000) {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  const timer = setTimeout(() => reject(new Error("Timed out waiting for controller state: " + expected)), timeoutMs);
  const controller = createGateKlineController({ instruments: [], isHidden: () => false, onState: state => {
    if (state.status === expected) { clearTimeout(timer); resolve(state); }
  }});
  return { controller, promise };
}
function wait(promise, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Controller integration test timed out")), timeoutMs);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

async function openTestDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vegas-v6-market-cache", 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("candles")) db.createObjectStore("candles", { keyPath: "id" });
      if (!db.objectStoreNames.contains("candleRows")) {
        const rows = db.createObjectStore("candleRows", { keyPath: "id" });
        rows.createIndex("series", "series", { unique: false });
      }
      if (!db.objectStoreNames.contains("seriesMeta")) db.createObjectStore("seriesMeta", { keyPath: "id" });
      if (!db.objectStoreNames.contains("emaRows")) {
        const ema = db.createObjectStore("emaRows", { keyPath: "id" });
        ema.createIndex("series", "series", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStore(storeName, key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vegas-v6-market-cache", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction([storeName], "readonly");
      const get = tx.objectStore(storeName).get(key);
      get.onsuccess = () => { const result = get.result || null; db.close(); resolve(result); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  });
}

test("detects isolated and consecutive historical gaps", () => {
  const rows = [candle(0), candle(2 * hour), candle(6 * hour)];
  assert.deepEqual(findCandleGaps(rows, "1H"), [
    { from: hour, to: hour, missingCount: 1, misaligned: false },
    { from: 3 * hour, to: 5 * hour, missingCount: 3, misaligned: false }
  ]);
});

test("rejects off-grid and non-integral candle timestamps", () => {
  const rows = [candle(0), candle(hour + 60)];
  assert.equal(findCandleGaps(rows, "1H")[0].misaligned, true);
  assert.equal(hasLatestCoverage(rows, "1H", 2 * hour + 5 * 60 * 1000), false);
});

test("computes the exact latest required timestamp for all five timeframes", () => {
  const now = Date.parse("2026-11-21T14:05:00Z");
  for (const [tf, step] of [["1H", 3600], ["2H", 7200], ["4H", 14400], ["8H", 28800], ["D", 86400]]) {
    const expected = Math.floor(Math.floor(now / 1000) / step) * step - step;
    assert.equal(expectedLatestCandleTimestamp(tf, now), expected, tf);
  }
});

test("checks latest closed-candle coverage across all five timeframes", () => {
  const now = Date.parse("2026-11-21T14:05:00Z");
  for (const [tf, step] of [["1H", 3600], ["2H", 7200], ["4H", 14400], ["8H", 28800], ["D", 86400]]) {
    const currentBucket = Math.floor(Math.floor(now / 1000) / step) * step;
    const expected = currentBucket - step;
    assert.equal(hasLatestCoverage([candle(expected)], tf, now), true, tf + " complete latest candle");
    assert.equal(hasLatestCoverage([candle(expected - step)], tf, now), false, tf + " missing latest candle");
  }
});

test("allows Gate publication grace immediately after a timeframe boundary", () => {
  const now = Date.parse("2026-11-21T14:00:30Z");
  assert.equal(hasLatestCoverage([candle(utc("2026-11-21T12:00:00Z"))], "1H", now), true);
  assert.equal(hasLatestCoverage([candle(utc("2026-11-21T12:00:00Z"))], "1H", Date.parse("2026-11-21T14:03:00Z")), false);
});

test("2H aggregation rejects a missing first or second historical 1H candle", () => {
  const now = Date.parse("2026-11-21T16:30:00Z");
  const firstMissing = aggregate2H([candle(utc("2026-11-21T15:00:00Z"))], now);
  const secondMissing = aggregate2H([candle(utc("2026-11-21T14:00:00Z"))], now);
  assert.equal(firstMissing.some(row => row.t === utc("2026-11-21T14:00:00Z")), false);
  assert.equal(secondMissing.some(row => row.t === utc("2026-11-21T14:00:00Z")), false);
});

test("2H aggregation preserves OHLC and partial active bucket across UTC boundary", () => {
  const now = Date.parse("2026-11-22T00:30:00Z");
  const rows = aggregate2H([
    candle(utc("2026-11-21T22:00:00Z"), 100),
    candle(utc("2026-11-21T23:00:00Z"), 110),
    candle(utc("2026-11-22T00:00:00Z"), 120)
  ], now);
  assert.deepEqual(rows.find(row => row.t === utc("2026-11-21T22:00:00Z")), { t: utc("2026-11-21T22:00:00Z"), o: 100, h: 112, l: 98, c: 111 });
  assert.deepEqual(rows.find(row => row.t === utc("2026-11-22T00:00:00Z")), { t: utc("2026-11-22T00:00:00Z"), o: 120, h: 122, l: 118, c: 121 });
});

test("retry backoff grows exponentially and caps at five minutes", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(historyRetryDelay), [30000, 60000, 120000, 240000, 300000, 300000, 300000]);
});

test("controller repairs a real latest-end gap and persists verified candles", async () => {
  const contract = "SIM_REPAIR_USDT", key = "gate-usdt:" + contract + ":1H";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const missing = candle(current - hour), latestRows = [candle(current - 3 * hour), candle(current - 2 * hour)];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.searchParams.has("from")) return response([missing]);
    return response(latestRows);
  };
  const waiting = waitForState("latest-gap-repaired");
  try {
    await waiting.controller.select("SIM_REPAIR", contract, "1H");
    await wait(waiting.promise);
    const meta = await readStore("seriesMeta", key);
    assert.equal(meta.latestGapStatus, "clear");
    assert.equal(meta.candleCount, 3);
  } finally {
    waiting.controller.destroy();
    globalThis.fetch = oldFetch;
  }
});

test("controller retries transient Gate 429 and 5xx responses before accepting fresh candles", async () => {
  const contract = "SIM_RETRY_USDT";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const rows = [candle(current - 2 * hour), candle(current - hour), candle(current)];
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, json: async () => [] };
    if (calls === 2) return { ok: false, status: 503, json: async () => [] };
    return response(rows);
  };
  let resolveRepaired;
  const repairedPromise = new Promise(resolve => { resolveRepaired = resolve; });
  const controller = createGateKlineController({ instruments: [], isHidden: () => false, onState: state => {
    if (state.status === "latest-gap-repaired") resolveRepaired(state);
  }});
  try {
    await controller.select("SIM_RETRY", contract, "1H");
    await wait(repairedPromise, 20000);
    assert.equal(calls, 3);
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
  }
});

test("failed latest-gap repair persists and restores its task after controller recreation", async () => {
  const contract = "SIM_RESTART_USDT", key = "gate-usdt:" + contract + ":1H";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const incomplete = [candle(current - 2 * hour), candle(current)];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.searchParams.has("from")) return response([]);
    return response(incomplete);
  };
  const first = waitForState("history-gap-pending");
  try {
    await first.controller.select("SIM_RESTART", contract, "1H");
    await wait(first.promise);
    const task = await readStore("seriesMeta", "repairTask|" + key);
    assert.equal(task.kind, "latest");
    assert.equal(task.status, "pending");
    assert.ok(task.nextRetryAt > Date.now());
  } finally {
    first.controller.destroy();
  }
  let resolveRestored, resolveRepaired;
  const restoredPromise = new Promise(resolve => { resolveRestored = resolve; });
  const repairedPromise = new Promise(resolve => { resolveRepaired = resolve; });
  const complete = [candle(current - 2 * hour), candle(current - hour), candle(current)];
  globalThis.fetch = async () => response(complete);
  const second = createGateKlineController({ instruments: [], isHidden: () => false, onState: state => {
    if (state.status === "repair-tasks-restored") resolveRestored(state);
    if (state.status === "latest-gap-repaired") resolveRepaired(state);
  }});
  try {
    await second.select("SIM_RESTART", contract, "1H");
    const [restored] = await wait(Promise.all([restoredPromise, repairedPromise]));
    assert.equal(restored.count, 1);
    assert.ok(restored.keys.includes(key));
    assert.equal(await readStore("seriesMeta", "repairTask|" + key), null);
  } finally {
    second.destroy();
    globalThis.fetch = oldFetch;
  }
});


test("bounds each Gate request with an abortable timeout and retries a timed-out request", async () => {
  assert.equal(GATE_REQUEST_TIMEOUT_MS, 15000);
  const contract = "SIM_TIMEOUT_USDT";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const rows = [candle(current - 2 * hour), candle(current - hour), candle(current)];
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, options) => {
    calls++;
    if (calls === 1) return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("simulated request timeout")), { once: true });
    });
    return response(rows);
  };
  let resolveRepaired;
  const repaired = new Promise(resolve => { resolveRepaired = resolve; });
  const controller = createGateKlineController({
    instruments: [], isHidden: () => false, requestTimeoutMs: 10,
    onState: state => { if (state.status === "latest-gap-repaired") resolveRepaired(state); }
  });
  try {
    await controller.select("SIM_TIMEOUT", contract, "1H");
    await wait(repaired, 8000);
    assert.equal(calls, 2);
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
  }
});

test("coalesces a manual refresh while the same series request is still in flight", async () => {
  const contract = "SIM_COALESCE_USDT";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const rows = [candle(current - 2 * hour), candle(current - hour), candle(current)];
  const oldFetch = globalThis.fetch;
  let calls = 0, release;
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      resolveStarted();
      return new Promise(resolve => { release = () => resolve(response(rows)); });
    }
    return response(rows);
  };
  const controller = createGateKlineController({ instruments: [], isHidden: () => false });
  try {
    await controller.select("SIM_COALESCE", contract, "1H");
    await wait(started);
    const refresh = controller.refresh();
    assert.equal(calls, 1, "refresh must reuse the active request");
    release();
    await wait(refresh);
    assert.equal(calls, 1);
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
  }
});

test("resumes the latest-data request after a page-hidden abort", async () => {
  const contract = "SIM_RESUME_USDT";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const rows = [candle(current - 2 * hour), candle(current - hour), candle(current)];
  const oldFetch = globalThis.fetch;
  let hidden = false, calls = 0, resolveStarted, resolveAborted, resolveRepaired;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const aborted = new Promise(resolve => { resolveAborted = resolve; });
  const repaired = new Promise(resolve => { resolveRepaired = resolve; });
  globalThis.fetch = async (_input, options) => {
    calls++;
    if (calls === 1) return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => { resolveAborted(); reject(new Error("page hidden")); }, { once: true });
      resolveStarted();
    });
    return response(rows);
  };
  const controller = createGateKlineController({
    instruments: [], isHidden: () => hidden,
    onState: state => { if (state.status === "latest-gap-repaired") resolveRepaired(state); }
  });
  try {
    await controller.select("SIM_RESUME", contract, "1H");
    await wait(started);
    hidden = true;
    controller.suspend();
    await wait(aborted);
    hidden = false;
    controller.resume();
    await wait(repaired, 10000);
    assert.ok(calls >= 2);
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
  }
});

test("migrates legacy candle arrays into per-candle IndexedDB rows without data loss", async () => {
  const contract = "SIM_MIGRATE_USDT", key = "gate-usdt:" + contract + ":1H";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const existing = candle(current - 3 * hour);
  const legacyRows = [candle(current - 2 * hour), candle(current - hour)];
  const db = await openTestDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["candles", "candleRows"], "readwrite");
    tx.objectStore("candles").put({ id: key, candles: legacyRows, historyBoundaryReached: false, latestGapStatus: "pending" });
    tx.objectStore("candleRows").put({ id: key + "|" + existing.t, series: key, ...existing });
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  db.close();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => response([]);
  const controller = createGateKlineController({ instruments: [], isHidden: () => false });
  try {
    const selected = await controller.select("SIM_MIGRATE", contract, "1H");
    assert.equal(selected, true);
    assert.equal(controller.state.count, 3);
    assert.equal(await readStore("candles", key), null);
    for (const row of [existing, ...legacyRows]) {
      assert.ok(await readStore("candleRows", key + "|" + row.t), "migrated candle " + row.t);
    }
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
  }
});

test("keeps K-line updates available when IndexedDB read/write transactions fail", async () => {
  const db = await openTestDB();
  const prototype = Object.getPrototypeOf(db);
  const originalTransaction = prototype.transaction;
  prototype.transaction = function(storeNames, mode, ...options) {
    if (mode === "readwrite") throw new Error("simulated IndexedDB transaction failure");
    return originalTransaction.call(this, storeNames, mode, ...options);
  };
  db.close();
  const contract = "SIM_IDB_WRITE_FALLBACK_USDT";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const rows = [candle(current - 2 * hour), candle(current - hour), candle(current)];
  const oldFetch = globalThis.fetch;
  let cacheReadFailed = false, cacheWriteFailed = false, resolveRepaired;
  const repaired = new Promise(resolve => { resolveRepaired = resolve; });
  globalThis.fetch = async () => response(rows);
  const controller = createGateKlineController({
    instruments: [], isHidden: () => false,
    onState: state => {
      if (state.status === "cache-read-failed") cacheReadFailed = true;
      if (state.status === "cache-write-failed" && state.mode === "memory-fallback") cacheWriteFailed = true;
      if (state.status === "latest-gap-repaired") resolveRepaired(state);
    }
  });
  try {
    await controller.select("SIM_IDB_WRITE_FALLBACK", contract, "1H");
    await wait(repaired);
    assert.equal(cacheReadFailed, true);
    assert.equal(cacheWriteFailed, true);
    assert.equal(controller.state.count, 3);
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
    prototype.transaction = originalTransaction;
  }
});

test("repairs the EMA cache after a full load and incrementally advances it by one candle", async () => {
  const contract = "SIM_EMA_RECOVERY_USDT", key = "gate-usdt:" + contract + ":1H";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const initial = Array.from({ length: 700 }, (_, index) => candle(current - (700 - index) * hour));
  let rows = initial;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => response(rows);
  let resolveRepaired;
  const repaired = new Promise(resolve => { resolveRepaired = resolve; });
  const controller = createGateKlineController({
    instruments: [], isHidden: () => false,
    onState: state => { if (state.status === "latest-gap-repaired") resolveRepaired(state); }
  });
  try {
    await controller.select("SIM_EMA_RECOVERY", contract, "1H");
    await wait(repaired);
    const firstMeta = await readStore("seriesMeta", "ema|" + key);
    assert.equal(firstMeta.candleCount, 700);
    const db = await openTestDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["seriesMeta"], "readwrite");
      tx.objectStore("seriesMeta").put({ ...firstMeta, sourceSignature: "interrupted-ema-write" });
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close();
    await wait(controller.refresh());
    const rebuiltMeta = await readStore("seriesMeta", "ema|" + key);
    assert.notEqual(rebuiltMeta.sourceSignature, "interrupted-ema-write");
    rows = [...initial, candle(current)];
    await wait(controller.refresh());
    const updatedMeta = await readStore("seriesMeta", "ema|" + key);
    assert.equal(updatedMeta.candleCount, 701);
    assert.equal(updatedMeta.newestTimestamp, current);
    const latestEma = await readStore("emaRows", key + "|" + current);
    assert.ok(Number.isFinite(latestEma.e12));
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
  }
});

test("keeps multiple selected symbols in separate K-line cache series", async () => {
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const contract = new URL(String(input)).searchParams.get("contract");
    const close = contract === "SIM_SYMBOL_A_USDT" ? 110 : 220;
    return response([candle(current - 2 * hour, close), candle(current - hour, close), candle(current, close)]);
  };
  let resolveA, resolveB;
  const repairedA = new Promise(resolve => { resolveA = resolve; });
  const repairedB = new Promise(resolve => { resolveB = resolve; });
  const controller = createGateKlineController({
    instruments: [], isHidden: () => false,
    onState: state => {
      if (state.status !== "latest-gap-repaired") return;
      if (state.symbol === "SIM_SYMBOL_A") resolveA(state);
      if (state.symbol === "SIM_SYMBOL_B") resolveB(state);
    }
  });
  try {
    await controller.select("SIM_SYMBOL_A", "SIM_SYMBOL_A_USDT", "1H");
    await wait(repairedA);
    await controller.select("SIM_SYMBOL_B", "SIM_SYMBOL_B_USDT", "1H");
    await wait(repairedB);
    const a = await readStore("candleRows", "gate-usdt:SIM_SYMBOL_A_USDT:1H|" + current);
    const b = await readStore("candleRows", "gate-usdt:SIM_SYMBOL_B_USDT:1H|" + current);
    assert.equal(a.c, 111);
    assert.equal(b.c, 221);
    assert.notEqual(a.c, b.c);
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
  }
});

test("validates continuity across a large 20,000-candle historical series", () => {
  const now = Date.parse("2026-11-21T14:05:00Z");
  const expected = expectedLatestCandleTimestamp("1H", now);
  const rows = Array.from({ length: 20000 }, (_, index) => candle(expected - (19999 - index) * hour));
  assert.equal(findCandleGaps(rows, "1H").length, 0);
  assert.equal(hasLatestCoverage(rows, "1H", now), true);
});

test("enforces the per-series memory-cache cap without marking truncated history complete", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(indexedDB, "open");
  Object.defineProperty(indexedDB, "open", { configurable: true, writable: true, value: () => { throw new Error("simulated IndexedDB unavailable"); } });
  const contract = "SIM_MEMORY_LIMIT_USDT";
  const current = Math.floor(Date.now() / 3600000) * 3600;
  const rows = Array.from({ length: 12005 }, (_, index) => candle(current - (12004 - index) * hour));
  const oldFetch = globalThis.fetch;
  let limitEvent = false, resolveRepaired;
  const repaired = new Promise(resolve => { resolveRepaired = resolve; });
  globalThis.fetch = async () => response(rows);
  const controller = createGateKlineController({
    instruments: [], isHidden: () => false,
    onState: state => {
      if (state.status === "cache-memory-limit") limitEvent = true;
      if (state.status === "latest-gap-repaired") resolveRepaired(state);
    }
  });
  try {
    await controller.select("SIM_MEMORY_LIMIT", contract, "1H");
    await wait(repaired, 15000);
    assert.equal(limitEvent, true);
    assert.equal(controller.state.count, 12000);
    assert.equal(controller.state.historyComplete, false);
  } finally {
    controller.destroy();
    globalThis.fetch = oldFetch;
    if (descriptor) Object.defineProperty(indexedDB, "open", descriptor);
    else delete indexedDB.open;
  }
});
