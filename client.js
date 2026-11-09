window.__ModuleLoader__.load({
  id: 'dsh-session-cost-live',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    /** Module exports object returned to the module loader. */
    const exports = {}

    /** Dictionary namespace owned by this plugin. */
    const NS = 'session-cost'

    /** Persisted display-currency preference. */
    const CURRENCY_STORAGE_KEY = 'session-cost:currency'

    /**
     * Built-in price tables, mirrored from the Host half's defaults. Both halves
     * ship in one package, so they always describe the same version; the page
     * uses them to show the built-in rows and to decide when a row is back at
     * its default and its override can be dropped.
     */
    const BUILTIN = {
      CNY: {
        'deepseek-flash': { input: 2, cacheRead: 0.04, cacheWrite: 2, output: 8 },
        'deepseek-v4-pro': { input: 9, cacheRead: 0.3, cacheWrite: 9, output: 27 },
      },
      USD: {
        'deepseek-flash': { input: 0.3, cacheRead: 0.006, cacheWrite: 0.3, output: 1.2 },
        'deepseek-v4-pro': { input: 1.32, cacheRead: 0.044, cacheWrite: 1.32, output: 3.96 },
      },
    }

    /** The four rate columns, in display order. */
    const RATE_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output']

    /** The price tables the page edits, in display order. */
    const PRICE_TABLES = [
      { name: 'prices', currency: 'CNY', title: 'config.cnyTable' },
      { name: 'pricesUsd', currency: 'USD', title: 'config.usdTable' },
    ]

    /** Chinese dictionary; the key-set source of truth. */
    /** Chinese dictionary; the key-set source of truth. */
    /** Chinese dictionary; the key-set source of truth. */
    const zh = {
      'chip.aria': '会话费用 {amount}，点击查看明细',
      'panel.title': '会话费用',
      'panel.peak': '高峰时段',
      'panel.offPeak': '非高峰时段',
      'panel.uncachedInput': '未缓存输入',
      'panel.cacheInput': '缓存输入',
      'panel.output': '输出',
      'panel.currency': '计价币种',
      'panel.currencyCny': '人民币',
      'panel.currencyUsd': '美元',
      'panel.unpriced': '未配置费率',
      'config.summary': '内置价目表 · 已自定义 {count} 个模型',
      'config.title': '价目表',
      'config.description': '在下方为模型填写每百万 token 的价格。未填写的模型按内置价目表计价；内置模型也可覆盖，恢复默认后按内置价计算。保存后立即生效。',
      'config.currency': '默认展示币种',
      'config.peakPricing': '区分高峰/低峰时段',
      'config.includeSubagents': '计入子代理会话',
      'config.offPeakMultiplier': '低峰倍率',
      'config.cnyTable': '人民币价目表（元 / 百万 token）',
      'config.usdTable': '美元价目表（USD / 百万 token）',
      'config.model': '模型（provider/model 或 model）',
      'config.modelPlaceholder': '例如 moonshotai-cn/kimi-k2.6',
      'config.uncachedInput': '未缓存输入',
      'config.cacheInput': '缓存输入',
      'config.cacheWrite': '缓存写入',
      'config.output': '输出',
      'config.add': '添加',
      'config.remove': '删除',
      'config.revert': '恢复默认',
      'config.builtinBadge': '内置',
      'config.customBadge': '自定义',
      'config.save': '保存',
      'config.discard': '放弃修改',
      'config.saved': '已保存',
      'config.failed': '保存失败，配置可能被更高优先级的层覆盖',
      'config.readOnly': '当前 profile 不允许从界面保存配置',
      'config.loading': '正在读取配置…',
      'config.unavailable': '配置不可用',
      'config.conflict': '配置已被改动，请重新编辑后保存',
    }

    /** English dictionary, key-identical to the Chinese source of truth. */
    const en = {
      'chip.aria': 'Session cost {amount}; open for details',
      'panel.title': 'Session cost',
      'panel.peak': 'Peak hours',
      'panel.offPeak': 'Off-peak hours',
      'panel.uncachedInput': 'Uncached input',
      'panel.cacheInput': 'Cached input',
      'panel.output': 'Output',
      'panel.currency': 'Currency',
      'panel.currencyCny': 'CNY',
      'panel.currencyUsd': 'USD',
      'panel.unpriced': 'Rate not configured',
      'config.summary': 'Built-in table · {count} custom model(s)',
      'config.title': 'Price table',
      'config.description': 'Enter each model’s price per 1M tokens below. Models without an entry use the built-in table; built-in models can be overridden and revert to the built-in price when reset. Saving applies immediately.',
      'config.currency': 'Default display currency',
      'config.peakPricing': 'Separate peak / off-peak pricing',
      'config.includeSubagents': 'Include subagent Sessions',
      'config.offPeakMultiplier': 'Off-peak multiplier',
      'config.cnyTable': 'CNY table (yuan / 1M tokens)',
      'config.usdTable': 'USD table (USD / 1M tokens)',
      'config.model': 'Model (provider/model or model)',
      'config.modelPlaceholder': 'e.g. moonshotai-cn/kimi-k2.6',
      'config.uncachedInput': 'Uncached input',
      'config.cacheInput': 'Cached input',
      'config.cacheWrite': 'Cache write',
      'config.output': 'Output',
      'config.add': 'Add',
      'config.remove': 'Delete',
      'config.revert': 'Reset to default',
      'config.builtinBadge': 'Built-in',
      'config.customBadge': 'Custom',
      'config.save': 'Save',
      'config.discard': 'Discard',
      'config.saved': 'Saved',
      'config.failed': 'Save failed; a higher configuration layer may override this row',
      'config.readOnly': 'This profile does not allow saving configuration from the UI',
      'config.loading': 'Reading configuration…',
      'config.unavailable': 'Configuration unavailable',
      'config.conflict': 'Configuration changed; edit again and save',
    }

    /**
     * Copied from the shipped composer stat pill and its stat dialog so this
     * chip reads as part of the same line and its panel matches the host's
     * popovers. Only host theme tokens are referenced.
     */
    const CSS = '.scs_anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}'
      + '.scs_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}'
      + '.scs_pill svg{flex:none;width:14px;height:14px}'
      + '.scs_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}'
      + '@media (hover:hover){.scs_pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}'
      + '.scs_label{text-overflow:ellipsis;min-width:0;overflow:hidden}'
      + '.scs_panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:hidden auto;border:0;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);padding:16px;font-size:12px;line-height:18px;cursor:default}'
      + '.scs_title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}'
      + '.scs_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}'
      + '.scs_titleLabel svg{flex:none;width:14px;height:14px}'
      + '.scs_titleValue{font-variant-numeric:tabular-nums}'
      + '.scs_titleRule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}'
      + '.scs_section{color:var(--dsw-alias-label-tertiary);margin-bottom:10px}'
      + '.scs_sectionLabel{margin-bottom:4px}'
      + '.scs_details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:4px 16px;margin:0;display:grid}'
      + '.scs_details dt,.scs_details dd{min-width:0;margin:0}'
      + '.scs_details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}'
      + '.scs_unpriced{color:var(--dsw-alias-label-tertiary);padding:8px 0 2px}'
      + '.scs_footer{border-top:.5px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:10px;align-items:center;gap:8px;display:flex}'
      + '.scs_footerLabel{color:var(--dsw-alias-label-tertiary);flex:1}'
      + '.scs_currency{background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;line-height:18px;padding:2px 8px}'
      + '.scs_currency[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'
      + '@media (hover:hover){.scs_currency:hover{color:var(--dsw-alias-label-secondary)}}'
      + '.cfg_root{display:flex;flex-direction:column;gap:14px;max-width:760px}'
      + '.cfg_hint{color:var(--dsw-alias-label-tertiary);line-height:18px;margin:0}'
      + '.cfg_toolbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 16px}'
      + '.cfg_field{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);min-width:0}'
      + '.cfg_fieldLabel{color:var(--dsw-alias-label-tertiary);white-space:nowrap}'
      + '.cfg_select,.cfg_number{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;line-height:18px;padding:3px 6px;min-width:0}'
      + '.cfg_number{width:90px;font-variant-numeric:tabular-nums}'
      + '.cfg_section{display:flex;flex-direction:column;gap:8px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px}'
      + '.cfg_sectionTitle{margin:0;color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;line-height:18px}'
      + '.cfg_table{display:flex;flex-direction:column;gap:6px}'
      + '.cfg_head,.cfg_row,.cfg_addRow{display:grid;grid-template-columns:minmax(150px,1fr) repeat(4,96px) 84px;gap:8px;align-items:center}'
      + '.cfg_head{color:var(--dsw-alias-label-tertiary)}'
      + '.cfg_modelCell{display:flex;flex-direction:column;gap:2px;min-width:0}'
      + '.cfg_modelName{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}'
      + '.cfg_badge{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:14px}'
      + '.cfg_input{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-variant-numeric:tabular-nums;line-height:18px;padding:3px 6px;min-width:0;width:100%;box-sizing:border-box}'
      + '.cfg_input:disabled{opacity:.5}'
      + '.cfg_rowAction{background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;line-height:18px;padding:2px 8px}'
      + '@media (hover:hover){.cfg_rowAction:hover{color:var(--dsw-alias-label-secondary)}}'
      + '.cfg_footer{display:flex;align-items:center;gap:10px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px}'
      + '.cfg_primary{background:var(--dsw-alias-brand-primary);border:0;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-bg-base);cursor:pointer;font:inherit;line-height:18px;padding:4px 14px}'
      + '.cfg_primary:disabled{cursor:default;opacity:.5}'
      + '.cfg_secondary{background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;font:inherit;line-height:18px;padding:4px 12px}'
      + '.cfg_notice{color:var(--dsw-alias-label-tertiary)}'
      + '.cfg_noticeError{color:var(--dsw-alias-state-error-primary)}'
      + '.cfg_note{color:var(--dsw-alias-label-tertiary)}'

    /** Fallback translator when the locale service is unavailable. */
    function untranslated(key, params) {
      return String(params?.amount ?? key)
    }

    /** Money text whose precision follows magnitude. */
    function formatAmount(value, symbol) {
      const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0
      if (!(amount > 0)) return `${symbol}0.00`
      if (amount < 0.0001) return `<${symbol}0.0001`
      const digits = amount >= 100 ? 0
        : amount >= 10 ? 1
          : amount >= 1 ? 2
            : amount >= 0.1 ? 3
              : amount >= 0.01 ? 4
                : amount >= 0.001 ? 5
                  : 6
      let text = amount.toFixed(digits)
      if (digits > 2) {
        text = text.replace(/0+$/, '').replace(/\.$/, '')
        const decimals = text.includes('.') ? text.length - text.indexOf('.') - 1 : 0
        if (decimals < 2) text = Number(text).toFixed(2)
      }
      return `${symbol}${text}`
    }

    /** A coin carrying the ¥ mark: original artwork, inherits the pill's text color. */
    function CoinIcon() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        focusable: 'false',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
        h('circle', { cx: 8, cy: 8, r: 6.2 }),
        h('path', { d: 'M5.5 4.9 8 7.8l2.5-2.9' }),
        h('path', { d: 'M8 7.8v3.4' }),
        h('path', { d: 'M6.3 9.2h3.4' }),
        h('path', { d: 'M6.3 10.4h3.4' }),
      )
    }

    /** Read the persisted currency, ignoring corrupt or unavailable storage. */
    function readStoredCurrency() {
      try {
        const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY)
        return stored === 'USD' || stored === 'CNY' ? stored : undefined
      } catch {
        return undefined
      }
    }

    /** Persist the display currency. */
    function storeCurrency(currency) {
      try { window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency) } catch { /* ignore */ }
    }

    /** Fixed-position style that anchors the panel above the chip, clamped to the viewport. */
    function panelStyle(rect) {
      const margin = 12
      const width = Math.min(320, window.innerWidth - margin * 2)
      const centered = rect.left + rect.width / 2 - width / 2
      const left = Math.max(margin, Math.min(centered, window.innerWidth - width - margin))
      const bottom = Math.min(Math.max(margin, window.innerHeight - rect.top + 8), window.innerHeight - margin)
      return { left, bottom, width }
    }

    /**
     * One price window's billing lines; a line whose amount is 0 is omitted and
     * a window with no lines renders nothing at all.
     * @param labelKey - dictionary key for the window heading.
     * @param window - `{ uncachedInput, cacheInput, output }` amounts.
     * @param display - the selected currency display (for its symbol).
     * @param t - bound translator.
     * @returns the section element, or null when the window costs nothing.
     */
    function renderWindow(labelKey, window, display, t) {
      const lines = [
        ['panel.uncachedInput', window.uncachedInput],
        ['panel.cacheInput', window.cacheInput],
        ['panel.output', window.output],
      ].filter(([, amount]) => typeof amount === 'number' && amount > 0)
      if (lines.length === 0) return null
      return h('div', { className: 'scs_section', key: labelKey },
        h('div', { className: 'scs_sectionLabel' }, t(labelKey)),
        h('dl', { className: 'scs_details' }, lines.flatMap(([key, amount]) => [
          h('dt', { key: `${key}-dt` }, t(key)),
          h('dd', { key: `${key}-dd` }, formatAmount(amount, display.symbol)),
        ])),
      )
    }

    /**
     * The cost chip. It reads the Host projection's already-computed money, so
     * the Client folds nothing and every session reload restores the same figure.
     * Clicking opens a small panel with the total, the peak/off-peak billing
     * lines, and a display-currency switch (CNY by default).
     * @param props - standard slot props; `useProjection` and the bound `t`.
     * @returns the chip and, while open, its portaled panel.
     */
    function CostChip({ useProjection, t }) {
      const [open, setOpen] = React.useState(false)
      const [currency, setCurrency] = React.useState(() => readStoredCurrency())
      const [pos, setPos] = React.useState(null)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const view = useProjection('sessionCost')

      React.useEffect(() => {
        if (!open) return undefined
        const node = rootRef.current
        if (node !== null) setPos(panelStyle(node.getBoundingClientRect()))
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onClick = (event) => {
          const target = event.target
          if (!(target instanceof Node)) return
          if (rootRef.current?.contains(target) === true) return
          if (panelRef.current?.contains(target) === true) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('click', onClick, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('click', onClick, true)
        }
      }, [open])

      const translate = typeof t === 'function' ? t : untranslated
      const displays = view?.displays ?? {}
      const preferred = currency ?? view?.defaultCurrency ?? 'CNY'
      const selected = displays[preferred] !== undefined ? preferred : Object.keys(displays)[0]
      const display = selected === undefined ? undefined : displays[selected]
      if (view === undefined || view === null || view.hasUsage !== true || display === undefined) return null
      // No default rate exists: a model whose price is unknown leaves the whole
      // figure unknown, so the chip shows a dash instead of a plausible number.
      const priced = display.priced === true && display.total > 0
      const amount = priced ? formatAmount(display.total, display.symbol) : '-'
      const otherPriced = !priced
        && ['CNY', 'USD'].some((code) => code !== selected && displays[code]?.priced === true && displays[code].total > 0)

      const body = priced
        ? [
          h('div', { className: 'scs_title', key: 'title' },
            h('span', { className: 'scs_titleLabel' }, h(CoinIcon), translate('panel.title')),
            h('span', { className: 'scs_titleValue' }, amount),
          ),
          h('div', { className: 'scs_titleRule', key: 'rule', 'aria-hidden': true }),
          renderWindow('panel.peak', display.peak, display, translate),
          renderWindow('panel.offPeak', display.offPeak, display, translate),
        ]
        : [h('div', { className: 'scs_unpriced', key: 'unpriced' }, translate('panel.unpriced'))]

      const footer = priced || otherPriced
        ? h('div', { className: 'scs_footer' },
          h('span', { className: 'scs_footerLabel' }, translate('panel.currency')),
          ['CNY', 'USD'].filter((code) => displays[code] !== undefined).map((code) => h('button', {
            key: code,
            type: 'button',
            className: 'scs_currency',
            'aria-pressed': code === selected,
            onClick: () => {
              setCurrency(code)
              storeCurrency(code)
            },
          }, translate(code === 'CNY' ? 'panel.currencyCny' : 'panel.currencyUsd'))),
        )
        : null

      const panel = open && pos !== null
        ? ReactDOM.createPortal(
          h('div', {
            ref: panelRef,
            className: 'scs_panel',
            role: 'dialog',
            'aria-label': translate('panel.title'),
            style: pos,
          }, ...body, footer),
          document.body,
        )
        : null

      return h('span', { className: 'scs_anchor', 'data-composer-stat': 'cost', ref: rootRef },
        h('button', {
          type: 'button',
          className: 'scs_pill',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': priced ? translate('chip.aria', { amount }) : translate('panel.unpriced'),
          onClick: () => setOpen(!open),
        },
          h(CoinIcon),
          h('span', { className: 'scs_label' }, amount),
        ),
        panel,
      )
    }

    /** A zeroed rate record. */
    function emptyRate() {
      return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    }

    /** Whether two rate records carry the same four numbers. */
    function sameRate(left, right) {
      if (left === undefined || right === undefined || left === null || right === null) return false
      return RATE_FIELDS.every((field) => Number(left[field] ?? 0) === Number(right[field] ?? 0))
    }

    /** Merge one user override table over its built-in table. */
    function mergePriceTable(builtin, overrides) {
      const table = {}
      for (const [key, rate] of Object.entries(builtin)) table[key] = { ...emptyRate(), ...rate }
      for (const [key, rate] of Object.entries(overrides ?? {})) table[key] = { ...emptyRate(), ...rate }
      return table
    }

    /** Round a draft rate to plain non-negative numbers. */
    function cleanRate(rate) {
      const out = emptyRate()
      for (const field of RATE_FIELDS) {
        const value = Number(rate?.[field])
        out[field] = Number.isFinite(value) && value >= 0 ? value : 0
      }
      return out
    }

    /**
     * One table's "add a model" row.
     * @param props - translator, disabled flag, and the add callback.
     * @returns the row element.
     */
    function AddModelRow({ t, disabled, onAdd }) {
      const [model, setModel] = React.useState('')
      const [rate, setRate] = React.useState(emptyRate)
      const add = () => {
        const key = model.trim()
        if (key.length === 0) return
        onAdd(key, cleanRate(rate))
        setModel('')
        setRate(emptyRate())
      }
      return h('div', { className: 'cfg_addRow' },
        h('input', {
          className: 'cfg_input',
          placeholder: t('config.modelPlaceholder'),
          value: model,
          disabled,
          onChange: (event) => setModel(event.target.value),
        }),
        RATE_FIELDS.map((field) => h('input', {
          key: field,
          className: 'cfg_input',
          type: 'number',
          min: 0,
          step: 0.001,
          disabled,
          value: rate[field],
          'aria-label': t('config.' + field),
          onChange: (event) => setRate({ ...rate, [field]: Number(event.target.value) }),
        })),
        h('button', { type: 'button', className: 'cfg_rowAction', disabled, onClick: add }, t('config.add')),
      )
    }

    /**
     * The plugin's configuration page, rendered by the Plugins page through its
     * `plugins.row.config` slot. The page owns the row: the Host settings
     * surface supplies the staged `form.state` and the `form.mutate` writer, so
     * saving persists profile-level overrides without the user editing a file.
     * @param props - translator, view kind (`summary` | `page`), and the form bridge.
     * @returns the summary string, the form, or a status note.
     */
    function ConfigPage({ t, view, form }) {
      const translate = typeof t === 'function' ? t : untranslated
      const state = form?.state
      const ready = state?.status === 'ready'
      const revision = ready ? state.revision : undefined
      const buildDraft = React.useCallback(() => {
        if (!ready) return undefined
        const value = state.value ?? {}
        const user = state.user ?? {}
        return {
          currency: value.currency ?? 'CNY',
          peakPricing: value.peakPricing !== false,
          includeSubagents: value.includeSubagents !== false,
          offPeakMultiplier: typeof value.offPeakMultiplier === 'number' ? value.offPeakMultiplier : 0.5,
          tables: {
            prices: mergePriceTable(BUILTIN.CNY, value.prices),
            pricesUsd: mergePriceTable(BUILTIN.USD, value.pricesUsd),
          },
          overrides: {
            prices: user.prices ?? {},
            pricesUsd: user.pricesUsd ?? {},
          },
        }
      }, [ready, revision])
      const [draft, setDraft] = React.useState(buildDraft)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      React.useEffect(() => { setDraft(buildDraft()) }, [buildDraft])

      if (view === 'summary') {
        const custom = ready
          ? Object.keys(state.user?.prices ?? {}).length + Object.keys(state.user?.pricesUsd ?? {}).length
          : 0
        return translate('config.summary', { count: custom })
      }
      if (form === undefined) return h('div', { className: 'cfg_note' }, translate('config.unavailable'))
      if (!ready) return h('div', { className: 'cfg_note' }, translate(state?.status === 'loading' ? 'config.loading' : 'config.unavailable'))
      if (draft === undefined) return h('div', { className: 'cfg_note' }, translate('config.loading'))

      const writable = state.writable !== false
      const value = state.value ?? {}

      const updateRate = (tableName, model, field, next) => {
        setDraft((current) => ({
          ...current,
          tables: {
            ...current.tables,
            [tableName]: {
              ...current.tables[tableName],
              [model]: { ...current.tables[tableName][model], [field]: next },
            },
          },
        }))
        setNotice(null)
      }
      const addModel = (tableName, model, rate) => {
        setDraft((current) => ({
          ...current,
          tables: { ...current.tables, [tableName]: { ...current.tables[tableName], [model]: rate } },
        }))
        setNotice(null)
      }
      const resetOrRemove = (tableName, model) => {
        setDraft((current) => {
          const builtin = (tableName === 'prices' ? BUILTIN.CNY : BUILTIN.USD)[model]
          const table = { ...current.tables[tableName] }
          if (builtin !== undefined) table[model] = { ...emptyRate(), ...builtin }
          else delete table[model]
          return { ...current, tables: { ...current.tables, [tableName]: table } }
        })
        setNotice(null)
      }
      const setScalar = (key, next) => {
        setDraft((current) => ({ ...current, [key]: next }))
        setNotice(null)
      }

      // Only overrides are written: a row left at its built-in values is saved
      // as an unset, so the built-in table keeps applying and future plugin
      // versions can update the defaults under untouched rows.
      const buildOps = () => {
        const ops = []
        for (const table of PRICE_TABLES) {
          const stored = value[table.name] ?? {}
          const draftTable = draft.tables[table.name]
          const builtin = table.currency === 'CNY' ? BUILTIN.CNY : BUILTIN.USD
          const models = new Set([...Object.keys(stored), ...Object.keys(draftTable)])
          for (const model of models) {
            const desired = draftTable[model]
            const current = stored[model]
            if (desired === undefined) {
              if (current !== undefined) ops.push({ op: 'unset', path: [table.name, model] })
              continue
            }
            const rate = cleanRate(desired)
            if (builtin[model] !== undefined && sameRate(rate, builtin[model])) {
              if (current !== undefined) ops.push({ op: 'unset', path: [table.name, model] })
              continue
            }
            if (!sameRate(rate, current)) ops.push({ op: 'set', path: [table.name, model], value: rate })
          }
        }
        if (draft.currency !== value.currency) ops.push({ op: 'set', path: ['currency'], value: draft.currency })
        if (draft.peakPricing !== (value.peakPricing !== false)) ops.push({ op: 'set', path: ['peakPricing'], value: draft.peakPricing })
        if (draft.includeSubagents !== (value.includeSubagents !== false)) ops.push({ op: 'set', path: ['includeSubagents'], value: draft.includeSubagents })
        if (Number(draft.offPeakMultiplier) !== Number(value.offPeakMultiplier ?? 0.5)) {
          ops.push({ op: 'set', path: ['offPeakMultiplier'], value: Number(draft.offPeakMultiplier) })
        }
        return ops
      }
      const save = async () => {
        if (!writable || busy) return
        const ops = buildOps()
        if (ops.length === 0) {
          setNotice({ kind: 'ok', text: translate('config.saved') })
          return
        }
        setBusy(true)
        try {
          const accepted = await form.mutate(ops)
          setNotice(accepted
            ? { kind: 'ok', text: translate('config.saved') }
            : { kind: 'error', text: translate('config.conflict') })
        } catch {
          setNotice({ kind: 'error', text: translate('config.failed') })
        } finally {
          setBusy(false)
        }
      }

      const section = (table) => h('section', { className: 'cfg_section', key: table.name },
        h('h4', { className: 'cfg_sectionTitle' }, translate(table.title)),
        h('div', { className: 'cfg_head' },
          h('span', null, translate('config.model')),
          RATE_FIELDS.map((field) => h('span', { key: field }, translate('config.' + field))),
          h('span'),
        ),
        h('div', { className: 'cfg_table' },
          Object.keys(draft.tables[table.name]).map((model) => {
            const rate = draft.tables[table.name][model]
            const builtin = (table.currency === 'CNY' ? BUILTIN.CNY : BUILTIN.USD)[model]
            const overridden = draft.overrides[table.name]?.[model] !== undefined
            const showAction = builtin === undefined || overridden
            return h('div', { className: 'cfg_row', key: model },
              h('div', { className: 'cfg_modelCell' },
                h('span', { className: 'cfg_modelName' }, model),
                h('span', { className: 'cfg_badge' }, translate(builtin === undefined ? 'config.customBadge' : 'config.builtinBadge')),
              ),
              RATE_FIELDS.map((field) => h('input', {
                key: field,
                className: 'cfg_input',
                type: 'number',
                min: 0,
                step: 0.001,
                disabled: !writable || busy,
                'aria-label': `${model} ${translate('config.' + field)}`,
                value: rate[field],
                onChange: (event) => updateRate(table.name, model, field, Number(event.target.value)),
              })),
              showAction
                ? h('button', {
                  type: 'button',
                  className: 'cfg_rowAction',
                  disabled: !writable || busy,
                  onClick: () => resetOrRemove(table.name, model),
                }, translate(builtin === undefined ? 'config.remove' : 'config.revert'))
                : h('span'),
            )
          }),
        ),
        h(AddModelRow, { t: translate, disabled: !writable || busy, onAdd: (model, rate) => addModel(table.name, model, rate) }),
      )

      return h('div', { className: 'cfg_root' },
        h('p', { className: 'cfg_hint' }, translate('config.description')),
        h('div', { className: 'cfg_toolbar' },
          h('label', { className: 'cfg_field' },
            h('span', { className: 'cfg_fieldLabel' }, translate('config.currency')),
            h('select', {
              className: 'cfg_select',
              value: draft.currency,
              disabled: !writable || busy,
              onChange: (event) => setScalar('currency', event.target.value),
            },
              h('option', { value: 'CNY' }, 'CNY ¥'),
              h('option', { value: 'USD' }, 'USD $'),
            ),
          ),
          h('label', { className: 'cfg_field' },
            h('input', {
              type: 'checkbox',
              checked: draft.peakPricing,
              disabled: !writable || busy,
              onChange: (event) => setScalar('peakPricing', event.target.checked),
            }),
            h('span', { className: 'cfg_fieldLabel' }, translate('config.peakPricing')),
          ),
          h('label', { className: 'cfg_field' },
            h('input', {
              type: 'checkbox',
              checked: draft.includeSubagents,
              disabled: !writable || busy,
              onChange: (event) => setScalar('includeSubagents', event.target.checked),
            }),
            h('span', { className: 'cfg_fieldLabel' }, translate('config.includeSubagents')),
          ),
          h('label', { className: 'cfg_field' },
            h('span', { className: 'cfg_fieldLabel' }, translate('config.offPeakMultiplier')),
            h('input', {
              className: 'cfg_number',
              type: 'number',
              min: 0,
              max: 1,
              step: 0.05,
              value: draft.offPeakMultiplier,
              disabled: !writable || busy,
              onChange: (event) => setScalar('offPeakMultiplier', Number(event.target.value)),
            }),
          ),
        ),
        PRICE_TABLES.map(section),
        h('div', { className: 'cfg_footer' },
          h('button', { type: 'button', className: 'cfg_primary', disabled: !writable || busy, onClick: save },
            busy ? translate('config.loading') : translate('config.save')),
          h('button', {
            type: 'button',
            className: 'cfg_secondary',
            disabled: !writable || busy,
            onClick: () => { setDraft(buildDraft()); setNotice(null) },
          }, translate('config.discard')),
          notice === null ? null : h('span', { className: notice.kind === 'error' ? 'cfg_notice cfg_noticeError' : 'cfg_notice' }, notice.text),
          writable ? null : h('span', { className: 'cfg_notice' }, translate('config.readOnly')),
        ),
      )
    }

    /** Services this plugin needs: the slot registry and the locale registry. */
    const inject = ['slots', 'locale']

    /**
     * Register the dictionaries, the copied stylesheet, and the dock entry.
     * Registrations are effects on the plugin's fiber, so unloading removes them.
     * @param ctx - Client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-cost: dictionaries')
      ctx.effect(() => {
        const existing = document.querySelector('style[data-plugin-css="dsh-session-cost-live/chip.css"]')
        if (existing !== null) return () => {}
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-session-cost-live'
        tag.dataset.pluginCss = 'dsh-session-cost-live/chip.css'
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'session-cost: styles')
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'cost',
        order: 2,
        locale: NS,
      }, CostChip))
      // The Plugins page gives this row a Configure entry keyed by the bundle
      // package plus the patch row id, and supplies the staged form and writer.
      ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: 'dsh-session-cost-live#session-cost',
        locale: NS,
      }, ConfigPage))
    }

    exports.apply = apply
    exports.inject = inject
    return exports
  },
})

