#!/usr/bin/env python3
"""Static integrity checks for the standalone VEGAS V8 Pages site."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []

def fail(message):
    errors.append(message)

def local_target(base, raw):
    raw = (raw or "").strip()
    if not raw or raw.startswith("#") or raw.startswith("data:"):
        return None
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    if path.startswith("/"):
        return (ROOT / path.lstrip("/")).resolve()
    return (base / path).resolve()

class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
        self.inline_scripts = []
        self._script = None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "img", "iframe", "source", "link"):
            for key in ("src", "href"):
                if attrs.get(key):
                    self.refs.append((tag, attrs[key]))
        if tag == "script" and not attrs.get("src"):
            self._script = [attrs.get("type", ""), ""]
    def handle_data(self, data):
        if self._script is not None:
            self._script[1] += data
    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            kind, source = self._script
            if source.strip() and "json" not in kind.lower():
                self.inline_scripts.append(source)
            self._script = None

html_files = list(ROOT.rglob("*.html"))
for page in html_files:
    parser = PageParser()
    parser.feed(page.read_text(encoding="utf-8"))
    for tag, ref in parser.refs:
        target = local_target(page.parent, ref)
        if target is not None and not target.is_file():
            fail(f"{page.relative_to(ROOT)}: missing {tag} reference {ref}")
    for index, source in enumerate(parser.inline_scripts, 1):
        result = subprocess.run(
            ["node", "--input-type=module", "--check"],
            input=source, text=True, capture_output=True
        )
        if result.returncode:
            fail(f"{page.relative_to(ROOT)} inline script #{index}: {result.stderr.strip()}")

for css in ROOT.rglob("*.css"):
    source = css.read_text(encoding="utf-8")
    for raw in re.findall(r"url\(\s*['\"]?([^'\")]+)", source, re.I):
        target = local_target(css.parent, raw)
        if target is not None and not target.is_file():
            fail(f"{css.relative_to(ROOT)}: missing CSS resource {raw}")

import_re = re.compile(r"(?:\bfrom\s*|\bimport\s*)['\"]([^'\"]+)['\"]")
for js in ROOT.rglob("*.js"):
    source = js.read_text(encoding="utf-8")
    for ref in import_re.findall(source):
        if not ref.startswith("."):
            continue
        target = local_target(js.parent, ref)
        if target is not None and not target.is_file():
            fail(f"{js.relative_to(ROOT)}: missing module {ref}")

runtime_files = html_files + list(ROOT.rglob("*.js")) + [ROOT / ".github/workflows/pages.yml"]
runtime_text = "\\n".join(path.read_text(encoding="utf-8") for path in runtime_files)
for forbidden in ("MraJJqq/V5", "bitget", "yahoo"):
    if forbidden.lower() in runtime_text.lower():
        fail(f"unexpected runtime dependency reference: {forbidden}")

for old_name in ("universe-v4.js", "page-lifecycle-v4.js",
                 "v5-kline-view.js", "v5-vegas-ema.js", "v5-viewport-state.js"):
    if (ROOT / "modules/shared" / old_name).exists() or (ROOT / "kline" / old_name).exists():
        fail(f"legacy module file remains: {old_name}")

runtime = (ROOT / "modules/v6-runtime.js").read_text(encoding="utf-8")
if "universe-v6.js" not in runtime or "page-lifecycle-v6.js" not in runtime:
    fail("runtime is not wired exclusively to V6 shared modules")
if "createV6KlineView" not in runtime:
    fail("runtime is not wired to the V6 K-line view")

# The global full-screen stylesheet is the sole owner of the timeframe iframe geometry.
timeframe_host = (ROOT / "modules/timeframe-switch/host.css").read_text(encoding="utf-8")
if re.search(r"#app\s+#timeframe-frame\s*\{[^}]*\bheight\s*:", timeframe_host):
    fail("timeframe host stylesheet must not own outer iframe height")
# Guard the global layout contract: Logo outer geometry must live only in the
# global full-screen system, never in a Logo-specific host stylesheet.
full_screen_path = ROOT / "assets/css/full-screen-dynamic.css"
full_screen_source = full_screen_path.read_text(encoding="utf-8")
if not re.search(r"#timeframe-frame\s*\{[^}]*\bheight\s*:", full_screen_source):
    fail("global full-screen stylesheet must own timeframe iframe height")
if not re.search(r"#logo-frame\s*\{[^}]*position\s*:\s*fixed", full_screen_source):
    fail("Logo outer geometry is missing from the global full-screen system")
if (ROOT / "modules/logo/host.css").exists():
    fail("conflicting Logo-specific host layout stylesheet remains")
index_source = (ROOT / "index.html").read_text(encoding="utf-8")
if "modules/logo/host.css" in index_source:
    fail("index.html still loads the Logo-specific host stylesheet")

controller = (ROOT / "kline/gate-kline-controller.js").read_text(encoding="utf-8")
latest_write = controller.find('await write(key,merged,cached.historyBoundaryReached===true,"latest-data-updated")')
latest_ema = controller.find("await updateEmaCache(key,merged)")
gap_repair = controller.find("const repaired=await repairGaps(c,tf,merged)")
if min(latest_write, latest_ema, gap_repair) < 0 or not (latest_write < latest_ema < gap_repair):
    fail("latest candles and EMA must be persisted before independent historical gap repair")
if "latest-verified" not in controller:
    fail("successful gap repair does not mark the series verified")
if "restoreRepairTasks" not in controller or 'getAll()' not in controller or "repair-tasks-restored" not in controller:
    fail("persisted repair tasks are not restored after controller restart")
if "hasLatestCoverage" not in controller or "findCandleGaps" not in controller or "expectedLatestCandleTimestamp" not in controller:
    fail("latest-tail or aligned historical gap verification is missing")
if "Gate latest candle gap could not be filled" not in controller or "latest-tail-repaired" not in controller:
    fail("latest-tail gap is detected but not repaired through the exchange range endpoint")
if "historyRetryDelay" not in controller or "retryDueAt" not in controller:
    fail("persisted retry backoff state is missing")
if "GATE_REQUEST_TIMEOUT_MS" not in controller or "gate-request-timeout" not in controller:
    fail("Gate candle requests are missing bounded timeout and timeout retry handling")
if "mode:\"memory-fallback\"" not in controller or "cache-read-failed" not in controller:
    fail("IndexedDB transaction failures do not fall back to bounded in-memory candles")
if "updateEmaCache" not in controller:
    fail("EMA cache failures can still interrupt K-line data refresh")
if "pending.finally" not in controller or "resumeTimeframe" not in controller:
    fail("page resume does not wait for an aborted latest request before restarting")
if 'DB_NAME="vegas-v6-market-cache"' not in controller:
    fail("Gate IndexedDB namespace is not V6-isolated")

controller = (ROOT / "kline/gate-kline-controller.js").read_text(encoding="utf-8")
if 'DB_VERSION=3' not in controller or 'META_STORE="seriesMeta"' not in controller or 'EMA_STORE="emaRows"' not in controller:
    fail("V6 persistent EMA cache schema version 3 is missing")
if "ensureEmaSeries" not in controller or "updateLatestEma" not in controller:
    fail("V6 full-history and incremental EMA cache handling is missing")
if "MEMORY_MAX_PER_SERIES=12000" not in controller or "MEMORY_MAX_TOTAL=30000" not in controller:
    fail("V6 volatile cache bounds are missing")
if 'createIndex("series","series"' not in controller or 'rowsStore.put({id:key+"|"+c.t,series:key,...c})' not in controller:
    fail("V6 per-candle IndexedDB storage is missing")
if "navigator.storage?.estimate" not in controller or "cache-storage-pressure" not in controller:
    fail("V6 browser storage pressure monitoring is missing")
if "memoryCacheIncomplete" not in controller:
    fail("V6 fallback cache eviction can incorrectly mark partial history complete")
if "discardedLegacyArray" not in controller:
    fail("V6 legacy cache migration may retain a duplicate full candle array in metadata")


# All static CSS/JS entry resources use one cache-busting release token.
STATIC_ASSET_VERSION = "v6-static-20261112-3"
KLINE_SYNC_VERSION = "v6-kline-pause-20261115-1"
static_versions = set()
for page in html_files:
    source = page.read_text(encoding="utf-8")
    for match in re.finditer(r"""(?:href|src)=["']([^"']+\.(?:css|js))\?v=([^"']+)["']""", source):
        static_versions.add(match.group(2))
if static_versions != {STATIC_ASSET_VERSION, KLINE_SYNC_VERSION}:
    fail(f"static CSS/JS cache versions are not unified: {sorted(static_versions)}")
if f'modules/v6-runtime.js?v={KLINE_SYNC_VERSION}' not in (ROOT / "index.html").read_text(encoding="utf-8"):
    fail("V6 runtime entry cache version is not refreshed for synchronized K-line rendering")
runtime_source = (ROOT / "modules/v6-runtime.js").read_text(encoding="utf-8")
if f'v6-kline-view.js?v={KLINE_SYNC_VERSION}' not in runtime_source:
    fail("V6 K-line view import cache version is not refreshed")
if f'gate-kline-controller.js?v={KLINE_SYNC_VERSION}' not in runtime_source:
    fail("Gate K-line controller import cache version is not refreshed")
if f'kline-rotation-pause.js?v={KLINE_SYNC_VERSION}' not in runtime_source:
    fail("independent K-line rotation pause controller is not imported")
pause_controller = (ROOT / "modules/kline-rotation-pause.js").read_text(encoding="utf-8")
if "createKlineRotationPause" not in pause_controller or "<=320" not in pause_controller or ">4" not in pause_controller:
    fail("K-line double-tap pause recognition rules are incomplete")
if "userRotationPaused" not in runtime_source:
    fail("K-line and Logo user pause state is not isolated from interaction locks")


controller = (ROOT / "kline/gate-kline-controller.js").read_text(encoding="utf-8")
if "start+7200<=currentHour" not in controller or "items.length===2" not in controller:
    fail("historical 2H buckets must require both aligned 1H candles")
if "twoHourRangeWindows" not in controller or "twoHourRangeWindows(from,to)" not in controller:
    fail("2H historical gap repair must use paired, aligned hourly request windows")
kline_tests = (ROOT / "tests/kline-controller.test.mjs").read_text(encoding="utf-8")
if "2H historical gap windows include the second 1H candle" not in kline_tests:
    fail("2H historical gap paging boundary test is missing")
if "items.length===1&&isCurrent&&first.t===currentHour" not in controller:
    fail("the active 2H bucket must preserve its current partial 1H candle")
if 'page=await older(c,tf,rows[0].t);' not in controller:
    fail("historical boundary must be independently confirmed")
if "persistRepairTask" not in controller or 'id:"repairTask|"+key' not in controller:
    fail("failed repair tasks are not persisted in IndexedDB")
if "scheduleHistoryRetry" not in controller or "historyRetryTimer" not in controller:
    fail("failed repair tasks do not retry automatically while the page remains active")

# The shared timeframe system is fixed to five periods, including 2H aggregation.
timeframe = (ROOT / "modules/timeframe-switch/index.html").read_text(encoding="utf-8")
runtime = (ROOT / "modules/v6-runtime.js").read_text(encoding="utf-8")
logo = (ROOT / "modules/logo/logo.js").read_text(encoding="utf-8")
controller = (ROOT / "kline/gate-kline-controller.js").read_text(encoding="utf-8")
for label, source in (("timeframe selector", timeframe), ("runtime", runtime), ("logo countdown", logo), ("K-line controller", controller)):
    if '"2H"' not in source and '>2H<' not in source:
        fail(f"{label} does not include the 2H timeframe")
if not re.search(r"height:\s*20%", timeframe) or not re.search(r"flex:\s*0\s+0\s+20%", timeframe):
    fail("five timeframe buttons do not use equal 20% height")
if 'function aggregate2H' not in controller or 'INTERVALS=Object.freeze({"1H":"1h","2H":"1h"' not in controller:
    fail("2H aggregation from Gate 1H candles is missing")

# Card quote/order APIs use one supported path; reject removed compatibility shims.
card_source = (ROOT / "cards/rolling-cards.js").read_text(encoding="utf-8")
if "window.updateQuote=" in card_source or "VEGAS_SET_CARD_ORDER" in card_source:
    fail("obsolete single-quote or message-based card-order API remains")
if "window.updateQuotes=function" not in card_source or "window.setCardOrder=function" not in card_source:
    fail("card batch quote and direct order APIs are required")
universe_source = (ROOT / "modules/shared/universe-v6.js").read_text(encoding="utf-8")
if "category:index<" in universe_source or "...item,index" not in universe_source:
    fail("instrument categories must come from explicit catalog fields, not array positions")

# Guard the 22-symbol V8 local pool and 22-symbol V12 feed.
catalog = (ROOT / "modules/shared/instrument-catalog.js").read_text(encoding="utf-8")
catalog_symbols = re.findall(r'\["([A-Z0-9]+)","[A-Z0-9]+USDT"', catalog)
if len(catalog_symbols) != 22 or len(set(catalog_symbols)) != 22:
    fail(f"local instrument catalog must contain exactly 22 unique symbols; found {len(catalog_symbols)}")
feed = (ROOT / "modules/signal-ticker/v12-feed.js").read_text(encoding="utf-8")
scan_block = re.search(r"V12_SCAN_SYMBOLS\s*=\s*Object\.freeze\(\[([^]]+)\]", feed)
if not scan_block or len(re.findall(r'"[A-Z0-9]+"', scan_block.group(1))) != 22:
    fail("V12 feed validation must retain its complete 22-symbol scan universe")
runtime = (ROOT / "modules/v6-runtime.js").read_text(encoding="utf-8")
if "INSTRUMENTS.length!==22" not in runtime:
    fail("V8 runtime must use the 22-symbol local pool")

source_lock_path = ROOT / ".media-source-sha"
provenance_path = ROOT / "docs/MEDIA-SOURCE-COMMIT.md"
if not source_lock_path.is_file() or not re.fullmatch(r"[0-9a-f]{40}", source_lock_path.read_text(encoding="utf-8").strip()):
    fail("a valid pinned Media source commit is required")
if not provenance_path.is_file() or source_lock_path.read_text(encoding="utf-8").strip() not in provenance_path.read_text(encoding="utf-8"):
    fail("deployed Media source provenance does not match the pinned commit")
operating_docs = ROOT / "docs/SEVEN-SYSTEMS.md"
if operating_docs.is_file():
    docs_source = operating_docs.read_text(encoding="utf-8")
    if "gate-universe.js" in docs_source or "updateQuote / updateQuotes" in docs_source:
        fail("operating-flow documentation contains obsolete module or card API references")

if errors:
    print("V8 validation FAILED:")
    for error in errors:
        print(" -", error)
    sys.exit(1)
print(f"V8 validation passed: {len(html_files)} HTML files; local references, inline scripts, CSS, imports, namespaces and dependencies checked.")
