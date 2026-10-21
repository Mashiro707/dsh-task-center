# 阶段化执行（stage workflow）

这份文档定义 dsh-task-center 的阶段式工作流：**先写文档，再执行，执行严格按文档**。

## 目标

一个任务可以分成若干阶段。每个阶段都必须先产出一份结构化文档，由人批准之后才允许执行；执行期间，智能体能动的范围被硬性限制在文档声明的清单里；阶段是否完成只看验收命令的退出码。

## 数据模型

任务记录新增两个字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `stages` | `TaskStage[]` | 阶段列表，顺序即执行顺序 |
| `stageIndex` | `number` | 当前阶段的 0 基下标；等于 `stages.length` 表示全部完成 |

```ts
interface TaskStage {
  index: number          // 1 基序号，用于文档命名
  title: string
  goal: string           // 这一阶段要达成什么
  docPath: string        // 相对工作区：docs/task-center/<taskId>/stage-<n>.md
  scope: string[]        // 允许改动的文件或目录，相对工作区或绝对路径
  verify: string[]       // 验收命令，逐条执行，全部退出码 0 才算通过
  status: 'draft' | 'awaiting-approval' | 'approved' | 'running' | 'done' | 'failed'
  message: string | null // 失败原因或阶段小结
  output: string | null  // 验收命令的输出尾巴
  startedAt: number | null
  endedAt: number | null
}
```

## 两条会话流

一次任务的运行分两种模式，都由 `run` 记录承载（`run.kind`）：

### 1. plan（规划）

触发条件：任务没有阶段，或当前阶段是 `draft`。

提示词要求智能体只做调研与拆分，输出 1–12 个阶段，每个阶段给出标题、目标、允许改动清单、验收命令、步骤，然后调用：

```
task_stage_plan({
  task_id,
  stages: [{ title, goal, scope: string[], verify: string[], steps: string[] }]
})
```

宿主收到后：

1. 校验结构（阶段数、必填字段、路径必须是工作区相对路径或工作区内的绝对路径）；
2. 把每个阶段渲染成文档写入 `docs/task-center/<taskId>/stage-<n>.md`；
3. 写回 `stages`，`stageIndex = 0`，阶段 1 置为 `awaiting-approval`，其余阶段保持 `draft`。

规划阶段的闸门只放行文档目录，写任何代码都会被拒绝。

### 2. execute（执行）

触发条件：当前阶段是 `approved`。

提示词注入该阶段文档全文、允许改动清单和验收命令，并要求完成后调用 `task_stage_report({ task_id, summary })`。

执行期间闸门按 `scope` 判定（见下）。阶段结束时：

1. 宿主在任务工作区逐条执行 `verify` 命令；
2. 全部退出码 0 → 阶段 `done`，`stageIndex + 1`；
3. 任一非 0、超时（默认 120s）或命令无法启动 → 阶段 `failed`，保留命令与输出尾巴；
4. 还有下一阶段 → 下一阶段转 `awaiting-approval`，等人工批准；没有下一阶段 → 任务 `done`。

## 闸门规则

`approval/request` 监听器按顺序判断，只有落在允许集合里的动作才自动放行：

允许集合 = 当前阶段 `scope` 里的每一项（文件精确匹配，目录按前缀匹配）+ 该阶段文档自身。

判定依据是工具调用的参数（`callId` → `tool/call` 的 arguments）：

| 情况 | 结果 |
|---|---|
| 参数里所有绝对路径都落在允许集合内 | 放行 |
| 出现允许集合之外的绝对路径 | 拒绝 |
| 出现 `..` 上跳或 `~` 家目录 | 拒绝 |
| 写类工具参数里找不到路径 | 交给用户 |
| 命令类工具参数里没有路径，也不含危险模式 | 放行（命令本身在任务工作区执行） |
| 命令里出现 `rm -rf /`、`del /s`、`format`、`mkfs` 等 | 拒绝 |

被拒绝的调用返回 `rejected`，智能体会收到失败结果并自行调整。同一阶段连续拒绝超过阈值（12 次）时阶段直接 `failed`，避免死循环。

## 人工闸门

- 文档只能由人批准：抽屉里点「批准」→ 阶段 `approved` 并立即开跑。
- 「驳回」会把阶段打回 `draft` 并记录意见，智能体下次重新规划。
- 没有批准动作，执行流不会被任何自动化触发。

## 迁移

没有 `stages` 的旧任务在加载时自动补一个 `draft` 阶段（标题即任务标题）。下一次开跑会先进入规划，产出文档后再等批准。

## 失败处理

| 场景 | 行为 |
|---|---|
| 规划会话结束却没提交阶段 | 阶段 `failed`，保留会话 id，可重试 |
| 文档目录不可写 | 阶段 `failed`，保留错误文本 |
| 验收命令不存在 / 超时 / 需要交互 | 阶段 `failed`，记录命令、退出码、截断输出 |
| 同阶段拒绝次数超限 | 阶段 `failed`，提示检查文档的允许清单 |
| 宿主不能启动子进程（受限沙箱） | 阶段 `failed`，提示该环境无法跑验收 |

## 不做的事

- 不改 DSH 宿主，不做跨任务编排、阶段并行、文档版本历史。
- 不解析自由文本生成范围：范围只来自 `task_stage_plan` 的结构化提交。
- 不自动批准文档。
