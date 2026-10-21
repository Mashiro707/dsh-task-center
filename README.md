# dsh-task-center

> 跑在 DeepSeek Harness 里的看板式任务中心：一块四列 Web 面板，加上一组让 agent 直接读写任务的工具。

*A kanban task center plugin for DeepSeek Harness — a Web panel plus agent tools.*

<img src="icon.svg" width="72" alt="dsh-task-center icon">

## 功能

- **四列看板**：待办 / 进行中 / 阻塞 / 已完成，另有清单视图按状态筛选
- **卡片**：左侧优先级色条、标签 chip、截止日期按「今天 / 已逾期 / 将来」分色
- **子任务**：一层嵌套，父任务进回收站时整棵树一起走
- **回收站**：软删除、按根任务恢复、彻底清除
- **交互**：搜索、详情抽屉右滑入、`focus-visible` 焦点环、空状态占位
- **归属工作区**：新建任务时选一个 DSH 工作区，这个任务拉起的 agent 就都在那个目录里工作，会话也挂在那个工作区下
- **自动开跑**：给了工作区后，点卡片上的 ▶ 让 DSH 里真起一个 agent 去做；也可以开全局自动开关
- **主题**：只用 `--dsw-alias-*` 设计令牌，明暗主题自动跟随，无字面色

## 环境要求

- DeepSeek Harness 桌面端（需要插件 / bundle 支持）
- 构建与测试需要 Node `^22.19.0 || >=24.0.0`

## 安装

仓库里 `index.js` 与 `client.js` 是已构建的产物，clone 下来即可直接使用，不需要先构建。

**方式 A（推荐，交给 agent）**

```bash
git clone https://github.com/Mashiro707/dsh-task-center.git
```

然后在 DSH 里对 agent 说：

> 用 plugin_manager 的 install_bundle，把 `<clone 下来的目录>` 装进当前 profile。

**方式 B（手动链接）**

在 profile 目录（`$DSH_HOME/profiles/<name>/`）里：

1. `package.json` 的 `dependencies` 加 `"dsh-task-center": "link:<包目录绝对路径>"`
2. `package.json` 的 `dsh.profile.bundles` 数组加 `"dsh-task-center"`
3. `cordis.yml` 里加一条行（包内 `cordis.patch.yml` 就是这段内容）：

   ```yaml
   - id: dsh-task-center
     name: 'dsh-task-center'
   ```

4. 在 profile 目录执行 `npm install` 建好链接

安装后重启 DSH 进程，侧边栏出现任务中心入口。浏览器半刷新页面即可生效，宿主半必须重启进程。

## 使用

面板：四列拖拽不支持的场景用状态选择器改列；卡片点开是详情抽屉；顶部搜索框按标题、备注、标签过滤。

### 任务、工作区与权限

每个任务属于一个 **DSH 工作区**（就是左侧会话列表里那种工作区，它有自己的目录）。任务跑起来时，插件用 `sessionController.create({ workspaceId })` 让宿主在该工作区里开会话，于是这个任务产生的所有 agent 都落在同一个目录下，会话也会出现在那个工作区里。

- **选工作区**：新建任务时工具栏的「新建到」下拉决定它归谁；详情抽屉里可以改。下拉里的「登记新目录」输入一个已存在的绝对路径，就会在 DSH 里建一个工作区并选中它。
- **权限**：详情抽屉的「权限」默认「跟随全局」，也就是用全局预设；选一个具体预设则**只影响这个任务拉起的 agent**，不改全局设置。
- **没有工作区的老任务**：仍然可以填 `cwd` 兜底；两者都没有时拒绝开跑并提示。

### 让任务自己跑

任务有了工作区（或老式的工作目录）后，卡片右上角就会浮出 ▶。点它，插件会起一个 DSH 会话，把任务简报作为一条用户消息投进去，任务同时进「进行中」；卡片上的徽章显示已跑时长，点它可停止。

- **全局自动开关**（工具栏那个圆点按钮）：打开后，任何进入「进行中」且能跑到目录的任务都会自动开跑；打开的那一刻，之前就停在「进行中」、还从没跑过的任务会立刻补上（已经跑过的不动，免得重复劳动）
- **排队**：并发满了不报错，任务进队列（卡片显示「排队中」胶囊，点它取消排队）；腾出位置时按先后顺序自动开跑
- **并发上限**：默认 2，工具条可改，硬上限 4
- **超时**：单次运行最多 N 分钟（默认 30，0 表示不限），到点先取消会话再记 `failed`
- **重试**：失败或超时后自动重跑，默认 0 次，最多 3 次；每次尝试累加 `run.attempts`
- **前置任务（依赖）**：抽屉里勾选前置任务，它们没 done 之前开不了跑（直接报 `blocked`）
- **依赖解锁**：自动开跑打开时，某个任务完成会把只差它一个的下游任务排上
- **收尾**：agent 空闲即视为做完，任务留「进行中」等你验收；agent 报错则记 `failed`，原因写进 `run.message`
- **中断恢复**：插件或宿主重启时，还在 `running` 的行会被标成「运行中断」；`queued` 的行在自动开跑关着时被取消，不会假装还在跑
- **权限回落**：任务没指定预设时用全局预设（默认 `auto`：逐次调用复核，最接近无人值守）；预设不存在时只记一条 warn，不阻断开跑
- **工作区内自动批准**：任务带工作区时默认打开（抽屉里可关）。插件把 `approval/request` 的监听器**注册在最前面**（`prepend`），只对**自己拉起的会话**生效；它把这次工具调用的参数从会话日志里读回来（`session/event` 的 `tool/call`），只要参数里出现的绝对路径都在该工作区目录内、且不含 `..` 与 `~`，就直接回 `allowed-once`。判断为越界时回 `rejected` 并把理由写进任务说明——因为本部署里还有别的审批作答器，转交（`next()`）会被它直接放行，等于没拦。判断不出结论（参数里没有可识别的路径）时才交回页面。
- **自查计数**：`settings` 里回 `autoSeen` / `autoApproved` / `autoBlocked` / `autoDelegated`。`autoSeen` 是「审批请求到底有没有走到本插件」——`autoApproved` 为 0 时，它能把「压根没触发审批」和「触发了但没走到我们」区分开。
- **注意**：工作区内的读写通常**根本不会触发审批**——沙箱在 `workspace-write` 下直接放行，`auto` 预设是 `danger-full-access` 也一样。所以这个开关实际管的是「越界升级」那一次询问：拦下它，任务就真的出不了工作区。为了让这条边界真的存在，开着自动批准的任务如果挑到 `danger-full-access` 一类的预设，会被**收窄到 `workspace-write`**（`settings.notes` 里会记一条 `preset auto 收窄到 workspace-write`）。

任务多了这些字段：`workspaceId` / `workspacePath`（归属工作区）、`permission`（任务级预设，空为跟随全局）、`cwd`（老式工作目录兜底）、`blockedBy`（前置任务 id）、`autoApprove`（工作区内自动批准）、`run`（`{sessionId, status: queued|running|done|failed, startedAt, endedAt, message, attempts, kind: plan|execute}`）与 `stages` / `stageIndex`（阶段列表与当前阶段）。`stages` 里每项是 `{index, title, goal, docPath, scope, verify, status, message, output, startedAt, endedAt}`，状态取 `draft` / `awaiting-approval` / `approved` / `running` / `done` / `failed`。

### 阶段：先写文档，批准后执行

每个任务由若干**阶段**组成，阶段必须**先有文档、经你点批准、才会执行**。这是硬拦截，不是提示词里的自觉。

- **规划**：点 ▶ 时，如果当前阶段还没有文档，插件起一个 `plan` 会话，只让它写文档（提示词明确禁止改代码），并要求它调 `task_stage_plan` 把这个阶段拆成 1–6 步，每步给出允许改动的路径和验收命令
- **文档落盘**：文档写在任务工作区的 `docs/task-center/<任务id>/stage-<n>.md`，内容由插件渲染成固定模板（标题 / 目标 / 允许改动 / 步骤 / 验收），所以格式永远一致
- **人工闸门**：文档写完，阶段停在「待批准」，卡片上出现「待批准」徽章。抽屉里能看阶段列表、预览文档全文，**批准**之后下一次开跑才会进入 `execute`
- **执行**：`execute` 会话的提示词里注入文档全文 + 允许改动 + 验收命令，并要求它按文档执行
- **硬边界**：执行期间的写、删、命令类工具调用，参数里的路径必须落在该阶段的允许改动里；`..`、`~`、`rm/del/rd/format/mkfs/shutdown/reboot` 这类命令直接**拒绝**，并让 agent 重新计划（`settings.autoBlocked` 递增）
- **验收**：会话空闲后插件按文档里的验收命令逐条跑（默认 120 秒超时）；退出码 0 才算这个阶段完成，然后进入下一阶段；非 0、超时、命令不存在都记 `failed`，输出截断后写进 `stage.output`
- **完成**：最后一个阶段 done，任务自动转 done
- **驳回**：点「驳回」把阶段退回 `draft` 并删掉旧文档，下一次开跑重新规划
- **老任务迁移**：没有阶段的旧任务会自动补一个「实现 <标题>」的 `draft` 阶段

### agent 工具

| 工具 | 作用 | 主要参数 |
| --- | --- | --- |
| `task_list` | 列出任务（子任务挂在父任务下）与回收站 | `status` / `tag` / `query` / `include_trash` |
| `task_workspaces` | 列出可选工作区（id、标题、目录） | — |
| `task_create` | 新建任务 | `title`（必填）/ `notes` / `status` / `priority` / `due` / `tags` / `parent_id` / `workspace_id` / `permission` / `blocked_by` |
| `task_update` | 只改传入的字段 | `id`（必填）+ 同上各字段，`due`、`parent_id`、`workspace_id`、`permission` 可传 `null` 清空，`blocked_by` 传空数组清空 |
| `task_delete` | 删除任务（默认进回收站） | `id`（必填）/ `permanent` |
| `task_stage_plan` | 用规划阶段拆出的步骤替换当前阶段 | `id`（必填）/ `stages`（`[{title, goal, scope, verify}]`，1–6 条）/ `summary` |
| `task_stage_report` | 把一句执行结论追加到任务说明 | `id`（必填）/ `summary` |

状态：`todo` `doing` `blocked` `done`；优先级：`low` `normal` `high` `urgent`。

### HTTP API

面板与宿主之间走 `POST /task-center/api/<action>`，JSON 请求体。路由只接受来自 loopback 且同源的请求。

| action | 作用 |
| --- | --- |
| `list` / `create` / `update` / `remove` / `delete`（`remove` 的别名）/ `restore` / `purge` / `emptyTrash` | 任务 CRUD 与回收站；`remove` / `delete` 传 `permanent: true` 时直接抹掉，不进回收站 |
| `run` / `cancelRun` | 起一个 agent（并发满则排队）/ 停止它或取消排队 |
| `queue` | 当前的排队情况 `{queued, running, concurrency}` |
| `workspaces` / `createWorkspace` | 列出可选工作区 / 把某个绝对路径登记成工作区 |
| `permissions` | 宿主提供的权限预设列表（`{options, defaultPreset, available}`） |
| `settings` / `saveSettings` | 读/写 `{autoRun, concurrency, preset, timeoutMinutes, retries}`，`settings` 另回 `available`（宿主有没有会话服务） |
| `stageDoc` / `approveStage` / `rejectStage` | 读某个阶段的文档 / 批准它 / 驳回并退回规划；后两个参数 `{id, ordinal}` |

设置存放在任务文件旁边的 `settings.json`，同样走原子写入。

## 数据

任务存放在 `$DSH_HOME/task-center/tasks.json`（默认 `~/.dsh/task-center/tasks.json`），单文件 JSON：

- 写入走「临时文件 + rename」，避免半个文件
- 读到损坏的 JSON 会先备份成 `tasks.json.corrupt-<时间戳>`，再重建空文档
- 删除是软删除（记 `deletedAt`），彻底清除才真正移除
- 阶段文档写在任务工作区的 `docs/task-center/<任务id>/stage-<n>.md`，是普通 Markdown 文件，可以直接用编辑器改（改完仍是「待批准」，重跑会按新内容执行）

## 开发

```bash
npm install
npm run build      # tsc 编译 src/*.ts → 包根的 index.js / client.js
npm run typecheck  # 只做类型检查
npm test           # build + node --test
```

```
src/index.ts            宿主半：Cordis 插件，JSON 存储 + HTTP 路由 + agent 工具
src/runner.ts           宿主半：把任务变成一次 agent 运行（会话、投递、收尾）
src/client.ts           浏览器半：React（无 JSX）面板
src/types.d.ts          两端共享的领域模型
src/host-globals.d.ts   仅宿主半可见的接口声明
src/client-globals.d.ts 仅浏览器半可见的 require / __ModuleLoader__ 接口
index.js, runner.js     构建产物，勿手改
client.js               同上
```

### 两条硬约束

1. **`src/client.ts` 里不能出现 `import` / `export`。**
   浏览器半是「脚本」而不是模块：加载器把这个文件当函数体执行，只交给工厂一个 `require`。一旦出现 import/export，TypeScript 会把产物标成模块，插件直接加载失败。所以共享类型写成 `src/types.d.ts` 里的全局声明，而不是 `import type`。

2. **样式只能通过带 `data-plugin` 的 `<style>` 标签注入。**
   `styles` 是「动态 Client half」才有的内置符号，静态安装的插件拿不到（模块表里没有这个 key，`require('styles')` 会抛 `missed the module table`）。模块系统按 `style[data-plugin]` 归属并在卸载时清理。

## 设计说明

- **产物入库**：`index.js` / `client.js` 一起提交，clone 即用。代价是改源码后要重新构建，好处是安装形态和设备上的构建链无关。
- **单文件 JSON 而非数据库**：任务量在几百条以内，单文件足够；原子 rename 换来的是零运维和可读的备份。
- **只依赖 `node:` 内置模块**：运行时不引第三方包，`typescript` 与 `@types/node` 只在开发期存在。
- **不 import `@deepseek-ai/*`**：从插件自己的真实路径解析这些包会失败（它们装在 profile 里）。所以起会话走 `ctx.get('sessionController')`，投递消息按 `{id, role:'user', content, source}` 手写等价结构，不依赖任何 DSH 包的运行时导出。
- **结束时看事件，不看返回值**：`followup()` 只是入队，真正的完成信号是 `agent/status` 从 `running` 翻走，或 `agent/error`。
- **工作区而不是裸目录**：`sessionController.create({ workspaceId })` 由宿主把目录、会话归属和工作区记录一起处理，插件不用自己拼 cwd；`cwd` 只作为没有工作区时的兼容兜底。
- **权限是任务级覆盖**：预设通过 `permissionPresets.set(session, name)` 落在会话上，所以「这个任务用这套权限」不会污染全局设置。

## 许可证

[Apache-2.0](LICENSE)
