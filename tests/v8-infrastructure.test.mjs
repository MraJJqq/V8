import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("V8 pins an exact Media commit and documents the one-way sync ownership", async () => {
  const pin = (await read(".media-source-sha")).trim();
  const sync = await read("docs/SYNC-CONTRACT.md");
  const source = await read("docs/MEDIA-SOURCE-COMMIT.md");
  assert.match(pin, /^[0-9a-f]{40}$/);
  assert.ok(sync.includes("MraJJqq/Media"));
  assert.ok(sync.includes(pin));
  assert.ok(source.includes(pin));
  assert.match(sync, /V6-prefixed module paths/);
  assert.match(sync, /Do not patch generated V8 runtime copies directly/);
});

test("K-line audit checks all available history through an exchange boundary", async () => {
  const workflow = await read(".github/workflows/v8-kline-audit.yml");
  assert.match(workflow, /start = 0/);
  assert.match(workflow, /history_boundary_reached/);
  assert.match(workflow, /pages > 500/);
  assert.doesNotMatch(workflow, /365\s*\*\s*86400/);
});

test("browser validation isolates rotation and exercises phone and tablet gestures", async () => {
  const workflow = await read(".github/workflows/v8-browser-kline-check.yml");
  assert.match(workflow, /Automatic rotation did not pause/);
  assert.match(workflow, /exerciseTouchGestures\('phone'\)/);
  assert.match(workflow, /exerciseTouchGestures\('tablet'\)/);
  assert.match(workflow, /width: 1024, height: 1366/);
});
