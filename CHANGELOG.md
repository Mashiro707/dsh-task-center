# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2] - 2026-10-20

### Changed

- The approval gate now registers itself ahead of the other listeners
  (`prepend`). Live, a plain subscription never received the request: another
  answerer in the deployment answered it first.
- An approval that provably leaves the task's workspace is now answered with
  `rejected` instead of being handed on. Handing it on is not a neutral act in
  this deployment — the next answerer allows the call without a human seeing
  it, so "stay inside the workspace" would not hold. Calls whose arguments
  cannot be classified still go back to the page.

### Added

- `autoBlocked` in the settings response, counting the out-of-workspace
  approvals the gate refused.

## [1.4.1] - 2026-10-20

### Fixed

- A cancel that lands while the attempt's session is still being created is no
  longer lost. The task is flagged and the session is stopped as soon as it
  exists, instead of running the prompt the user already cancelled.

### Added

- `autoSeen` in the settings response: how many approval requests reached the
  gate at all. Without it, `autoApproved: 0` cannot be told apart from the gate
  never being consulted.

## [1.4.0] - 2026-10-20

### Added

- In-workspace auto-approval (`autoApprove`, on by default when the task has a
  workspace). The plugin listens on the host's `approval/request` waterfall and
  answers `allowed-once` only for sessions it started itself, and only when
  every absolute path in the tool call resolves inside that task's workspace and
  the call contains no `..` or `~`. Anything else falls through to `next()`, so
  the page still asks you. The sandbox mode keeps applying either way.
- An auto-approval switch in the drawer, and `auto_approve` on `task_create` /
  `task_update`.
- The `settings` action also reports `autoApproved` / `autoDelegated`, the
  number of approvals this host has answered or handed back since it started.

### Fixed

- Turning auto-run on now sweeps the tasks that were already waiting in
  `doing`, instead of only reacting to later changes. Tasks that already ran
  once are left alone so nothing starts twice.

## [1.3.0] - 2026-10-20

### Added

- A run that finds every slot taken now waits in a queue instead of failing.
  Queued runs show a pill on the card, can be cancelled, and start by themselves
  as soon as a slot frees up. `run.status` gained `queued`, and the new `queue`
  action reports `{queued, running, concurrency}`.
- Wall-clock timeout per attempt (`timeoutMinutes`, default 30, 0 disables it):
  the session is cancelled and the run is marked failed.
- Automatic retries (`retries`, default 0, at most 3) after a failure or a
  timeout; `run.attempts` counts the attempts made.
- Task dependencies: `blockedBy` lists the tasks that must be `done` first. A
  blocked task refuses to start, blocks are shown in the drawer, and when
  auto-run is on, finishing a task queues its dependents automatically.
- `blocked_by` on `task_create` / `task_update`; timeout and retry inputs in the
  toolbar; a dependencies group in the drawer.

### Changed

- `reconcile` also cancels queued rows when auto-run is off, and returns
  `{repaired, requeued}`.

## [1.2.0] - 2026-10-20

### Added

- Tasks belong to a DSH workspace. Creating or editing a task picks a workspace;
  runs open their session with `sessionController.create({ workspaceId })`, so
  every agent a task starts works in that workspace's directory and the session
  shows up under it.
- "Register a directory" in the drawer turns any existing absolute path into a
  workspace without leaving the panel.
- Per-task permission preset: the drawer's permission field overrides the global
  preset for that task's runs only, and defaults to following the global one.
- A workspace chip on cards and list rows, and a "new task in" picker in the
  toolbar.
- `task_workspaces` agent tool; `workspace_id` and `permission` on `task_create`
  and `task_update`.
- Route actions: `workspaces`, `createWorkspace`, `permissions`.
- `workspaceId`, `workspacePath` and `permission` fields on every task.

### Changed

- Starting a task with neither a workspace nor a directory now fails with
  `workspace-missing` before any session is created (was `cwd-missing`).

## [1.1.0] - 2026-10-20

### Added

- Tasks can start an agent. A task with a working directory gets a ▶ on its card;
  pressing it opens a DSH session in that directory, admits the task brief as one
  user message, and moves the task to "doing".
- A global auto-run switch (persisted in `settings.json`), a concurrency cap
  (default 2, hard limit 4), and a permission preset (default `auto`).
- Live run badge on cards with elapsed time, click to stop.
- `cwd` and `run` fields on every task; runs interrupted by a restart are marked
  "运行中断" on load instead of pretending to still be running.
- Route actions: `run`, `cancelRun`, `settings`, `saveSettings`.

### Fixed

- Deleting a task from the panel called `/delete`, which the host never routed
  (it only knew `remove`), so the button always failed. Both spellings work now.

## [1.0.0] - 2026-10-20

### Added

- Four-column kanban panel (todo / doing / blocked / done) with a list view.
- Task cards with a priority color bar, tag chips, and due dates colored by
  "today", "overdue", and "upcoming".
- One level of subtasks; deleting a parent moves the whole tree to the recycle bin.
- Recycle bin with restore and permanent purge.
- Search across title, notes, and tags, plus a right-sliding detail drawer.
- Agent tools: `task_list`, `task_create`, `task_update`, `task_delete`.
- Host side: single-file JSON store with atomic writes and corrupt-file backup,
  a loopback-only HTTP route, and locale support (zh / en).

### Changed

- Sources moved to TypeScript (`src/*.ts`), compiled back to the package root so
  the installed layout is unchanged.
- Panel styling rewritten against `--dsw-alias-*` design tokens only, with a
  12/13px type scale and no literal colors.
- Styles are injected as a `data-plugin` style tag instead of the dynamic-only
  `styles` builtin.

[1.1.0]: https://github.com/Mashiro707/dsh-task-center/releases/tag/v1.1.0
[1.0.0]: https://github.com/Mashiro707/dsh-task-center/releases/tag/v1.0.0
