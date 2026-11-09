# dsh-session-cost-live

在 DeepSeek Harness 输入框底部、token 用量统计的右侧，实时显示**本次会话花了多少钱**（人民币 / 美元）。

token 数量交给自带统计，这个插件负责把它换算成钱。

## 功能

- **会话总费用，含子代理。** 芯片统计当前会话自身日志 + 它派生的所有子代理会话，委派较多的会话不会被低估。
- **内置两套官方价表，零配置可用。** 人民币价（账号实际扣费币种）与美元价（官网英文页）内置 `deepseek-flash`、`deepseek-v4-pro`，开箱即用；明细里可切换展示币种，选择会记住。
- **区分高峰 / 低峰。** 官方高峰时段（北京时间周一至周五 09:00–12:00、14:00–18:00）按高峰价，其余时段与周末按低峰价，分开统计。
- **严格对齐计费桶。** 未缓存输入、缓存读取、缓存写入、输出四者互不重叠，和厂商账单口径一致。
- **对未知模型诚实。** 模型没有配置费率时，总费用显示 `-`，明细只显示「未配置费率」，绝不套用别的模型价格。
- **界面里直接改价。** 侧边栏 Plugins → 本插件 → **Configure**，用表格编辑两套价目表：加模型、覆盖内置价、恢复默认；只保存你的覆盖项，保存后立即生效、不重启插件。
- **离线、只读。** 不联网、无遥测；Host 端只读取会话日志。

## 安装

```bash
dsh plugin --profile web add dsh-session-cost-live
```

把 `web` 换成你的 profile 名（例如 `desktop`），然后重启 `dsh web` 或刷新页面。插件面向 DSH Web profile，渲染在输入框底部的 dock 里、token 用量统计右侧。

从源码安装：

```bash
dsh plugin --profile web add git+https://github.com/hiyijian/dsh-session-cost-live.git
```

## 使用

- 输入框底部显示会话费用；点击打开明细：总费用、高峰时段与非高峰时段各自的「未缓存输入 / 缓存输入 / 输出」费用（为 0 的行不显示），并可切换人民币 / 美元。
- 没有计费用的会话不显示芯片。
- 配价：**Plugins → dsh-session-cost-live → Configure**。内置模型已列出并标注；直接改费率，或用「添加」填入 `provider/model`（或 `model`）和四个费率后保存。改过的内置行可「恢复默认」，自定义行可删除。

目前内置的是 DeepSeek 的价目。接其他厂商时在同一页面加一条，例如 `moonshotai-cn/kimi-k2.6`；如果该厂商全天同价，把「区分高峰/低峰时段」关掉。

高级用户也可以直接写 profile 的 `cordis.patch.yml`：

```yaml
- id: session-cost
  name: 'dsh-session-cost-live'
  config:
    currency: CNY
    peakPricing: false
    prices:      # 人民币，每百万 token
      'moonshotai-cn/kimi-k2.6': { input: 4, cacheRead: 0.4, cacheWrite: 4, output: 16 }
    pricesUsd:   # 美元，每百万 token
      'moonshotai-cn/kimi-k2.6': { input: 0.95, cacheRead: 0.16, cacheWrite: 0, output: 4 }
```

## 计费口径

- 用量来自已提交的会话日志（`assistant/message`，以及进行中的 `assistant/attempt` 样本和官方 `tokenUsage` 的重试替换规则），按最终消息的模型路由归属。
- 子会话日志在 `<DSH_HOME>/sessions` 下按会话 id 定位，用同一套逻辑折叠并按文件版本缓存，因此已结束的子代理会话也能计入。
- 金额在投影的客户端视图中按价表计算，改价无需迁移数据，会话会按新价重算。

核对工具的真实输出示例（某一天全部日志）：

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

`tools/reconcile-day.mjs` 用插件自己的折叠逻辑和价表重算本机全部会话日志，可拿去和 DeepSeek 官网用量页对照；只读日志，不调用任何厂商接口。

## 权限与隐私

- 只读 `$DSH_HOME/sessions` 下的会话日志（用于子会话计价与核对工具）。
- 注册一个 Host 会话投影、一个 dock 条目，以及本 bundle 的配置页。
- 只有你在配置页点保存时，才写入本插件自己的配置。
- 运行时不联网。

## 兼容性

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0-0`（在 `0.2.2-rc.1` 上测试）。
- Web profile；跨平台（Windows / macOS / Linux）。
- 依赖自带输入框（`conversation.composer.dock` 插槽）与会话投影注册表。

## 分类

Models & Reasoning（模型用量费用统计）。

## 开发

```bash
node --check index.js
node --check client.js
node test/host-fold.test.mjs
```

## 许可证

MIT © 2026 hiyijian
