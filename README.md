# dsh-session-cost-live

Show the **live cost of the current session** — in CNY or USD — right next to the
token-usage chip at the bottom of the DeepSeek Harness composer.

Token counts are already in the shipped chip; this plugin prices them.

## Features

- **Session total, subagents included.** The chip prices the current Session's
  own log plus every descendant Session the agent spawned, so a delegation-heavy
  conversation does not under-report.
- **Two official price tables, zero config.** CNY (the account-billed list) and
  USD (the English pricing page) are built in for `deepseek-flash` and
  `deepseek-v4-pro`. The panel can switch display currency; the choice is
  remembered per browser.
- **Peak / off-peak split.** Official peak windows (Beijing 09:00–12:00 and
  14:00–18:00, Monday–Friday) are billed at the peak rate and everything else at
  the off-peak rate, tracked separately.
- **Exactly the billing buckets.** Uncached input, cached input, cache write and
  output are disjoint, so the numbers line up with the provider's invoice.
- **Honest about unknown models.** A model with no configured rate makes the
  total `-` and the panel says the rate is not configured; it never reuses
  another model's price.
- **Editable from the Web UI.** Plugins → this bundle → **Configure** edits both
  price tables as a table: add a model, override a built-in, restore defaults.
  Only overrides are stored, saving applies live without restarting the plugin.
- **Offline and read-only.** No network calls, no telemetry; the Host half only
  reads session logs.

## Install

```bash
dsh plugin --profile web add dsh-session-cost-live
```

Replace `web` with your profile name (for example `desktop`), then restart
`dsh web` (or refresh the page). The plugin targets the DSH Web profile; it
renders into the composer dock next to the shipped token-usage chip.

From source:

```bash
dsh plugin --profile web add git+https://github.com/hiyijian/dsh-session-cost-live.git
```

## Usage

- The composer dock shows the session cost: click it for the total plus the
  peak-hours and off-peak billing lines (uncached input / cached input / output;
  zero lines are hidden), and to switch between CNY and USD.
- A session with no billed usage shows no chip.
- Configure prices at **Plugins → dsh-session-cost-live → Configure**. Built-in
  models are listed and marked; edit a rate in place, add a model with
  `provider/model` or `model` plus its four rates, and save. A built-in row you
  override can be reset; custom rows can be deleted.

Pricing currently covers the DeepSeek models. For any other route, add its
entry in the same page, for example `moonshotai-cn/kimi-k2.6`; set
**Separate peak / off-peak pricing** off when that provider charges a flat rate.

Advanced setups can still write the same values into the profile's
`cordis.patch.yml`:

```yaml
- id: session-cost
  name: 'dsh-session-cost-live'
  config:
    currency: CNY
    peakPricing: false
    prices:      # CNY per 1M tokens
      'moonshotai-cn/kimi-k2.6': { input: 4, cacheRead: 0.4, cacheWrite: 4, output: 16 }
    pricesUsd:   # USD per 1M tokens
      'moonshotai-cn/kimi-k2.6': { input: 0.95, cacheRead: 0.16, cacheWrite: 0, output: 4 }
```

## How the cost is computed

- Usage comes from the committed Session log (`assistant/message`, with the
  in-flight `assistant/attempt` sample and the shipped `tokenUsage` retry
  replacement rule), attributed to the model route of the settled message.
- Descendant Sessions are located under `<DSH_HOME>/sessions` and folded with the
  same logic, cached by log-file version, so closed subagent Sessions are still
  counted.
- Money is applied in the projection's client view from the configured tables,
  so a price edit re-prices the session without a state migration.

Sample reconciliation output (real run, one day of logs):

```text
$ node tools/reconcile-day.mjs
day 2026-11-06 (Asia/Shanghai), prices as shipped with this plugin

   8 root Session(s), 8 descendant Session(s)

  what each chip shows (root Session + its descendants):
    ¥14.9484  session-90d20aed-…  (standard)  +4 descendant(s)
    ¥6.9516   session-7403ddd7-…  (standard)  +2 descendant(s)
    ¥5.2839   session-c2af9d0a-…  (standard)  +2 descendant(s)
  …

  TOTAL ¥29.73  (sum of every Session's own cost = the platform bill)
```

`tools/reconcile-day.mjs` replays every local session log through the plugin's
exact fold and price table. It reads logs only; it never calls a provider.

## Permissions and privacy

- Reads session logs under `$DSH_HOME/sessions` (read-only) to price descendant
  Sessions and to run the reconciliation tool.
- Registers one Host session-projection unit, one composer-dock entry, and the
  configuration page for this bundle.
- Writes nothing except this plugin's own configuration when you press Save in
  its configuration page.
- No network access at runtime.

## Compatibility

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0-0` (tested on `0.2.2-rc.1`).
- Web profile; platform-independent (Windows, macOS, Linux).
- Requires the shipped composer (`conversation.composer.dock` slot) and the
  session-projection registry.

## Category

Models & Reasoning — cost tracking for model usage.

## Development

```bash
node --check index.js
node --check client.js
node test/host-fold.test.mjs
```

## License

MIT © 2026 hiyijian
