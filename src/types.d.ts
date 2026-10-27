/**
 * Shared domain model for both halves of the plugin.
 *
 * These are deliberately **global ambient** types rather than module exports.
 * The browser half is loaded as a plain script by the client module loader and
 * must contain no `import`/`export` statement (TypeScript would otherwise mark
 * the emitted file as a module and the loader would reject it), so it cannot
 * consume module-scoped types. Both tsconfigs include this file instead.
 */

/** Kanban columns, in board order. */
type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done'

/** Priority ladder, ascending urgency. */
type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

/** Lifecycle of one automatic agent run attached to a task. */
type TaskRunStatus = 'queued' | 'running' | 'done' | 'failed'

/** Which half of the staged workflow a run belongs to. */
type TaskRunKind = 'plan' | 'execute'

/** One automatic agent run: which session ran the task, and how it ended. */
interface TaskRun {
  /** Session the plugin created for this run, or null while queued. */
  sessionId: string | null
  status: TaskRunStatus
  startedAt: number
  endedAt: number | null
  /** Failure text, or the closing note; null while running or on success. */
  message: string | null
  /** 1 on the first launch; grows with each retry. */
  attempts: number
  /** Planning or execution; defaults to execution for rows written before stages. */
  kind?: TaskRunKind
}

/** Where a stage sits in the document-then-execute flow. */
type TaskStageStatus = 'draft' | 'awaiting-approval' | 'approved' | 'running' | 'done' | 'failed'

/** One stage of a task: a document to approve, then work to do inside its scope. */
interface TaskStage {
  /** 1-based ordinal, also the number in the document file name. */
  index: number
  title: string
  goal: string
  /** Workspace-relative POSIX path: docs/task-center/<taskId>/stage-<n>.md */
  docPath: string
  /** Files or directories the agent may touch; relative to the workspace or absolute. */
  scope: string[]
  /** Commands that must all exit 0 before the stage counts as done. */
  verify: string[]
  status: TaskStageStatus
  /** Failure text or the closing note. */
  message: string | null
  /** Tail of the verification output. */
  output: string | null
  startedAt: number | null
  endedAt: number | null
}

/** One normalized task row, exactly as it is stored on disk. */
interface TaskRecord {
  id: string
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority
  /** `YYYY-MM-DD`, or null when the task has no deadline. */
  due: string | null
  tags: string[]
  /** Registered DSH Workspace this task belongs to; null on legacy rows. */
  workspaceId: string | null
  /** Absolute directory of that workspace, kept so the UI still renders without the registry. */
  workspacePath: string | null
  /** Directory a run actually works in (the task's git worktree), when known. */
  workdir: string | null
  /** Permission preset for this task's runs; null means "follow the global setting". */
  permission: string | null
  /** Absolute working directory an automatic run starts in; null until set. */
  cwd: string | null
  /** Latest automatic run, or null when the task was never run. */
  run: TaskRun | null
  /** Ordered stages; empty on rows written before the staged workflow. */
  stages: TaskStage[]
  /** 0-based index of the current stage; equals `stages.length` once all are done. */
  stageIndex: number
  /** Ids of tasks that must reach `done` before this one may run. */
  blockedBy: string[]
  /** Answer this task's in-workspace approvals without asking the user. */
  autoApprove: boolean
  /** Parent task id; subtasks are exactly one level deep. */
  parentId: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
  deletedAt: number | null
  /** Id of the trashed root this row was deleted together with. */
  trashRoot: string | null
}

/** Fields accepted when creating a task; everything but the title is optional. */
interface TaskCreateInput {
  title: string
  notes?: string
  status?: TaskStatus
  priority?: TaskPriority
  due?: string | null
  tags?: string[]
  parentId?: string | null
  workspaceId?: string | null
  workspacePath?: string | null
  workdir?: string | null
  permission?: string | null
  cwd?: string | null
  blockedBy?: string[]
  autoApprove?: boolean
}

/** Fields accepted when updating a task; only what is present is applied. */
interface TaskUpdateInput {
  id: string
  title?: string
  notes?: string
  status?: TaskStatus
  priority?: TaskPriority
  due?: string | null
  tags?: string[]
  parentId?: string | null
  workspaceId?: string | null
  workspacePath?: string | null
  workdir?: string | null
  permission?: string | null
  cwd?: string | null
  blockedBy?: string[]
  autoApprove?: boolean
  /** Written by the runner only, never by a caller patching content. */
  run?: TaskRun | null
  /** Written by the planning flow only. */
  stages?: TaskStage[]
  /** Written by the stage advance logic only. */
  stageIndex?: number
}

/** One trashed tree as reported to the UI. */
interface TrashEntry {
  id: string
  title: string
  deletedAt: number
  count: number
}
