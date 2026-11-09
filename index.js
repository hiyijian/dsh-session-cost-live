/**
 * Session cost — Host half.
 *
 * Registers the `sessionCost` session-projection unit. It folds the
 * provider-reported token usage committed to a Session log into per-route,
 * per-price-window token totals, adds the cost of every descendant Session the
 * agent spawned, and publishes both published currency tables (CNY and USD) as
 * a client wire view.
 *
 * Why descendant Sessions are read from their logs: a subagent is a separate
 * Session with its own billable log, and the parent log only records its id
 * (`subagent/catalog`). The session-projection seam is per-Session, so the
 * parent's own fold cannot see a child's usage, and a closed child is not in
 * the live session store. The committed log is the only source of truth for a
 * closed Session, so the unit locates the child's log file, folds it with the
 * same fold, and caches the result by file modification time.
 *
 * Costing facts this fold relies on:
 * - Usage buckets are disjoint: `inputTokens` is UNCACHED input only, and the
 *   billed prompt side is `inputTokens + cacheReadTokens + cacheWriteTokens`
 *   (`@deepseek-ai/dsh-token-meter`). `reasoningTokens` is a subset of
 *   `outputTokens`, so it is never added again.
 * - `assistant/message` carries the authoritative route of the attempt in
 *   `data.message.source`; `assistant/attempt` carries no route, so it is
 *   attributed to the newest route seen and corrected when the settled message
 *   replaces it.
 * - An in-step `llm/retry-started` retires the replaced attempt's sample so a
 *   settled message does not double count its own attempt (the shipped
 *   `tokenUsage` fold rule).
 * - The provider prices the same tokens differently in its peak and off-peak
 *   windows, so the fold keeps the two windows apart and the view applies the
 *   configured rates. State therefore never embeds money.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

/** Cordis plugin name. */
export const name = 'session-cost';

/** The projection registry is the unit's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections'];

/** Rates are quoted per 1M tokens. */
const PER_MILLION = 1_000_000;

/** Route used when a sample arrives before any route was ever observed. */
const UNKNOWN_ROUTE = 'unknown/unknown';

/** Bounded descendant traversal: a fork chain deeper than this is not expected. */
const MAX_SUBTREE_DEPTH = 8;

/**
 * Default rates in CNY (元) per 1M tokens at the provider's PEAK window.
 * Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing (2026-11-06).
 * The platform bills this account in CNY; the USD table below is the English
 * page's list, kept so the chip can switch display currency.
 */
const DEFAULT_PRICES_CNY = {
  'deepseek-flash': { input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8 },
  'deepseek-v4-pro': { input: 9, cacheRead: 0.3, cacheWrite: 9, output: 27 },
};

/** Default rates in USD per 1M tokens at the PEAK window. */
const DEFAULT_PRICES_USD = {
  'deepseek-flash': { input: 0.3, cacheRead: 0.006, cacheWrite: 0.3, output: 1.2 },
  'deepseek-v4-pro': { input: 1.32, cacheRead: 0.044, cacheWrite: 1.32, output: 3.96 },
};

/** Currency symbols used when the view does not override them. */
const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$' };

/**
 * Load the schema factory for the plugin's `Config` export.
 *
 * The runtime validates `Config` with the installation's own schemastery
 * (3.19, which has `.volatile()`), while a `link:`-installed checkout resolves
 * bare specifiers against its real path outside the profile. So the installation
 * copy is tried first, then the plugin's own dependency tree, then the profile.
 * @returns the `Schema` factory, or undefined when none can be loaded.
 */
async function loadSchema() {
  const factoryOf = (loaded) => {
    const factory = loaded?.Schema ?? loaded?.default ?? loaded;
    return typeof factory === 'function' ? factory : undefined;
  };
  const candidates = [];
  const resources = process.resourcesPath;
  if (typeof resources === 'string' && resources.length > 0) {
    candidates.push(path.join(resources, 'app.asar', 'dsh', 'package.json'));
    candidates.push(path.join(resources, 'app.asar', 'package.json'));
  }
  for (const anchor of [process.env.DSH_PROFILE_DIR, process.cwd()]) {
    if (typeof anchor === 'string' && anchor.length > 0) candidates.push(path.join(anchor, 'package.json'));
  }

  let fallback;
  // The plugin's own tree first: an installed copy resolves it as a dependency.
  try {
    const own = factoryOf(createRequire(import.meta.url)('@deepseek-ai/schemastery'));
    if (typeof own?.prototype?.volatile === 'function') return own;
    fallback = own;
  } catch {
    // Not resolvable from the linked package; try the profile anchors.
  }
  for (const base of candidates) {
    try {
      const factory = factoryOf(createRequire(base)('@deepseek-ai/schemastery'));
      if (typeof factory?.prototype?.volatile === 'function') return factory;
      fallback = fallback ?? factory;
    } catch {
      // Try the next anchor.
    }
  }
  try {
    const factory = factoryOf(await import('@deepseek-ai/schemastery'));
    if (typeof factory?.prototype?.volatile === 'function') return factory;
    fallback = fallback ?? factory;
  } catch {
    // No profile context: run without a configuration schema.
  }
  return fallback;
}

/** Schema factory, or undefined when this installation does not expose one. */
const Schema = await loadSchema();

/** Whether the factory can declare live-editable fields. */
const supportsVolatile = typeof Schema?.prototype?.volatile === 'function';

/** Mark one field live-editable when the factory supports volatility. */
function editable(schema) {
  return supportsVolatile ? schema.volatile() : schema;
}

/** One model's four rates, in that table's currency per 1M tokens. */
const rateSchema = Schema === undefined ? undefined : Schema.object({
  input: Schema.number().min(0).default(0).description('未缓存输入 / uncached input'),
  cacheRead: Schema.number().min(0).default(0).description('缓存读取 / cached input'),
  cacheWrite: Schema.number().min(0).default(0).description('缓存写入 / cache write'),
  output: Schema.number().min(0).default(0).description('输出 / output'),
});

/**
 * Editable configuration. Every field has a default, so a row with no config
 * behaves exactly like the built-in table and the plugin stays zero-config.
 *
 * Every field is `.volatile()`: the settings surface only exposes volatile
 * fields, and a volatile edit commits into the running instance instead of
 * restarting the plugin, so a price change reaches the next rendered view
 * without reloading anything. The plugin re-reads these references on every
 * drive and view for that reason.
 */
export const Config = Schema === undefined ? undefined : Schema.object({
  currency: editable(Schema.union([Schema.const('CNY'), Schema.const('USD')]).default('CNY'))
    .description('chip 默认展示的币种 / default display currency'),
  peakPricing: editable(Schema.boolean().default(true))
    .description('是否区分高峰与低峰时段 / price peak and off-peak windows separately'),
  includeSubagents: editable(Schema.boolean().default(true))
    .description('是否把子代理会话的费用计入本会话 / include descendant Session cost'),
  offPeakMultiplier: editable(Schema.number().min(0).max(1).step(0.05).default(0.5))
    .description('低峰相对高峰的倍率 / off-peak multiplier'),
  peakWindowsUtc: editable(Schema.array(Schema.tuple([
    Schema.number().min(0).max(24),
    Schema.number().min(0).max(24),
  ])).default([[1, 4], [6, 10]]))
    .description('高峰时段（UTC 小时） / peak windows in UTC hours'),
  peakWeekdays: editable(Schema.array(Schema.number().min(0).max(6)).default([1, 2, 3, 4, 5]))
    .description('高峰星期，0 为周日 / peak weekdays, 0 = Sunday'),
  prices: editable(Schema.dict(rateSchema).default({}))
    .description('人民币价目表，每百万 token / CNY rates per 1M tokens'),
  pricesUsd: editable(Schema.dict(rateSchema).default({}))
    .description('美元价目表，每百万 token / USD rates per 1M tokens'),
});

/** A fresh all-zero bucket record. */
function emptyBuckets() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/** Read one non-negative finite number, or undefined. */
function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Count a provider token field defensively: absent or malformed reads as zero. */
function count(value) {
  const number = positiveNumber(value);
  return number === undefined ? 0 : number;
}

/**
 * Normalize one rate entry. `input` and `output` identify a usable entry; a
 * missing cache rate defaults to 0 for cache reads and to the input rate for
 * cache writes, because a cache write is prompt tokens the provider did not
 * serve from cache.
 * @param value - configured rate object.
 * @returns a complete rate, or undefined when the entry is unusable.
 */
function normalizeRate(value) {
  if (typeof value !== 'object' || value === null) return undefined;
  const input = positiveNumber(value.input);
  const output = positiveNumber(value.output);
  if (input === undefined && output === undefined) return undefined;
  const cacheRead = positiveNumber(value.cacheRead) ?? 0;
  const cacheWrite = positiveNumber(value.cacheWrite) ?? input ?? 0;
  return { input: input ?? 0, output: output ?? 0, cacheRead, cacheWrite };
}

/** Read one UTC peak window pair `[startHour, endHour)`. */
function normalizeWindow(value) {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const start = positiveNumber(value[0]);
  const end = positiveNumber(value[1]);
  if (start === undefined || end === undefined) return undefined;
  if (start > 24 || end > 24 || start >= end) return undefined;
  return [Math.floor(start), Math.floor(end)];
}

/** Merge one configured rate table over its defaults. */
function mergePrices(defaults, configured) {
  const prices = new Map();
  for (const [key, value] of Object.entries(defaults)) {
    const rate = normalizeRate(value);
    if (rate !== undefined) prices.set(key, rate);
  }
  if (typeof configured === 'object' && configured !== null) {
    for (const [key, value] of Object.entries(configured)) {
      const rate = normalizeRate(value);
      if (rate !== undefined) prices.set(key, rate);
    }
  }
  return prices;
}

/**
 * Read one Config field. A `.volatile()` field is a live reference the loader
 * rewrites in place, so its current value is read through `get()`; an ordinary
 * field is already a plain value.
 * @param field - resolved Config field.
 * @returns the current plain value.
 */
function plainValue(field) {
  if (field !== null && typeof field === 'object' && typeof field.get === 'function') return field.get();
  return field;
}

/**
 * Resolve the plugin's config into the shape the fold and view use, so a
 * malformed row never throws during a projection drive. Re-run whenever a live
 * value is needed: volatile fields update in place without reactivating the
 * plugin, and every price change must reach the next view.
 * @param raw - the row's `config` object, possibly absent.
 * @returns resolved config.
 */
function resolveConfig(raw) {
  const source = typeof raw === 'object' && raw !== null ? raw : {};
  const pricesCny = mergePrices(DEFAULT_PRICES_CNY, plainValue(source.prices));
  const pricesUsd = mergePrices(DEFAULT_PRICES_USD, plainValue(source.pricesUsd));
  const windows = [];
  const configuredWindows = plainValue(source.peakWindowsUtc);
  if (Array.isArray(configuredWindows)) {
    for (const value of configuredWindows) {
      const window = normalizeWindow(value);
      if (window !== undefined) windows.push(window);
    }
  }
  const weekdays = [];
  const configuredWeekdays = plainValue(source.peakWeekdays);
  if (Array.isArray(configuredWeekdays)) {
    for (const value of configuredWeekdays) {
      const day = positiveNumber(value);
      if (day !== undefined && day <= 6) weekdays.push(Math.floor(day));
    }
  }
  const multiplier = positiveNumber(plainValue(source.offPeakMultiplier));
  const currency = plainValue(source.currency);
  return {
    defaultCurrency: currency === 'USD' ? 'USD' : (typeof currency === 'string' && currency.length > 0 ? currency : 'CNY'),
    prices: { CNY: pricesCny, USD: pricesUsd },
    includeSubagents: plainValue(source.includeSubagents) !== false,
    peakPricing: plainValue(source.peakPricing) !== false,
    // Beijing 09:00-12:00 and 14:00-18:00 = UTC 01:00-04:00 and 06:00-10:00.
    peakWindowsUtc: windows.length > 0 ? windows : [[1, 4], [6, 10]],
    peakWeekdays: weekdays.length > 0 ? weekdays : [1, 2, 3, 4, 5],
    offPeakMultiplier: multiplier === undefined ? 0.5 : Math.min(multiplier, 1),
  };
}

/**
 * Which price window one settled usage sample belongs to.
 * @param time - the committed event's wall time in milliseconds.
 * @param config - resolved config.
 * @returns `peak` or `offPeak`; an unpriced window is treated as peak.
 */
function periodOf(time, config) {
  if (!config.peakPricing) return 'peak';
  const moment = new Date(time);
  if (Number.isNaN(moment.getTime())) return 'peak';
  if (!config.peakWeekdays.includes(moment.getUTCDay())) return 'offPeak';
  const hour = moment.getUTCHours();
  return config.peakWindowsUtc.some(([start, end]) => hour >= start && hour < end) ? 'peak' : 'offPeak';
}

/** Join a provider and model into the route key the price table is addressed by. */
function routeKeyOf(provider, model) {
  if (typeof provider !== 'string' || provider.length === 0) return undefined;
  if (typeof model !== 'string' || model.length === 0) return undefined;
  return `${provider}/${model}`;
}

/** Map one provider usage record onto the four disjoint billing buckets. */
function bucketsFrom(usage) {
  return {
    input: count(usage.inputTokens),
    output: count(usage.outputTokens),
    cacheRead: count(usage.cacheReadTokens),
    cacheWrite: count(usage.cacheWriteTokens),
  };
}

/**
 * The usage one durable Assistant settlement reports for its attempt, mirroring
 * the shipped `tokenUsage` fold: a v2 settlement stores it beside the stream,
 * and an in-flight attempt reports it as the last `usage` stream chunk.
 * @param event - a committed session event.
 * @returns the usage record, or undefined when the event reports none.
 */
function usageOf(event) {
  const data = event.data;
  if (typeof data !== 'object' || data === null) return undefined;
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined;
  const stream = data.stream;
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record !== null && typeof record === 'object' && record.type === 'chunk') {
      const chunk = record.chunk;
      if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage') return chunk.usage;
    }
  }
  return undefined;
}

/** Whether two bucket records hold the same counts. */
function sameBuckets(left, right) {
  return left.input === right.input
    && left.output === right.output
    && left.cacheRead === right.cacheRead
    && left.cacheWrite === right.cacheWrite;
}

/** Apply one bucket record to another with a sign, clamping a removal at zero. */
function addBuckets(base, delta, sign) {
  const next = {
    input: base.input + sign * delta.input,
    output: base.output + sign * delta.output,
    cacheRead: base.cacheRead + sign * delta.cacheRead,
    cacheWrite: base.cacheWrite + sign * delta.cacheWrite,
  };
  if (next.input < 0) next.input = 0;
  if (next.output < 0) next.output = 0;
  if (next.cacheRead < 0) next.cacheRead = 0;
  if (next.cacheWrite < 0) next.cacheWrite = 0;
  return next;
}

/**
 * Add or remove one sample from the per-route, per-window state.
 * @param routes - current route table.
 * @param routeKey - billed route.
 * @param period - `peak` or `offPeak`.
 * @param buckets - the sample's disjoint buckets.
 * @param sign - `1` to add, `-1` to remove a replaced sample.
 * @returns a new route table (the input is never mutated).
 */
function adjustRoutes(routes, routeKey, period, buckets, sign) {
  const current = routes[routeKey] ?? { peak: emptyBuckets(), offPeak: emptyBuckets() };
  const next = { ...routes };
  next[routeKey] = { ...current, [period]: addBuckets(current[period], buckets, sign) };
  return next;
}

/** The initial fold state. */
function initState() {
  return { routes: {}, children: {}, last: null, currentRoute: null };
}

/**
 * Fold one committed Session event into the cost state.
 * Pure and synchronous; returns the same reference for events it ignores.
 * @param state - current state.
 * @param event - committed Session event.
 * @param config - resolved config.
 * @returns the next state.
 */
function applyEvent(state, event, config) {
  switch (event.type) {
    case 'subagent/catalog': {
      // A child Session is a separate session with its own billable log; the
      // subtree view reads it from the log, so the fold only records its id.
      const childId = event.data !== null && typeof event.data === 'object' ? event.data.childId : undefined;
      if (typeof childId !== 'string' || childId.length === 0) return state;
      if (state.children[childId] === true) return state;
      return { ...state, children: { ...state.children, [childId]: true } };
    }
    case 'llm/retry-started': {
      const last = state.last;
      if (last === null || last.turn !== event.data.turn || last.step !== event.data.step) return state;
      return { ...state, last: null };
    }
    case 'request/header': {
      const header = event.data !== null && typeof event.data === 'object' ? event.data.header : undefined;
      const callConfig = header !== null && typeof header === 'object' ? header.config : undefined;
      const routeKey = routeKeyOf(callConfig?.provider, callConfig?.model);
      if (routeKey === undefined || routeKey === state.currentRoute) return state;
      return { ...state, currentRoute: routeKey };
    }
    case 'assistant/message':
    case 'assistant/attempt': {
      const sample = usageOf(event);
      if (sample === undefined) return state;
      const data = event.data;
      const source = data.message !== null && typeof data.message === 'object' ? data.message.source : undefined;
      const routeKey = routeKeyOf(source?.provider, source?.model) ?? state.currentRoute ?? UNKNOWN_ROUTE;
      const period = periodOf(event.time, config);
      const buckets = bucketsFrom(sample);
      const last = state.last;
      const previous = last !== null && last.turn === data.turn && last.step === data.step ? last : null;
      if (previous !== null
        && previous.routeKey === routeKey
        && previous.period === period
        && sameBuckets(previous.buckets, buckets)) return state;
      let routes = state.routes;
      if (previous !== null) routes = adjustRoutes(routes, previous.routeKey, previous.period, previous.buckets, -1);
      routes = adjustRoutes(routes, routeKey, period, buckets, 1);
      return {
        routes,
        children: state.children,
        last: { turn: data.turn, step: data.step, routeKey, period, buckets },
        currentRoute: routeKey,
      };
    }
    default:
      return state;
  }
}

/** Whether a file offset starts a zstd frame. */
function isZstdMagic(buffer, offset) {
  return buffer[offset] === 0x28 && buffer[offset + 1] === 0xb5
    && buffer[offset + 2] === 0x2f && buffer[offset + 3] === 0xfd;
}

/**
 * Walk concatenated zstd frames and return every decompressed byte. Node's
 * zstd helpers stop after the first frame, and a Session log is one frame per
 * flushed batch, so frames are walked explicitly.
 * @param raw - the stored file bytes.
 * @returns decompressed text.
 */
function decompressZstd(raw) {
  const chunks = [];
  let offset = 0;
  while (offset < raw.length) {
    if (!isZstdMagic(raw, offset)) throw new Error(`no zstd magic at ${offset}`);
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

/**
 * Locate and fold closed or live Session logs by id, cached by file version.
 * A Session log is the durable source of truth, so a descendant Session that
 * the live store no longer holds can still be priced exactly.
 */
class SessionLogStore {
  /**
   * @param config - resolved config (for the fold's price window).
   * @param root - sessions directory; defaults to `<DSH_HOME>/sessions`.
   */
  constructor(config, root) {
    this.config = config;
    this.root = root;
    this.fileBySession = new Map();
    this.cache = new Map();
    this.workspaceDirs = undefined;
  }

  /** One-time listing of the per-workspace session directories. */
  directories() {
    if (this.workspaceDirs !== undefined) return this.workspaceDirs;
    const dirs = [];
    try {
      for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(path.join(this.root, entry.name));
      }
    } catch {
      // No readable session store: the subtree simply contributes nothing.
    }
    this.workspaceDirs = dirs;
    return dirs;
  }

  /** Resolve one Session's log file, or undefined when it is not stored. */
  fileFor(sessionId) {
    const cached = this.fileBySession.get(sessionId);
    if (cached !== undefined) return cached;
    for (const dir of this.directories()) {
      for (const name of [`session-${sessionId}`, sessionId]) {
        const candidate = path.join(dir, name);
        let entries;
        try { entries = fs.readdirSync(candidate, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          if (!entry.isFile() || !/^session.*\.jsonl(\.zstd)?$/.test(entry.name)) continue;
          const file = path.join(candidate, entry.name);
          this.fileBySession.set(sessionId, file);
          return file;
        }
      }
    }
    this.fileBySession.set(sessionId, undefined);
    return undefined;
  }

  /** Fold one Session's stored log into cost state, cached by mtime and size. */
  stateFor(sessionId) {
    const file = this.fileFor(sessionId);
    if (file === undefined) return undefined;
    let stat;
    try { stat = fs.statSync(file); } catch { return undefined; }
    const cached = this.cache.get(sessionId);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.state;
    let text;
    try {
      const raw = fs.readFileSync(file);
      text = file.endsWith('.zstd') ? decompressZstd(raw) : raw.toString('utf8');
    } catch {
      return undefined;
    }
    let state = initState();
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'session' || typeof event.type !== 'string') continue;
      state = applyEvent(state, event, this.config);
    }
    this.cache.set(sessionId, { mtimeMs: stat.mtimeMs, size: stat.size, state });
    return state;
  }
}

/** Merge one Session's per-route buckets into the subtree accumulator. */
function mergeRoutes(target, routes) {
  for (const [routeKey, windows] of Object.entries(routes)) {
    const current = target.get(routeKey) ?? { peak: emptyBuckets(), offPeak: emptyBuckets() };
    target.set(routeKey, {
      peak: addBuckets(current.peak, windows.peak, 1),
      offPeak: addBuckets(current.offPeak, windows.offPeak, 1),
    });
  }
}

/**
 * Add one Session and every stored descendant into the subtree accumulator.
 * @param state - that Session's fold state.
 * @param store - log store used to price descendants.
 * @param config - resolved config.
 * @param target - route → peak/off-peak bucket map being accumulated.
 * @param visited - descendant ids already merged (cycle/fork guard).
 * @param depth - current descendant depth.
 */
function collectSubtree(state, store, config, target, visited, depth) {
  mergeRoutes(target, state.routes);
  if (!config.includeSubagents || depth >= MAX_SUBTREE_DEPTH) return;
  for (const childId of Object.keys(state.children)) {
    if (visited.has(childId)) continue;
    visited.add(childId);
    const childState = store.stateFor(childId);
    if (childState !== undefined) collectSubtree(childState, store, config, target, visited, depth + 1);
  }
}

/**
 * Look up one route's configured rate: the exact `<provider>/<model>` route
 * first, then its bare model id. There is no default rate: a route with no
 * entry has no price, and the view reports it as unpriced instead of inventing
 * a number from some other model's table.
 * @param routeKey - `<provider>/<model>`.
 * @param prices - the currency's configured table.
 * @returns the configured rate, or undefined when this route is unpriced.
 */
function rateFor(routeKey, prices) {
  const direct = prices.get(routeKey);
  if (direct !== undefined) return direct;
  const slash = routeKey.indexOf('/');
  const model = slash === -1 ? routeKey : routeKey.slice(slash + 1);
  return prices.get(model);
}

/**
 * Money per price window and billing line for one currency table.
 *
 * A route with billed tokens but no configured rate makes the whole display
 * unpriced: the view then reports `priced: false` and no amounts, because a
 * partial or guessed total would be worse than saying "not configured".
 * @param subtotal - route → peak/off-peak buckets.
 * @param config - resolved config.
 * @param currency - `CNY` or `USD`.
 * @returns display block with a `priced` flag, a total, and two windows.
 */
function displayOf(subtotal, config, currency) {
  const prices = config.prices[currency] ?? new Map();
  const empty = () => ({ uncachedInput: 0, cacheInput: 0, output: 0 });
  const peak = empty();
  const offPeak = empty();
  const missing = [];
  for (const [routeKey, windows] of subtotal) {
    const billed = windows.peak.input + windows.peak.output + windows.peak.cacheRead + windows.peak.cacheWrite
      + windows.offPeak.input + windows.offPeak.output + windows.offPeak.cacheRead + windows.offPeak.cacheWrite;
    if (billed === 0) continue;
    const rate = rateFor(routeKey, prices);
    if (rate === undefined) {
      missing.push(routeKey);
      continue;
    }
    for (const window of ['peak', 'offPeak']) {
      const buckets = windows[window];
      const multiplier = window === 'peak' ? 1 : config.offPeakMultiplier;
      const target = window === 'peak' ? peak : offPeak;
      target.uncachedInput += ((buckets.input * rate.input + buckets.cacheWrite * rate.cacheWrite) / PER_MILLION) * multiplier;
      target.cacheInput += (buckets.cacheRead * rate.cacheRead / PER_MILLION) * multiplier;
      target.output += (buckets.output * rate.output / PER_MILLION) * multiplier;
    }
  }
  // `unpricedRoutes` is diagnostic only: the panel shows the one message, and
  // the reconciliation tool prints these exact keys so a missing row is a
  // copy-paste away from being fixed.
  if (missing.length > 0) {
    return {
      symbol: CURRENCY_SYMBOLS[currency] ?? '',
      priced: false,
      total: 0,
      peak: empty(),
      offPeak: empty(),
      unpricedRoutes: missing,
    };
  }
  const total = peak.uncachedInput + peak.cacheInput + peak.output
    + offPeak.uncachedInput + offPeak.cacheInput + offPeak.output;
  return { symbol: CURRENCY_SYMBOLS[currency] ?? '', priced: true, peak, offPeak, total, unpricedRoutes: [] };
}

/**
 * Project the fold state plus its stored descendants into the client view.
 * @param state - the unit's fold state.
 * @param config - resolved config.
 * @param store - log store used to price descendants.
 * @returns JSON-safe view.
 */
function viewOf(state, config, store) {
  const subtotal = new Map();
  collectSubtree(state, store, config, subtotal, new Set(), 0);
  const tokens = emptyBuckets();
  for (const windows of subtotal.values()) {
    for (const window of ['peak', 'offPeak']) {
      const buckets = windows[window];
      tokens.input += buckets.input;
      tokens.output += buckets.output;
      tokens.cacheRead += buckets.cacheRead;
      tokens.cacheWrite += buckets.cacheWrite;
    }
  }
  const displays = {};
  for (const currency of ['CNY', 'USD']) displays[currency] = displayOf(subtotal, config, currency);
  const tokenTotal = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return {
    defaultCurrency: config.defaultCurrency,
    hasUsage: tokenTotal > 0,
    displays,
    tokens: { ...tokens, total: tokenTotal },
  };
}

/**
 * The `sessionCost` projection unit definition for one resolved config.
 * @param rawConfig - the row's live Config object (volatile fields are references).
 * @param store - log store used to price descendants.
 * @returns the definition registered on `ctx.sessionProjections`.
 */
function definitionOf(rawConfig, store) {
  // Volatile Config fields update in place, so the resolved view of them is
  // recomputed per drive and per view instead of captured at activation.
  const configNow = () => resolveConfig(rawConfig);
  return {
    key: 'sessionCost',
    stateVersion: 2,
    // The registry parses state on checkpoint restore; the state is plain JSON
    // written only by this fold, so the parse is the identity function.
    stateSchema: { parse: (value) => value },
    init: initState,
    apply: (state, event) => applyEvent(state, event, configNow()),
    wire: {
      viewSchema: { parse: (value) => value },
      view: (state) => viewOf(state, configNow(), store),
      // Only an opened Session renders the chip; session list rows stay lean.
      summary: false,
    },
  };
}

/**
 * Register the `sessionCost` unit.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - the row's config object.
 * @returns when the unit is registered.
 */
export async function apply(ctx, config) {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  const store = new SessionLogStore(resolveConfig(config), path.join(home, 'sessions'));
  await ctx.sessionProjections.register(definitionOf(config, store));
}
