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
}

/** One trashed tree as reported to the UI. */
interface TrashEntry {
  id: string
  title: string
  deletedAt: number
  count: number
}
