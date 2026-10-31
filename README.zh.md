# dsh-token-audit · DSH 账单审计

**你的 DSH token 到底花在哪了？先改哪一刀最省？**

这个工具读取本地的 DeepSeek Harness 会话日志，按 DeepSeek 官方峰谷价逐次调用计价，给出一份按金额排序的省钱方案。它是一次性审计，不是又一个常驻仪表盘：不用装插件、不用配置、不上传数据。

```bash
npx dsh-token-audit
```

合成数据的示例报告见 [docs/demo.html](docs/demo.html)，浏览器打开可看完整版式。

## 它回答三个问题

1. **钱花在哪**：缓存读、输出、缓存未命中各占多少；高峰时段占多少。
2. **哪几次会话最贵**：按会话排序，附调用次数与最大上下文。
3. **先改什么**：上下文上限、输出压缩、错峰、工具输出膨胀，各自能省多少钱。

## 为什么不用现成的面板

DSH 自带 token 计数和上下文压力，但不会告诉你「哪次调用最贵」「几点最贵」「改哪个参数」。现有 Usage & Billing 插件大多解决“显示”，这个工具解决“归因 + 决策”。

- **一次跑完**：月底或某周超支后跑一次。
- **按官方价算**：`deepseek-flash` / `deepseek-v4-pro`，峰谷两档，单位 CNY/百万 token。
- **只读本地**：日志不出机器，无网络请求。
- **可执行**：每个建议都带金额估算，先做最贵的那一项。

## 安装

```bash
# 免安装
npx dsh-token-audit

# 或全局安装
npm i -g dsh-token-audit
dsh-token-audit --days 7
```

需要 Node.js 20+。有 `zstdcat` 时用原生解压，否则使用内置的纯 JS 解码器（Windows 走纯 JS）。

## 作为 DSH 插件安装

npm 包同时是一个 DSH bundle，注册一个只读工具 `token_audit`：

```bash
dsh plugin --profile web add dsh-token-audit
```

然后对 Agent 说：*“审计我最近 30 天的 token 花费，告诉我先改什么。”* 工具返回同一份报告，数据不出本机。

## 用法

```bash
dsh-token-audit                              # 最近 30 天
dsh-token-audit --days 7                     # 最近 7 天
dsh-token-audit --since 2026-10-01 --until 2026-10-31   # 自然月（北京时间）
dsh-token-audit --all                        # 全部会话
dsh-token-audit --cwd Miner                  # 只看某个工作区
dsh-token-audit --session 4160cf07           # 钻取单个贵会话
dsh-token-audit --format markdown --out report.md
dsh-token-audit --format html --out report.html --open
dsh-token-audit --format json > audit.json
```

| 参数 | 含义 |
|---|---|
| `--sessions <dir>` | 会话根目录，默认 `$DSH_HOME/sessions` 或 `~/.dsh/sessions` |
| `--days <n>` | 只统计最近 N 天活跃的会话，默认 30 |
| `--since <date>` | 只统计该北京日期（含）之后的调用；隐含 `--all` |
| `--until <date>` | 只统计该北京日期（含）之前的调用；隐含 `--all` |
| `--all` | 不限时间 |
| `--cwd <text>` | 只统计工作目录包含该文本的会话 |
| `--session <id>` | 只统计 id 包含该文本的会话，用于钻取单个贵会话 |
| `--format <fmt>` | `terminal`（默认）/ `markdown` / `html` / `json` |
| `--out <file>` | 输出到文件，格式按扩展名推断 |
| `--open` | 用默认浏览器打开 HTML 报告 |
| `--redact` | 隐藏会话标题、路径、命令与文件名，可安全分享 |
| `--top <n>` | 终端里显示的会话条数，默认 8 |
| `--no-color` | 关闭 ANSI 颜色 |

## 验证改动（前后对比）

先存一份基线 JSON，只改一个变量，等一个可比的周期后再跑：

```bash
dsh-token-audit --format json > before.json
# ... 改压缩 / effort / 错峰，跑一周 ...
dsh-token-audit --format json > after.json
dsh-token-audit compare before.json after.json
```

对比以**每次调用成本**为主，而不是只看总花费：工作量少一半的“省钱周”不算赢。报告同时给出上下文、峰时占比、缓存/输出构成和结论。

## 生成 Lean 省流预设

审计告诉你问题长什么样，预设负责先落一刀：

```bash
dsh-token-audit preset --out ./dsh-lean-preset
dsh plugin --profile web add ./dsh-lean-preset
```

保留标准工具，只改四处：压缩触发 80% → 45%、保留尾部缩短、工具结果 4k 剪枝、加一段成本纪律 persona。可用 `--threshold 0.5 --retain 0.08 --prune 6144` 调。新会话选 **Lean**；已有会话保持原预设。

## 计价口径

每条 `assistant/message` 都带 provider 上报的用量：

- `cacheReadTokens`：命中提示缓存的输入（便宜）
- `inputTokens`：未命中的输入（贵）
- `outputTokens`：生成 token，含推理（最贵）

按该次调用的北京时间选峰/谷价，逐次累加：

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
|---|---:|---:|---:|
| `deepseek-flash` 闲时 | 0.02 | 1.00 | 4.00 |
| `deepseek-flash` 峰时 | 0.04 | 2.00 | 8.00 |
| `deepseek-v4-pro` 闲时 | 0.15 | 4.50 | 13.50 |
| `deepseek-v4-pro` 峰时 | 0.30 | 9.00 | 27.00 |

峰时 = 北京时间工作日 09:00–12:00、14:00–18:00，不含法定节假日。未知模型按 Flash 价估算并在报告中标注。

## 省钱估算是上限，不是承诺

`Savings plan` 假设行为不变。把上下文压到 250k 意味着更早压缩历史，模型可能丢细节、多跑几步。把每一行当上限，先在真实任务上验证。报告把“combined lean”标成重叠估算，也是这个原因。

在真实日志上最稳的四刀：

1. **上下文长度**：缓存读费用与每次调用的上下文成正比。250k 上限通常能省 15–25%。
2. **输出纪律**：`reasoningEffort: max` 时输出可占 35–40%。日常任务用 `high`。
3. **错峰**：闲时价格是峰时一半。批量任务放到 18:00 后或 09:00 前。
4. **工具输出**：`bash` 通常是上下文膨胀的最大来源。`tail`/`head`/静默参数/重定向到文件，都是免费的。

## 隐私

全部本地运行。只读 `~/.dsh/sessions/**`，在内存中计算，只写你指定的报告文件。无网络请求、无遥测、无上传。插件工具也是只读。

分享报告前加 `--redact`：会去掉会话标题、工作目录、bash 命令和文件名，所有金额与比例保留。

## 限制

- 这是**估算**，不是账单。订阅套餐、赠送额度、退款、渠道折扣在会话日志里看不到。
- 峰谷节假日硬编码了中国 2026 年；周末始终闲时。
- 第三方 provider 暂按 Flash 价估算。
- 会话日志需可读（`.jsonl` 或 `.jsonl.zstd`）。
- 上下文上限是取舍，工具不建模质量损失。

## 想直接落地？

审计免费。要把配置改完并验证效果——压缩阈值、剪枝参数、模型路由、错峰调度、前后对比——见 [docs/service.md](docs/service.md)。固定范围、固定价格、看到报告再付。

## 许可证

MIT。价格数据归 DeepSeek；本项目非官方。
