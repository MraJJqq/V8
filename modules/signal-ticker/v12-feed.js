import { V6_CONFIG } from "../shared/config.js";
import { INSTRUMENTS as V6_INSTRUMENTS } from "../shared/universe-v6.js";

const DEFAULT_URL = "https://raw.githubusercontent.com/MraJJqq/v12/main/v12/public-signals.json";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_MS = 30_000;

export function beijingSignalDay(nowMs = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(nowMs));
}

export function validateV12Payload(payload, nowMs = Date.now()) {
  if (payload?.source !== "VEGAS V12" || payload?.schema_version !== 1 ||
      !Array.isArray(payload.signals) || !Array.isArray(payload.symbols)) {
    throw new Error("V12 feed schema invalid");
  }
  if (payload.signal_day !== beijingSignalDay(nowMs)) {
    throw new Error("V12 feed is not current Beijing day");
  }

  const expected = V6_CONFIG.app.instrumentCount;
  if ((payload.scan_status !== "complete" && payload.scan_status !== "complete_with_warmup_warning") ||
      payload.symbols_ok !== expected || payload.symbols_total !== expected) {
    throw new Error("V12 full-pool scan is not complete");
  }

  // Require the exact V12/V4 contract universe, not merely a matching 27/27 counter.
  // Contract suffixes provide the canonical feed names (SKHY, not SKHYNIX).
  const expectedSymbols = new Set(
    V6_INSTRUMENTS.map(item => item.contract.replace(/USDT$/, ""))
  );
  const seenSymbols = new Set();
  for (const symbol of payload.symbols) {
    if (typeof symbol !== "string" || !expectedSymbols.has(symbol) || seenSymbols.has(symbol)) {
      throw new Error("V12 symbols does not match the complete V4 instrument universe");
    }
    seenSymbols.add(symbol);
  }
  if (seenSymbols.size !== expected || [...expectedSymbols].some(symbol => !seenSymbols.has(symbol))) {
    throw new Error("V12 symbols does not contain all 27 V4 instruments");
  }
  return payload;
}

export function createV12Feed({
  url = DEFAULT_URL,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cacheMs = DEFAULT_CACHE_MS,
  isHidden = () => typeof document !== "undefined" && document.hidden
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  let lastPayload = null;
  let lastChecked = 0;
  let inFlight = null;
  let activeController = null;
  let suspended = false;
  let destroyed = false;

  async function read({ force = false } = {}) {
    if (destroyed) throw new Error("V12 feed destroyed");
    if (suspended || isHidden()) {
      const error = new Error("V12 feed paused while page is hidden");
      error.pageHidden = true;
      throw error;
    }
    if (inFlight && !activeController?.signal.aborted) return inFlight;
    if (activeController?.signal.aborted) inFlight = null;
    if (!force && lastPayload && now() - lastChecked < cacheMs) return lastPayload;

    const request = (async () => {
      const controller = new AbortController();
      activeController = controller;
      const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
      try {
        const response = await fetchImpl(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("V12 feed HTTP " + response.status);
        const payload = validateV12Payload(await response.json(), now());
        if (destroyed || suspended) {
          const error = new Error("V12 feed interrupted");
          error.pageHidden = suspended;
          throw error;
        }
        lastPayload = payload;
        lastChecked = now();
        return payload;
      } catch (caught) {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        if (controller.signal.reason === "page-hidden" || suspended || isHidden()) error.pageHidden = true;
        throw error;
      } finally {
        clearTimeout(timer);
        if (activeController === controller) activeController = null;
      }
    })();

    inFlight = request;
    try { return await request; }
    finally { if (inFlight === request) inFlight = null; }
  }

  function suspend() {
    if (destroyed) return;
    suspended = true;
    activeController?.abort("page-hidden");
  }

  function resume() {
    if (!destroyed) suspended = false;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    activeController?.abort("feed-destroyed");
    lastPayload = null;
    inFlight = null;
  }

  return Object.freeze({ read, suspend, resume, destroy });
}
