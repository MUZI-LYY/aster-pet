# 功能索引

用途：从功能名称定位代码、约束和验证入口。日期：2026-09-14；这是当前源码盘点，存在代码和测试文件不等于已经重新执行测试或发布。

| 编号 | 功能 / 关键词 | 主要入口 | 边界 / 验证入口 |
|---|---|---|---|
| F01 | 来源聚合、软件/CLI 分类 | [all-readers](../core/all-readers.mjs)、[cli-provider](../core/cli-provider.mjs) | 来源独立失败；provider 是软件、source 是运行方式；[聚合测试](../tests/all-readers.test.mjs) |
| F02 | Codex 历史与实时状态 | [reader](../core/codex-reader.mjs)、[live](../core/codex-live.mjs) | 本地格式和 IPC 非稳定协议；断线回退记录；[读取测试](../tests/reader.test.mjs)、[实时测试](../tests/codex-live.test.mjs) |
| F03 | Claude / Cursor / Kiro 监听 | [Claude](../core/claude-reader.mjs)、[Cursor](../core/cursor-reader.mjs)、[Kiro](../core/kiro-reader.mjs) | 只支持已知格式；Cursor 当前生成标记或尚未被父记录吸收的最新 bubble 生命周期优先于上一轮残留的结束状态；Claude SDK 的 `sdk-cli` 单次调用和已完整读取且日志为空的 Kiro `New Session` 标签从任务列表排除；Kiro 恢复/查看会话追加的孤立工具记录不能启动新一轮；Cursor/Kiro 定位入口只对 ID 合法的本地任务开放；实机范围见 [专题说明](multi-provider-monitoring.md)；对应 reader 测试 |
| F04 | CLI 包装、心跳、退出码 | [包装入口](../scripts/aster-run.mjs)、[读取](../core/cli-reader.mjs) | 用户主动运行；观察进程而非对话轮次；[CLI 测试](../tests/cli-reader.test.mjs) |
| F05 | 状态、数量、提醒、已读 | [task-state](../core/task-state.mjs)、[monitor](../core/monitor.mjs) | 本轮完成不是项目完成；已读不修改来源；[提醒测试](../tests/status-alerts.test.mjs) |
| F06 | 主题、具体问题子标题、筛选 | [App](../src/App.tsx)、[用户文本](../core/user-request.mjs)、[样式](../src/styles.css) | 子标题仅使用可读取的用户文本；当前入口按来源/状态筛选，不把旧版搜索能力记为现状；读取测试覆盖轮次问题 |
| F07 | 累计/近期 Token | [统计与格式化](../core/token-usage.mjs)、[类型](../src/types.ts) | Codex 累计；Claude 消息去重且区分截断；缺失显示未提供；[Token 测试](../tests/token-usage.test.mjs) |
| F08 | 任务跳转、项目、终端 | [主进程](../electron/main.mjs)、[聚合](../core/all-readers.mjs)、[目标校验](../core/task-jump.mjs)、[Cursor 原窗口定位](../core/app-window-jump.mjs)、[Kiro 原窗口桥接](../core/kiro-window-bridge.mjs) | Codex 原生任务保留应用内深链；Cursor 仅在用户点击且 Aster 获得 macOS 辅助功能权限后定位现有 Agents 窗口中的唯一完整同名控件；Kiro 通过可选本地扩展按合法原生 ID 请求完整工作区路径唯一匹配的现有窗口。二者均不调用应用 URL/启动服务、不创建窗口，缺失或歧义时失败；[通用跳转测试](../tests/task-jump.test.mjs)、[Cursor 原窗口测试](../tests/app-window-jump.test.mjs)、[Kiro 桥接测试](../tests/kiro-window-bridge.test.mjs) |
| F09 | 3D 机器人、表情、动作、回退 | [Robot](../src/Robot.tsx)、[场景](../src/robot-scene.js)、[动作](../core/robot-motion.mjs)、[SVG](../src/RobotFallback.tsx) | 待命/工作轻快摆动与间歇招手，完成短暂欢呼；WebGL 不可用有回退；减少动作保持状态可辨；[动作测试](../tests/robot-motion.test.mjs) |
| F10 | 桌宠尺寸、拖动、位置记忆、设置保存 | [尺寸](../core/pet-scale.mjs)、[主进程](../electron/main.mjs)、[App](../src/App.tsx) | 75%–150%、步长 5%，任务面板保持独立尺寸；首次位于右上角，自动记住位置并适配显示器变更；[位置测试](../tests/pet-position.test.mjs)、[缩放测试](../tests/pet-scale.test.mjs) |
| F11 | 历史任务隐藏 | [可见性](../core/task-visibility.mjs)、[App](../src/App.tsx) | 12 小时/24 小时/3 天/7 天/30 天/始终；隐藏不是删除，进行中和待处理保留；[可见性测试](../tests/task-visibility.test.mjs) |
| F12 | 版本显示、构建、分发、隐私检查 | [打包](../scripts/package.mjs)、[检查](../scripts/check-privacy.mjs)、[开发服务](../vite.config.ts) | 设置页与应用包统一读取 `package.json` 版本；项目相对路径与运行时目录；包内包含项目规则和维护文档，开发源码链接在仓库查看；不分发个人信息；[检查测试](../tests/privacy.test.mjs) |

| F13 | 开机启动 / 系统登录项 | [登录项适配](../core/login-startup.mjs)、[主进程](../electron/main.mjs)、[App](../src/App.tsx) | 默认不注册，仅在用户切换时修改 Aster 自身登录项；以系统状态为准，开发版禁用；[登录项测试](../tests/login-startup.test.mjs) |

## 数据流与修改位置

来源记录 → 各 reader → `all-readers` → Worker → `monitor` 合并 Codex 实时证据和提醒 → 主进程 IPC → React 界面。

用户点击任务 → 主进程按任务 ID 查当前快照 → 校验目标 → 打开原会话/项目/终端。渲染层不得直接访问来源数据库或提供任意执行目标。

设置在主进程校验和持久化，界面接收设置变更；历史可见性在展示层应用。当前 `completedTaskRetentionMinutes` 名称沿用旧字段，但实际也用于非进行中的历史状态；维护时不要仅凭字段名缩小行为范围。

## 数据字段约定

- `id`：列表对象 ID；`nativeId`：来源原生 ID。包装进程与会话即使属于同一软件，也不是同一个对象。
- `provider`：软件；`source`：CLI/IDE/本地；`observation`：进程或会话。部分运行时扩展字段尚未全部列入 TypeScript `Task`，以聚合与消费代码核对，新增时应同步类型。
- `turnId`：当前轮次，可为空；不能把缺失轮次用于同轮完成通知。
- `subtitle`：最近问题文本摘要；缺失不补造。
- `tokenUsage.total`：非负整数；`scope` 为完整会话或近期记录。未知用空值，不填 0。
- `completedAt`、`updatedAt`：时间戳用于状态证据及隐藏；缺失时间不证明记录过期。

## 已知限制与非当前入口

- Cursor/Kiro 存在格式样例测试，不能据此宣称所有版本或真实安装都已验证；旧 Kiro CLI SQLite 未支持。
- 包装命令无法追溯已运行任意进程的退出码；不能据此读取模型 Token。未提供用量的来源在卡片明确显示缺失。
- Token 只表达来源记录的用量，包含缓存；不推导账单、订阅百分比或剩余额度。
- 早期 VRM 角色加载、模型导入存储及附带模型已清理；当前主入口为 Robot，WebGL 失败时仍保留 SVG 回退。
- 无云同步、语音对话或自动接管功能。扩展需按 [维护规范](maintenance.md) 定义边界。

修改本表中的行为时，同步新增 [变更记录](CHANGELOG.md)；编号保持稳定，不因改名重新分配。
