# weread

[English](https://github.com/PsychArch/weread#readme) · 简体中文

一个非官方、只读的微信读书命令行工具。你可以用它在终端中查看阅读数据，也可以把整理后的结果交给 AI Agent 分析。

`weread` 支持书城搜索、书架、阅读进度、阅读统计、笔记和公开点评。它的 Agent 模式不会照搬网关的完整回包，而是提取与分析有关的信息，放进带版本号的稳定结构中。

本项目与腾讯及微信读书不存在隶属、赞助或官方合作关系。

## 为什么做这个项目

腾讯开源的 [WeChatReading](https://github.com/Tencent/WeChatReading) 项目是微信读书 Agent Gateway 的协议参考。接口参数、返回字段、分页规则和数据口径，都可以在其中的 Markdown 文档里找到。

这些文档很重要，本项目也以它们为基础。不过，适合阅读的文档不等于机器可直接验证的接口契约。开发者或者 Agent 真正调用网关时，仍然需要把文档中的规则落实成代码，分别处理各个接口的分页方式，并留意一些不太适合只看字段名来理解的细节。例如，阅读时长通常以秒为单位，而 `noteCount` 所代表的范围比它的名字看起来更窄。

这并不是官方项目做得不够，而是文档和工具承担的职责不同。官方仓库解释网关如何工作；`weread` 把这些说明变成可以直接执行的本地命令，并尽量让不同能力使用一致的方式返回结果。

普通用户可以因此更方便地查询数据。对 Agent 来说，价值还在于减少无关信息：当它分析几年的阅读变化或者一批笔记时，不必把大部分上下文花在接口传输细节上。如果结果只包含第一页，CLI 也应该明确说出来，而不是让 Agent 把局部数据当成完整书架。

## 它适合做什么

你可以用 `weread` 回答“我的书架里有什么”或者“这个月读了多久”这样直接的问题。它也能为更深入的分析准备证据，例如：

- 回顾过去几年的阅读习惯；
- 观察长期关注的主题和作者；
- 从划线与个人想法中寻找反复出现的观点；
- 结合已有阅读，寻找值得补充的书。

CLI 负责获取和整理证据，解释仍然交给使用它的人或 Agent。所有网关操作都是只读的，查看阅读历史不会顺手改变它。

## 快速开始

需要 Node.js 22.12 或更高版本。使用 pnpm 安装：

```bash
pnpm add --global @psycharch/weread
```

前往微信读书官方的 [Skills 页面](https://weread.qq.com/r/weread-skills) 获取 API Key，然后在当前进程中导出：

```bash
export WEREAD_API_KEY="wrk-..."
weread doctor
```

也可以把 Key 保存在本地配置中：

```bash
weread config set-key "wrk-..."
weread doctor
```

环境变量 `WEREAD_API_KEY` 的优先级高于本地配置。CLI 不会自动读取 `.env` 文件，不会打印完整 Key，本地配置文件也只允许当前用户访问。

确认 `doctor` 已经报告网关可用后，可以从这些命令开始：

```bash
weread search "基因传" --scope book --limit 5
weread shelf summary
weread stats detail --mode annually --date 2025 --view summary
weread notes export 922224 --format markdown --output notes.md
weread discover recommend --limit 12
```

默认输出面向终端阅读。日期、时长、评分和进度会转换成较自然的形式，不必因为服务器返回了某个字段，就让它原封不动地出现在屏幕上。

## Agent 模式

在命令前加上 `--agent`，可以得到精简、规范化的 JSON：

```bash
weread --agent stats trend
weread --agent book inspect 922224
weread --agent book resolve-batch --name "为什么" --name "这才是心理学"
weread --agent shelf list --all
weread --agent notes sample
weread --agent notes corpus --book-id 922224 --book-id 3300045871
weread --agent reviews batch --book-id 922224 --type recommend,latest --limit 3
```

Agent 模式不只是把终端颜色去掉。它会提取分析所需的字段，统一部分不便使用的值，并为常见任务组合多个请求。成功响应使用同一种外层结构：

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "schemaVersion": "2",
    "gatewaySkillVersion": "1.0.5",
    "complete": true,
    "timeZone": "Asia/Shanghai",
    "operationId": "stats.trend",
    "schemaId": "urn:weread:agent:2:stats.trend"
  },
  "warnings": []
}
```

Agent 在开始分析之前，应该检查 `ok`、`meta.complete` 和 `warnings`。请求成功并不总是代表结果毫无缺口，其中可能仍然包含分页限制或者数据质量提示。

CLI 会提供严格的 operation manifest，并内置各命令的 Draft 2020-12 response
schema。Agent 可以先读取单个 operation，再写 `jq` 路径，无需先请求真实数据来猜字段：

```bash
weread capabilities --operation stats.trend --json
weread schema get stats.trend --data
```

manifest v2 会给出 `executable`、传给它的 Agent `command.argv`、包含必填项和重复参数的
input contract，以及 `output.dataSchemaCommand` 和 `output.schemaCommand`。调用方不必猜
manifest 字段，也不必再用面向人的 `--help` 补参数信息。只有 operation ID 尚不明确时，
才需要读取完整的 `weread capabilities --json` 列表。

manifest 自身的契约可通过 `weread schema get capabilities` 获取。schema 默认紧凑输出；
供人查看时可以加 `--pretty`。`schemaVersion` 只是兼容性标签，`meta.schemaId` 指向的
才是真正的 response contract；只有验证器需要完整成功/失败 envelope 时才省略
`--data`。

### 阅读趋势

```bash
weread --agent stats trend
weread --agent stats history --from 2020 --to 2025
weread --agent stats detail --mode annually --date 2025
```

`stats trend` 会整理多个周期的数据，方便 Agent 做比较。统计结果还带有 `fieldGuide`，其中说明了单位和比较口径，避免仅凭字段名推测含义。

`stats history` 的每个完整年度还会提供有 schema 的 `historyAnalysis`：日历年度阅读日覆盖率、每阅读日累计时长，以及相对上一个返回年度的总时长变化。累计时长的口径明确是“阅读日合计”，不是单次会话长度。

### 笔记与个人想法

可以先取得确定性的个人想法样本，再把其中去重后的 book ID 交给语料命令：

```bash
weread --agent notes sample
weread --agent notes corpus --view thoughts --book-id 922224 --book-id 3300045871
```

`notes sample` 会抓取完整笔记本索引，并在 CLI 内执行唯一、稳定的 50 本抽样规则，
避免不同 Agent 各自实现出略有差异的样本。精简语料会区分书中原文和读者自己的话。

### 推荐与验证

个性化发现可以先提供一批候选：

```bash
weread --agent discover recommend --limit 12
weread --agent book resolve-batch --name "为什么" --name "这才是心理学"
```

准备给出最终书单之前，可以批量检查这些书：

```bash
weread --agent book inspect-batch --book-id 922224 --book-id 3300045871
```

检查结果包括章节访问状态、书架状态、阅读进度和笔记情况。只有
`accessLevel=all-chapters` 才表示返回的全部章节均已确认可读；`some-chapters`
只证明部分章节可读，`unconfirmed` 不能描述成整本可读。最终推荐仍然由 Agent
完成，这样才能结合读者的目标和已有知识，而不是把网关返回的候选直接当成答案。

## 输出方式与数据边界

不使用结构化输出参数时，`weread` 会打印简洁的终端文本。`--json` 保留线上网关的原始结构，适合兼容脚本或排查问题；`--agent` 则使用前面介绍的精简契约。原始响应一直都在，只是不必每次都请它全员出席。

Agent 模式中的书籍评分使用 0–10，点评评分使用 0–5，时间戳转换为 ISO 字符串，阅读时长仍以秒为单位。统计结果会附带字段说明。需要特别注意的是，`dayAverageReadTime` 按自然日计算，而不是只统计发生过阅读的日期；`compare` 表示这个自然日日均值相对上一周期的变化比例，`0.2` 代表增长 20%。上游没有报告阅读进度时，进度会返回 `null`，而不是虚构成 0。

`notes notebooks --all` 会继续请求全部游标页。如果只取得有限结果，而且后面仍有数据，`meta.complete` 会设为 `false`。一次笔记语料请求最多接受 50 个 book ID。书签位置会计入微信读书的笔记统计，但目前不能作为笔记内容导出。在精简结果中，`thoughts[].content` 是读者自己的文字，`quotedText` 和 `contextText` 来自书籍；只分析读者观点时可用 `--view thoughts` 省略独立的书中划线。语料中的 `source*` totals 描述抓取到的源材料，`returned*` totals 描述当前 view 实际序列化返回的数组。

面向 Agent 的公开点评会限制单条内容长度，并在发生截断时给出说明。只有网关实际返回 `deepLink` 时，CLI 才会展示链接，不会自行拼接 `weread://` 地址。

## 原始网关访问

如果高级命令尚未覆盖某个接口，仍然可以调用原始网关：

```bash
weread --json api call /store/search --param keyword=基因传 --param scope=10
```

原始响应可能很大。`api_name` 和 `skill_version` 等请求元数据由 CLI 管理，不能通过 `--param` 覆盖。

## 这个项目在做什么角色

微信读书社区里已经有 SDK、数据面板、MCP 服务、笔记同步工具和阅读顾问 Skill。它们服务于不同的使用场景。`weread` 选择承担一个较窄的角色：在能够运行命令并读取输出的环境里，提供一个可组合的数据层。

如果应用需要嵌入式 SDK、图形界面或者直接的 MCP 接入，其他项目可能更合适。`weread` 面向希望使用命令行的人，也面向重视精简证据、完整性提示和确定性行为的 Agent。

## 可靠性与协议兼容

默认网关协议版本为 `1.0.5`，可以通过 `WEREAD_SKILL_VERSION` 或 `--skill-version` 覆盖。如果服务端提供同一主版本内的兼容升级，CLI 会协商一次，并在 `warnings` 中报告。

读取请求会重试临时网络错误、HTTP 429/5xx、网关限流、空成功响应和格式异常的响应。只有凭据存在且网关可以访问时，`doctor` 才会以成功状态退出；结构化输出还会报告 `data.ready`。

协议语义会与腾讯的 [WeChatReading](https://github.com/Tencent/WeChatReading) 仓库交叉核对。线上 Agent Gateway 仍然是实际请求和响应行为的最终依据。如果观察到的行为与文字文档不同，CLI 会遵循线上响应，并通过验证覆盖这一行为。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm run verify
```

`verify` 会执行类型检查、构建和测试，生成 npm 产物，并检查其中是否混入了意外文件、本地路径或疑似 API Key。发布流程见 [RELEASING.md](RELEASING.md)，安全问题的报告方式见 [SECURITY.md](SECURITY.md)。

维护者可以通过已导出的 Key 或 CLI 本地配置运行有界、只读的线上测试：

```bash
pnpm run test:live
```

## 许可证

腾讯的 WeChatReading 项目 Copyright © 2026 Tencent，采用 [Apache-2.0](https://github.com/Tencent/WeChatReading/blob/main/LICENSE) 许可证。本项目独立采用 MIT 许可证。文中提及微信读书、WeRead、WeChat 和 Tencent，仅用于说明服务兼容关系，不代表腾讯或微信读书对本项目的认可或赞助。

MIT © PsychArch
