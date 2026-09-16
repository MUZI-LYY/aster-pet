# 多工具任务监听

`core/all-readers.mjs` 的 `readAllSnapshot()` 聚合 Codex、Claude Code、Cursor、Kiro 与普通 CLI 任务。每个来源独立失败；`sources` 保留各来源的连接状态、错误和任务数。聚合默认最多 320 条，运行/等待任务优先保留。

**软件与运行方式分开分类**：`provider` 表示所属软件，`source` 表示 CLI / IDE / 本地会话。CLI 不是一种软件；界面分别展示“Codex · CLI”“Claude Code · CLI”“Cursor · CLI”“Kiro · CLI”。这些任务进入各自软件的筛选和计数。只有无法识别的软件或普通命令归为“其他 CLI”。

## 可用范围

| 来源 | 读取方式 | 状态证据 | 跳转 |
|---|---|---|---|
| Codex | 原有 SQLite / JSONL 适配器 | 沿用原适配器 | 由桌面集成层提供 |
| Claude Code | `CLAUDE_CONFIG_DIR` 或 `~/.claude` 下 `projects/*/*.jsonl`、`sessions/*.json` | JSONL `end_turn` 明确完成；进程身份核验后的 `busy` / `waiting` 为运行/等待。`idle` 本身不证明完成 | 活会话有 TTY 时定位 Terminal/iTerm 原标签；明确 IDE 项目可打开 VS Code 项目 |
| Cursor | `~/Library/Application Support/Cursor/User` 的 SQLite 与 `CURSOR_HOME` 或 `~/.cursor/projects/*/agent-transcripts` | 已知字符串状态、当前生成标记、最新 bubble 与父记录的生命周期进度或明确 stream-json 结束事件；未被父记录吸收的续聊活动优先于上一轮残留状态；未知数字枚举、普通文字回复不推断完成 | 辅助功能在现有 Agents 窗口中选择唯一完整同名任务；CLI 记录不跳 GUI |
| Kiro | `KIRO_HOME` 或 `~/.kiro/sessions`、Kiro `globalStorage/kiro.kiroagent` | 新版会话事件；`turn_end.stopReason=end_turn` 明确完成。旧记录仅发现会话，缺乏结束证据保留未知；仅完整读取且日志为空的 `New Session` 标签被过滤 | 可选本地桥接在完整工作区路径唯一匹配的现有窗口中按原生 ID 选择会话 |
| 普通 CLI | Aster 包装启动后写入 `ASTER_TASK_HOME` 或 `~/.aster/tasks` | 活包装进程 + 心跳；实际退出码 0 完成，非零失败，信号中断；进程丢失保持待核实 | Terminal/iTerm 原标签 |

Cursor/Kiro 本地格式与任务入口都不是稳定公共接口，当前以对应 fixtures 和桌面实机行为验证，版本不兼容时明确报错。Cursor 的固定辅助功能脚本先确认目标进程已运行并将其置前，再在已有 `Cursor Agents` 窗口查询唯一完整同名按钮；它不会通过 Launch Services 启动软件。Kiro 的嵌套 WebView 不稳定暴露会话标签，因此可选桥接由每个现有 Kiro 窗口在回环地址发布短期发现记录，Aster 按当前快照中的合法原生 ID 和工作区选择唯一窗口，并用随机令牌请求固定的会话切换与查看命令。没有唯一现有窗口、桥接未加载或请求失败时直接失败，不回退到 URL、项目打开或软件启动。桥接不读取对话内容、不发送提示、不创建任务、不修改 Kiro 设置；Aster 未运行或移除后没有请求，Kiro 正常独立工作。Kiro 旧版 SQLite CLI 存储和未知扩展格式未支持，可通过 CLI 包装监听该命令进程的生命周期。

Claude Code 优先显示会话标题，没有标题时使用真实用户问题，并显示最新问题；本地斜杠命令、命令输出、系统元数据和工具结果不会进入标题。派生的目录名称不会覆盖问题标题。活会话的进程启动时间同时核验本地时间和 UTC 记录，避免时区差异导致终端入口丢失；PID 已失效或被复用时仍不建立跳转入口。

Kiro 通常读取日志末尾 192 KiB；若片段中缺少用户或结束事件，则在整轮 12 MiB 读取预算内补读最多 2 MiB 的尾部来查找轮次边界。仍找不到时保留为状态未知，不凭工具活动猜测运行，也不把截断、不可读或未写完整的日志判为空白标签。Cursor 标题必须与按钮完整名称相等，重复标题或额外装饰无法确认时不点击；Kiro 有工作区路径时只接受唯一完整路径匹配，不回退到目录名。

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

跳转只调用经过校验的原任务查看入口、打开已验证的应用项目或定位原终端，不自动恢复、重复执行任务。Cursor 定位需要 macOS 辅助功能权限；Kiro 精确定位需要可选桥接已在原窗口加载。缺少权限、桥接、应用、现有目标或唯一窗口时返回错误，不回退到 URL 或软件启动。终端定位脚本不读取终端内容，也不输入命令。

任务的 `turnId` 可能为空（例如 Cursor IDE 缺少可验证轮次标识），此时不要发送基于“同一轮状态转换”的完成通知。

## 格式参考

- [Claude Code agent view](https://code.claude.com/docs/en/agent-view)
- [Cursor 本地 IDE 存储](https://github.com/kenn-io/agentsview/issues/1515)
- [Kiro 新版会话布局](https://github.com/kenn-io/agentsview/issues/1499)
- [Kiro 格式说明](https://github.com/getagentseal/codeburn/blob/68ce480ec1f4e00c93777a9ca248349a4e6d3eea/docs/providers/kiro.md)
