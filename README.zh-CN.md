# weread

[English](https://github.com/PsychArch/weread#readme) · 简体中文

一个非官方、只读的微信读书命令行工具。你可以用它在终端中查看阅读数据，也可以把整理后的结果交给 AI Agent 分析。

`weread` 支持书城搜索、书架、阅读进度、阅读统计、笔记和公开点评。它为终端用户提供简洁文本，也为程序和 Agent 提供有 JSON Schema 的稳定接口。

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
weread stats detail --mode annually --date 2025
weread stats history
weread notes export 922224 --format markdown --output notes.md
weread discover recommend --limit 12
```

默认输出面向终端阅读。日期、时长、评分和进度会转换成较自然的形式，不必因为服务器返回了某个字段，就让它原封不动地出现在屏幕上。

## 机器可读接口

CLI 有三种明确的输出边界：

- 不加输出参数：面向终端用户的简洁文本；
- `--json`：带稳定 envelope 和 JSON Schema 的规范化数据；
- `--raw`：不封装的旧版兼容数据或上游原始形状数据，不承诺结构稳定。

`--agent` 作为 `--json` 的静默兼容别名继续保留；新的集成应使用
`--json`。

operation 发现完全离线，不需要凭据，也不会请求线上网关：

```bash
weread operations
weread --json operations
weread --json operation describe stats.trend
```

`operations` 返回一份小型目录。`operation describe` 返回单个、自包含的描述符，
其中包括命令调用方式、带类型的输入、分页契约、副作用与已知限制。完整 response
schema 位于 `data.output.responseSchema`；`data.output.dataSchemaRef` 指向其中的 data
payload 定义（`#/$defs/data`）。调用方可以在看到真实用户数据之前构造命令和 `jq`
路径。同一 build 的描述符可以按 operation ID 缓存复用。

稳定 JSON 的错误响应也带有同样的 schema 身份字段。无法解析到已注册 leaf 的 argv
使用目录中的 `invocation.error` 契约；已经确定 leaf 的参数错误继续使用该 leaf 的
response schema。两者都可以通过 `operation describe` 离线取得。成功响应写入 stdout；
带非零退出状态的结构化失败响应写入 stderr。

随后使用 `--json` 调用描述符中给出的命令：

```bash
weread --json stats trend | jq '.data.periods'
weread --json book inspect 922224 | jq '.data'
weread --json notes notebooks --limit 20 | jq '.data.page'
```

所有成功的稳定响应使用同一种外层结构：

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "schemaVersion": "3",
    "gatewaySkillVersion": "1.0.5",
    "complete": true,
    "timeZone": "Asia/Shanghai",
    "operationId": "stats.trend",
    "schemaId": "urn:weread:response:3:stats.trend"
  },
  "warnings": []
}
```

`meta.complete=true` 表示这次请求的命令已成功执行，不表示某个分页集合已经没有
下一页。分页集合结果把范围与续取方式放在 `data.page`；当 `hasMore` 为 true 时，
`nextArgv` 给出下一次稳定请求所需的完整参数，`nextArgs` 则只保留 cursor 参数。
分页 batch 结果会在每一项的 page 中提供这些字段，其中 `nextArgv` 包括对应的书和
筛选条件。完整 argv 还会固定当前实际使用的网关协议版本，因此即使第一次请求通过
环境变量选择版本，后续调用仍可直接执行。数据质量说明则继续独立放在 operation 数据与
`warnings` 中。

书内个人点评的抓取范围由 `reviewsExhausted` 单独表示：它说明该书的个人点评分页是否
已经取尽，不会改变 `meta.complete` 的含义。

稳定 projection 会保留已有依据的事实，统一重复出现的网关格式，并明确表达缺失值；
`compare` 这类上游字段会保留可识别的来源，不再扩展成由 CLI 选择的解释或比率。
CLI 不规定调用方如何解释这些数据，也不替 Agent 选择分析方法。

`stats history` 不需要猜测起始年份：省略边界时，它会覆盖从 2017 到当前上海时区年份
的受支持范围。overall 中第一个非零年份仍会作为活动事实返回，但不会因此删掉受支持的
零值年份。每个年度会另外返回 `periodComplete`、`throughDate` 和 `elapsedDays`，不会
把当前年度是否结束与 `meta.complete` 混为一谈。

`notes corpus --all-notebooks` 会遍历实时 notebook index，并按整本书的边界返回有界
分页（默认每页 10 本）。当 `data.page.hasMore=true` 时直接执行 `nextArgv`，直到它变为
false；其中的不透明 cursor 应原样传递。可以用 `--limit` 调整页大小，最大为 50。
重复传入的 `--book-id` 仍然是一次性精确选择，不受 `--limit` 截断（最多 50 个唯一 ID）。

### 从 v2 接口迁移

| 旧接口 | 当前接口 |
| --- | --- |
| `--json` 返回不封装的原始数据 | `--raw` |
| 稳定的 `--agent` response-schema v2 | `--json` 或其 `--agent` 别名，response-schema v3 |
| `capabilities` 与 `schema get` | `operations` 与 `operation describe` |
| `meta.complete` 表示抓取覆盖范围 | `meta.complete` 表示调用完成；operation 专用的 page 与 period 字段表示覆盖范围 |
| `notes sample` | 已移除；组合使用 `notes notebooks` 与 `notes corpus` |

## 原始网关访问

如果高级命令尚未覆盖某个接口，仍然可以调用原始网关：

```bash
weread --raw api call /store/search --param keyword=基因传 --param scope=10
```

原始响应可能很大。`api_name` 和 `skill_version` 等请求元数据由 CLI 管理，不能通过
`--param` 覆盖。通用网关有意只在 raw 模式下开放；任意上游 endpoint 没有稳定 schema，
因此 `--json api call` 会被拒绝。

## 这个项目在做什么角色

微信读书社区里已经有 SDK、数据面板、MCP 服务、笔记同步工具和阅读顾问 Skill。它们服务于不同的使用场景。`weread` 选择承担一个较窄的角色：在能够运行命令并读取输出的环境里，提供一个可组合的数据层。

如果应用需要嵌入式 SDK、图形界面或者直接的 MCP 接入，其他项目可能更合适。`weread` 面向希望使用命令行的人，也面向重视精简证据、完整性提示和确定性行为的 Agent。

## 可靠性与协议兼容

默认网关协议版本为 `1.0.5`，可以通过 `WEREAD_SKILL_VERSION` 或 `--skill-version` 覆盖。如果服务端提供同一主版本内的兼容升级，CLI 会协商一次，并在 `warnings` 中报告。

读取请求会重试临时网络错误、HTTP 429/5xx、网关限流、空成功响应和格式异常的响应。
只要诊断本身成功完成，`doctor` 就会以状态 0 退出，即使 `data.ready=false`；脚本可用
`weread --json doctor | jq -e '.data.ready'` 明确要求 readiness。

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
