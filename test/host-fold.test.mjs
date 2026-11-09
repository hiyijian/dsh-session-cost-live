// Fold-level tests for the session-cost Host half. Pure functions plus synthetic
// Session logs in a temporary DSH home; no DOM, no React, no browser emulation.
// Run with:  node test/host-fold.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

// The plugin resolves descendant logs under <DSH_HOME>/sessions, so point that
// at a temporary store before the plugin activates.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cost-test-'));
process.env.DSH_HOME = HOME;
const SESSIONS = path.join(HOME, 'sessions');

/** Write one synthetic Session log (`events` excludes the header). */
function writeSession(sessionId, events, cwd = 'D:\\fake-workspace') {
  const dir = path.join(SESSIONS, '--fake-workspace--', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const header = { type: 'session', version: 4, id: sessionId, createdAt: 1793950000000, cwd, isSeeded: false, delegationDepth: 0 };
  const body = [header, ...events].map((line) => JSON.stringify(line)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(body, 'utf8')));
}

const { apply } = await import('../index.js');

let definition;
const ctx = {
  sessionProjections: {
    async register(def) {
      definition = def;
      return { stateOf: () => undefined, dispose: async () => {}, readerFor: () => () => undefined };
    },
  },
};

await apply(ctx, {});
if (!definition) throw new Error('registration did not happen');

const assert = (label, actual, expected, epsilon = 1e-12) => {
  const ok = Math.abs(actual - expected) < epsilon;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) process.exitCode = 1;
};
const assertTrue = (label, value, detail = '') => {
  console.log(`${value ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!value) process.exitCode = 1;
};

const event = (type, data, time) => ({ type, data, time });
// Beijing 10:00 (peak), Beijing 13:00 (off-peak), Sunday 10:00 (off-peak).
const PEAK = Date.UTC(2026, 10, 6, 2, 0, 0);
const OFF = Date.UTC(2026, 10, 6, 5, 0, 0);
const WEEKEND = Date.UTC(2026, 10, 8, 2, 0, 0);

const message = (usage, source = { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' }, turn = 1, step = 1) => ({
  turn,
  step,
  message: { role: 'assistant', source },
  usage,
});

let state = definition.init();
const feed = (ev) => { state = definition.apply(state, ev); return state; };
const view = () => definition.wire.view(state);

// 1. peak sample priced with the CNY table: input 2, cache read 0.04, output 8 per 1M
feed(event('request/header', { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash' } } }, PEAK));
feed(event('assistant/message', message({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10000, cacheWriteTokens: 0 }), PEAK));

assert('peak uncached input (CNY)', view().displays.CNY.peak.uncachedInput, (1000 * 2) / 1e6);
assert('peak cache input (CNY)', view().displays.CNY.peak.cacheInput, (10000 * 0.04) / 1e6);
assert('peak output (CNY)', view().displays.CNY.peak.output, (500 * 8) / 1e6);
assert('peak total (CNY)', view().displays.CNY.total, 0.0064);
assertTrue('default currency is CNY', view().defaultCurrency === 'CNY');
assert('USD table is computed too', view().displays.USD.total, 0.00096);
assertTrue('zero off-peak lines stay zero', view().displays.CNY.offPeak.uncachedInput === 0);

// 2. off-peak sample is priced at half
feed(event('assistant/message', message({ inputTokens: 1000, outputTokens: 1000 }, undefined, 1, 2), OFF));
assert('off-peak uncached input (CNY)', view().displays.CNY.offPeak.uncachedInput, (1000 * 1) / 1e6);
assert('off-peak output (CNY)', view().displays.CNY.offPeak.output, (1000 * 4) / 1e6);
assert('off-peak total (CNY)', view().displays.CNY.total, 0.0064 + 0.005);

// 3. a weekend sample is off-peak too
feed(event('assistant/message', message({ inputTokens: 0, outputTokens: 1000 }, undefined, 1, 3), WEEKEND));
assert('weekend is off-peak', view().displays.CNY.offPeak.output, (2000 * 4) / 1e6);

// 4. ignored events keep the state reference (projection contract)
const before = state;
const same = definition.apply(state, event('tool/call', { callId: 'x' }, PEAK));
assertTrue('irrelevant event returns the same reference', same === before);

// 5. in-step retry: the failed attempt and its retry are both billed; the
// settled message only replaces the sample of its OWN attempt.
let retry = definition.init();
const feedRetry = (ev) => { retry = definition.apply(retry, ev); };
// A series header is logged before its attempts, which is how the attempt
// samples learn their route.
feedRetry(event('request/header', { header: { config: { provider: 'deepseek-account', model: 'deepseek-flash' } } }, PEAK));
feedRetry(event('assistant/attempt', { turn: 2, step: 1, stream: [] }, PEAK));
feedRetry(event('assistant/attempt', {
  turn: 2, step: 1,
  stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 4000, outputTokens: 0 } } }],
}, PEAK));
feedRetry(event('llm/retry-started', { turn: 2, step: 1 }, PEAK));
feedRetry(event('assistant/message', message({ inputTokens: 6000, outputTokens: 0 }), PEAK));
assert('retry bills the failed attempt and the retry', definition.wire.view(retry).displays.CNY.total, ((4000 + 6000) * 2) / 1e6);

// 6. model switch prices two routes separately
let mixed = definition.init();
const feedMixed = (ev) => { mixed = definition.apply(mixed, ev); };
feedMixed(event('assistant/message', message({ inputTokens: 1000, outputTokens: 0 }, undefined, 1, 1), PEAK));
feedMixed(event('assistant/message', message(
  { inputTokens: 1000, outputTokens: 0 },
  { kind: 'model', provider: 'deepseek-account', model: 'deepseek-v4-pro' },
  1, 2,
), PEAK));
assert('mixed-session CNY total', definition.wire.view(mixed).displays.CNY.total, (1000 * 2 + 1000 * 9) / 1e6);
assert('mixed-session USD total', definition.wire.view(mixed).displays.USD.total, (1000 * 0.3 + 1000 * 1.32) / 1e6);

// 7. subtree: a stored descendant Session is included, and so is a grandchild
writeSession('aaaaaaaa-child-1', [
  event('assistant/message', message({ inputTokens: 2000, outputTokens: 1000 }), PEAK),
  event('subagent/catalog', { version: 0, childId: 'bbbbbbbb-grandchild-1', childCreatedAt: 1 }, PEAK),
]);
writeSession('bbbbbbbb-grandchild-1', [
  event('assistant/message', message({ inputTokens: 1000, outputTokens: 0 }), PEAK),
]);
const subtree = definition.init();
let subtreeState = definition.apply(subtree, event('subagent/catalog', { version: 0, childId: 'aaaaaaaa-child-1', childCreatedAt: 1 }, PEAK));
subtreeState = definition.apply(subtreeState, event('assistant/message', message({ inputTokens: 1000, outputTokens: 0 }), PEAK));
const subtreeView = definition.wire.view(subtreeState);
// own 0.002 + child (2000*2 + 1000*8)/1e6 = 0.012 + grandchild 0.002
assert('subtree total includes descendants', subtreeView.displays.CNY.total, 0.002 + 0.012 + 0.002);
assert('subtree breakdown keeps windows', subtreeView.displays.CNY.peak.uncachedInput, (1000 * 2 + 2000 * 2 + 1000 * 2) / 1e6);

// 8. a child with no stored log contributes nothing and never throws
let missing = definition.init();
missing = definition.apply(missing, event('subagent/catalog', { version: 0, childId: 'missing-session', childCreatedAt: 1 }, PEAK));
missing = definition.apply(missing, event('assistant/message', message({ inputTokens: 1000, outputTokens: 0 }), PEAK));
assert('missing child log contributes nothing', definition.wire.view(missing).displays.CNY.total, (1000 * 2) / 1e6);

// 9. duplicate catalog entries count the child once
let duplicate = definition.init();
for (let index = 0; index < 3; index += 1) {
  duplicate = definition.apply(duplicate, event('subagent/catalog', { version: 0, childId: 'aaaaaaaa-child-1', childCreatedAt: 1 }, PEAK));
}
assert('duplicate catalog entries merge once', definition.wire.view(duplicate).displays.CNY.total, 0.012 + 0.002);

// 10. state survives a JSON round trip (checkpoint/cache contract)
const clone = JSON.parse(JSON.stringify(mixed));
assert('JSON round-trip view total', definition.wire.view(clone).displays.CNY.total, definition.wire.view(mixed).displays.CNY.total);
assertTrue('state is JSON-safe', typeof JSON.stringify(definition.init()) === 'string');

// 11. config overrides: price tables and display currency
let overridden;
await apply({ sessionProjections: { async register(def) { overridden = def; } } }, {
  currency: 'USD',
  prices: { 'deepseek-flash': { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } },
});
let priced = overridden.init();
priced = overridden.apply(priced, event('assistant/message', message({ inputTokens: 1000, outputTokens: 1000 }), PEAK));
assert('overridden CNY table applies', overridden.wire.view(priced).displays.CNY.total, (1000 * 1 + 1000 * 2) / 1e6);
assertTrue('configured default currency is USD', overridden.wire.view(priced).defaultCurrency === 'USD');

// 12. disabling subtree inclusion keeps only this Session
let shallow;
await apply({ sessionProjections: { async register(def) { shallow = def; } } }, { includeSubagents: false });
let shallowState = shallow.init();
shallowState = shallow.apply(shallowState, event('subagent/catalog', { version: 0, childId: 'aaaaaaaa-child-1', childCreatedAt: 1 }, PEAK));
shallowState = shallow.apply(shallowState, event('assistant/message', message({ inputTokens: 1000, outputTokens: 0 }), PEAK));
assert('includeSubagents false excludes descendants', shallow.wire.view(shallowState).displays.CNY.total, (1000 * 2) / 1e6);

// 13. no default rate: an unknown route makes the figure unknown, not guessed
let unknownRoute = definition.init();
unknownRoute = definition.apply(unknownRoute, event('assistant/message', message(
  { inputTokens: 1000, outputTokens: 0 },
  { kind: 'model', provider: 'changan-gateway', model: '6411:glm-5.2' },
), PEAK));
const unknownView = definition.wire.view(unknownRoute);
assertTrue('unknown route reports no price', unknownView.displays.CNY.priced === false && unknownView.displays.USD.priced === false);
assertTrue('unknown route is named for the config fix', unknownView.displays.CNY.unpricedRoutes.includes('changan-gateway/6411:glm-5.2'));
assertTrue('unknown route still reports usage', unknownView.hasUsage === true && unknownView.tokens.total === 1000);
assert('unknown route contributes no money', unknownView.displays.CNY.total, 0);

// 14. a wildcard or a legacy default field cannot rescue an unknown route
let wildcard;
await apply({ sessionProjections: { async register(def) { wildcard = def; } } }, {
  prices: { '*': { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
  defaultPrice: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  defaultPriceUsd: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
});
let wildcardState = wildcard.init();
wildcardState = wildcard.apply(wildcardState, event('assistant/message', message(
  { inputTokens: 1000, outputTokens: 0 },
  { kind: 'model', provider: 'changan-gateway', model: '6411:glm-5.2' },
), PEAK));
assertTrue('wildcard and legacy default fields are ignored', wildcard.wire.view(wildcardState).displays.CNY.priced === false);

// 15. a rate configured by full route key prices that route
let configured;
await apply({ sessionProjections: { async register(def) { configured = def; } } }, {
  prices: { 'changan-gateway/6411:glm-5.2': { input: 3, output: 6, cacheRead: 0, cacheWrite: 3 } },
});
let configuredState = configured.init();
configuredState = configured.apply(configuredState, event('assistant/message', message(
  { inputTokens: 1000, outputTokens: 1000 },
  { kind: 'model', provider: 'changan-gateway', model: '6411:glm-5.2' },
), PEAK));
assert('route-keyed rate prices the route', configured.wire.view(configuredState).displays.CNY.total, (1000 * 3 + 1000 * 6) / 1e6);
assertTrue('configured route is priced', configured.wire.view(configuredState).displays.CNY.priced === true);

// 16. one unpriced model poisons the whole figure
let poisoned;
await apply({ sessionProjections: { async register(def) { poisoned = def; } } }, {});
let poisonedState = poisoned.init();
poisonedState = poisoned.apply(poisonedState, event('assistant/message', message({ inputTokens: 1000, outputTokens: 0 }, undefined, 1, 1), PEAK));
poisonedState = poisoned.apply(poisonedState, event('assistant/message', message(
  { inputTokens: 1000, outputTokens: 0 },
  { kind: 'model', provider: 'changan-gateway', model: '6411:glm-5.2' },
  1, 2,
), PEAK));
assertTrue('mixed priced/unpriced makes the figure unknown', poisoned.wire.view(poisonedState).displays.CNY.priced === false);

// 17. an empty session has no usage and therefore no figure
assertTrue('no usage reports hasUsage false', definition.wire.view(definition.init()).hasUsage === false);

fs.rmSync(HOME, { recursive: true, force: true });

