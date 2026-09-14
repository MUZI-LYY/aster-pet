# 多工具任务监听

`core/all-readers.mjs` 的 `readAllSnapshot()` 聚合 Codex、Claude Code、Cursor、Kiro 与普通 CLI 任务。每个来源独立失败；`sources` 保留各来源的连接状态、错误和任务数。聚合默认最多 320 条，运行/等待任务优先保留。

**软件与运行方式分开分类**：`provider` 表示所属软件，`source` 表示 CLI / IDE / 本地会话。CLI 不是一种软件；界面分别展示“Codex · CLI”“Claude Code · CLI”“Cursor · CLI”“Kiro · CLI”。这些任务进入各自软件的筛选和计数。只有无法识别的软件或普通命令归为“其他 CLI”。

## 可用范围

| 来源 | 读取方式 | 状态证据 | 跳转 |
|---|---|---|---|
| Codex | 原有 SQLite / JSONL 适配器 | 沿用原适配器 | 由桌面集成层提供 |
| Claude Code | `CLAUDE_CONFIG_DIR` 或 `~/.claude` 下 `projects/*/*.jsonl`、`sessions/*.json` | JSONL `end_turn` 明确完成；进程身份核验后的 `busy` / `waiting` 为运行/等待。`idle` 本身不证明完成 | 活会话有 TTY 时定位 Terminal/iTerm 原标签；明确 IDE 项目可打开 VS Code 项目 |
| Cursor | `~/Library/Application Support/Cursor/User` 的 SQLite 与 `CURSOR_HOME` 或 `~/.cursor/projects/*/agent-transcripts` | 已知字符串状态或明确 stream-json 结束事件；未知数字枚举、普通文字回复不推断完成 | 已确认路径的 Cursor 项目 |
| Kiro | `KIRO_HOME` 或 `~/.kiro/sessions`、Kiro `globalStorage/kiro.kiroagent` | 新版会话事件；`turn_end.stopReason=end_turn` 明确完成。旧记录仅发现会话，缺乏结束证据保留未知 | 已确认且存在的 Kiro 项目 |
| 普通 CLI | Aster 包装启动后写入 `ASTER_TASK_HOME` 或 `~/.aster/tasks` | 活包装进程 + 心跳；实际退出码 0 完成，非零失败，信号中断；进程丢失保持待核实 | Terminal/iTerm 原标签 |

Cursor/Kiro 本地格式为非稳定内部格式，当前以对应公开格式的 fixtures 验证。本次本机实际读取验证包含 Claude Code；没有 Cursor/Kiro 安装，因此尚未做这两个应用的实机联调。Kiro 旧版 SQLite CLI 存储和未知扩展格式未支持，可通过 CLI 包装监听该命令进程的生命周期。

Claude Code 优先显示会话标题，没有标题时使用真实用户问题，并显示最新问题；本地斜杠命令、命令输出、系统元数据和工具结果不会进入标题。派生的目录名称不会覆盖问题标题。活会话的进程启动时间同时核验本地时间和 UTC 记录，避免时区差异导致终端入口丢失；PID 已失效或被复用时仍不建立跳转入口。

## 普通命令

以下示例在 Aster 项目根目录执行（需要 Node.js 24+）；命令以当前工作目录执行：

```sh
node ./scripts/aster-run.mjs --title "构建项目" -- npm run build
node ./scripts/aster-run.mjs -- kiro-cli chat
node ./scripts/aster-run.mjs --provider cursor -- agent
```

包装脚本按可执行命令名称识别 `codex`、`claude` / `claude-code`、`cursor` / `cursor-agent`、`kiro` / `kiro-cli`。有歧义的命令（如 `agent`），或经 `npx` 等间接启动时，可显式添加 `--provider codex|claude|cursor|kiro`。不读取或存储命令参数来猜测软件，不根据自定义任务名称分类。旧包装记录没有软件字段时保留为“其他 CLI”，不强制改写历史文件。

此方式保留终端的标准输入/输出，不捕获命令参数、提示词或输出。它监听**进程生命周期**：交互 CLI 一直打开时，包装任务仍为运行；其中各轮对话状态由对应来源适配器提供。已有的任意终端命令无法追溯退出码，需要下次通过包装命令启动。读取 Claude Code/Codex 的现有任务无需包装。

不会修改任何工具的 hooks、设置、认证数据或启动配置。Aster 自有 CLI 记录与各工具原始数据隔离。

## 独立运行与卸载约束

- 不修改、替换或强制覆盖其他软件的文件、配置、hooks、可执行入口。
- 不注入 Shell profile、PATH、alias、后台启动项，不把 Aster 设为其他工具的启动依赖。
- CLI 包装仅供用户单次自愿使用；原始 `claude`、`kiro-cli`、`cursor` 等命令始终可以直接运行，无需 Aster。
- 监控记录无法创建、写入失败或运行中被移除时，停止本次记录，原命令继续执行并保留其退出码。
- 删除 Aster 应用不删除或修改其他软件的任何数据。Aster 自有设置和任务记录可独立清理；本项目未添加卸载钩子或跨软件清理程序。
- 不把数据读取权限或自动化权限的拒绝变成对原软件的限制；仅关闭对应的监听/跳转能力。

## 桌面集成接口

任务保留现有字段，并新增 `provider`、`source`、`sourceLabel`、`nativeId`、`jumpTarget`。Codex 的列表 `id` 保持原值；其他来源带 provider 前缀。复制来源任务 ID 应使用 `nativeId`。

包装任务的 `id` 始终为 `cli:UUID`，`observation:'process'` 表示进程记录，即使其 `provider` 为 `codex` 也不能当作 Codex 会话 ID 跳转或订阅。原生会话为 `observation:'session'`。同一软件的包装进程与原生会话属于不同观察对象，不能仅凭软件名称或项目目录合并为同一个任务。

```js
import { readAllSnapshot } from '../core/all-readers.mjs';
import { describeTaskJump, openTaskTarget } from '../core/task-jump.mjs';
const snapshot = readAllSnapshot();
// 仅在用户点击时执行。IPC 接受 ID，必须从主进程当前快照中查找任务。
const task = snapshot.tasks.find(task => task.id === requestedId);
const action = describeTaskJump(task); // {available,label,detail}
const result = await openTaskTarget(task); // {ok,message}
```

跳转只打开已验证的应用项目或定位原终端，不自动恢复、重复执行任务。macOS 首次控制终端可能要求系统自动化权限；失败会返回可展示的错误。没有精确入口时明确显示“打开项目”或“暂无跳转入口”。终端定位脚本不读取终端内容，也不输入命令。

任务的 `turnId` 可能为空（例如 Cursor IDE 缺少可验证轮次标识），此时不要发送基于“同一轮状态转换”的完成通知。

## 格式参考

- [Claude Code agent view](https://code.claude.com/docs/en/agent-view)
- [Cursor 本地 IDE 存储](https://github.com/kenn-io/agentsview/issues/1515)
- [Kiro 新版会话布局](https://github.com/kenn-io/agentsview/issues/1499)
- [Kiro 格式说明](https://github.com/getagentseal/codeburn/blob/68ce480ec1f4e00c93777a9ca248349a4e6d3eea/docs/providers/kiro.md)
