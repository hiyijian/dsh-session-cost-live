#!/usr/bin/env node
/**
 * Reconcile one day of spend against the platform usage page.
 *
 * Replays every Session log under the DSH home through this plugin's exact fold
 * and price table, and prints:
 *   - one line per Session with that Session's own cost;
 *   - one line per root Session with the aggregated cost its chip shows
 *     (itself plus every descendant Session the agent spawned);
 *   - the day total, which is the sum of every Session's own cost.
 *
 * The platform usage page is the account-wide bill, so it equals the day total.
 *
 * Usage:
 *   node tools/reconcile-day.mjs                 # today, Asia/Shanghai
 *   node tools/reconcile-day.mjs 2026-11-06      # an explicit day
 *
 * Session files are concatenated zstd frames; Node's zstd helper stops at the
 * first frame, so frames are walked explicitly.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { apply } from '../index.js';

const DAY = process.argv[2] ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const [year, month, day] = DAY.split('-').map(Number);
if (!year || !month || !day) {
  console.error(`usage: node tools/reconcile-day.mjs [YYYY-MM-DD]   (got "${DAY}")`);
  process.exit(2);
}
const DAY_START = Date.UTC(year, month - 1, day - 0, 0, 0, 0) - 8 * 3600 * 1000;
const DAY_END = DAY_START + 24 * 3600 * 1000;

const HOME = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh');
const ROOT = path.join(HOME, 'sessions');

const isMagic = (buffer, offset) => buffer[offset] === 0x28 && buffer[offset + 1] === 0xb5
  && buffer[offset + 2] === 0x2f && buffer[offset + 3] === 0xfd;

/** Walk concatenated zstd frames and return every decompressed byte. */
function decompressZstd(raw) {
  const chunks = [];
  let offset = 0;
  while (offset < raw.length) {
    if (!isMagic(raw, offset)) throw new Error(`no zstd magic at ${offset}`);
    const descriptor = raw[offset + 4];
    const fcsFlag = descriptor >> 6;
    const singleSegment = (descriptor >> 5) & 1;
    const checksum = (descriptor >> 2) & 1;
    const dictFlag = descriptor & 3;
    let cursor = offset + 5;
    if (singleSegment === 0) cursor += 1;
    cursor += [0, 1, 2, 4][dictFlag];
    cursor += fcsFlag === 0 ? (singleSegment === 1 ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
    for (;;) {
      const header = raw[cursor] | (raw[cursor + 1] << 8) | (raw[cursor + 2] << 16);
      const lastBlock = header & 1;
      const blockType = (header >> 1) & 3;
      const blockSize = header >> 3;
      cursor += 3 + (blockType === 1 ? 1 : blockSize);
      if (lastBlock === 1) break;
    }
    if (checksum === 1) cursor += 4;
    chunks.push(zlib.zstdDecompressSync(raw.subarray(offset, cursor)));
    offset = cursor;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Read one session file as text. */
function readSession(file) {
  const raw = fs.readFileSync(file);
  return file.endsWith('.zstd') ? decompressZstd(raw) : raw.toString('utf8');
}

/** Every session log file under the sessions root. */
function sessionFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.startsWith('session') && /\.jsonl(\.zstd)?$/.test(entry.name)) out.push(full);
    }
  };
  walk(ROOT);
  return out;
}

// One registration supplies the exact fold this plugin ships. Subtree inclusion
// is off here because this tool walks the Session tree itself: per-Session own
// costs must not absorb descendants, or the day total would count them twice.
let definition;
const config = process.env.DSH_SESSION_COST_CONFIG ? JSON.parse(process.env.DSH_SESSION_COST_CONFIG) : {};
await apply({ sessionProjections: { register: async (def) => { definition = def; } } }, { ...config, includeSubagents: false });

const rows = [];
for (const file of sessionFiles()) {
  let text;
  try { text = readSession(file); } catch { continue; }
  let header;
  let current = definition.init();
  let started = false;
  let lastTime = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'session') { header = event; continue; }
    if (typeof event.time === 'number') lastTime = Math.max(lastTime, event.time);
    // The day's figure folds only in-window events, so a Session that spent
    // before today is not measured against a previous day's unpriced usage.
    if (event.time < DAY_START || event.time >= DAY_END) continue;
    started = true;
    current = definition.apply(current, event);
  }
  if (!started) continue;
  const view = definition.wire.view(current);
  const currency = view.defaultCurrency ?? 'CNY';
  const display = view.displays[currency];
  const priced = display.priced === true;
  rows.push({
    sessionId: header?.id ?? path.basename(path.dirname(file)),
    parentId: header?.parentSession ?? null,
    delegationDepth: header?.delegationDepth ?? null,
    agentPreset: header?.agentPreset ?? null,
    priced,
    cost: priced ? display.total : 0,
    symbol: display.symbol,
    unpricedRoutes: [...new Set([...view.displays.CNY.unpricedRoutes ?? [], ...view.displays.USD.unpricedRoutes ?? []])],
    tokens: { ...view.tokens },
    lastTime,
  });
}

if (rows.length === 0) {
  console.log(`no Session log records usage on ${DAY}`);
  process.exit(0);
}

const byId = new Map(rows.map((row) => [row.sessionId, row]));
const rootOf = (row) => {
  let current = row;
  const seen = new Set([row.sessionId]);
  while (current.parentId !== null && byId.has(current.parentId) && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return current;
};

const roots = new Map();
for (const row of rows) {
  const root = rootOf(row);
  if (!roots.has(root.sessionId)) roots.set(root.sessionId, { root, children: [], total: 0 });
  const group = roots.get(root.sessionId);
  if (row.sessionId !== root.sessionId) group.children.push(row);
  group.total += row.cost;
}

const symbol = rows[0].symbol;
const dayTotal = rows.reduce((sum, row) => sum + (row.priced ? row.cost : 0), 0);
const unpricedSessions = rows.filter((row) => !row.priced);
const money = (row) => (row.priced ? `${symbol}${row.cost.toFixed(4)}` : '-');
console.log(`day ${DAY} (Asia/Shanghai), prices as shipped with this plugin`);
console.log('');
console.log(`  ${String(rows.filter((row) => row.delegationDepth === 0).length).padStart(2)} root Session(s), ${rows.filter((row) => row.delegationDepth > 0).length} descendant Session(s)`);
console.log('');
console.log('  what each chip shows (root Session + its descendants):');
for (const group of [...roots.values()].sort((a, b) => a.root.lastTime - b.root.lastTime)) {
  const groupPriced = group.children.every((row) => row.priced) && group.root.priced;
  const value = groupPriced ? `${symbol}${group.total.toFixed(4)}` : '-';
  console.log(`    ${value}  ${group.root.sessionId}  (${group.root.agentPreset})  +${group.children.length} descendant(s)`);
}
console.log('');
console.log('  per-Session own cost:');
for (const row of rows.sort((a, b) => a.lastTime - b.lastTime)) {
  const tokens = row.tokens;
  console.log(`    ${money(row)}  depth=${row.delegationDepth}  ${row.sessionId}`);
  console.log(`              input ${tokens.input} · output ${tokens.output} · cacheRead ${tokens.cacheRead} · cacheWrite ${tokens.cacheWrite}`);
}
console.log('');
if (unpricedSessions.length > 0) {
  console.log(`  TOTAL ${symbol}${dayTotal.toFixed(2)}  (incomplete: ${unpricedSessions.length} Session(s) have billed usage but no configured rate)`);
  console.log(`  Add a rate for: ${[...new Set(unpricedSessions.flatMap((row) => row.unpricedRoutes))].join(', ')}`);
} else {
  console.log(`  TOTAL ${symbol}${dayTotal.toFixed(2)}  (sum of every Session's own cost = the platform bill)`);
}
