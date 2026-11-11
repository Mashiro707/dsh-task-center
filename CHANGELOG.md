# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.27.0] - 2026-11-11

### Added

- A stage keeps the document's numbered steps as data (`stages[].steps`) and the dialog lists them verbatim under the stage title. The planner writes them once; the document and the panel render the same array, so nothing is summarised, shortened or re-worded on the way to the screen.

## [1.27.0] - 2026-11-11

### Added

- Every stage document carries a **contract** section: the spec clause the field names, error codes and payloads must follow (`4.2.30 / 4.2.16，字段名以该节为准`). `task_stage_plan` requires it, so a plan that never read the spec cannot be written down.
- Approving a document now runs a quality gate first: no contract clause, a contract that names no numbers, or no steps all block the approval and leave the reason on the stage row.

### Why

A stage that only repeats the summary invents field names. The 4.4.0.x sections of the coupon spec are pointers ("见 4.2.30，保持原字段名"), so a document that does not name the clause cannot be checked against it.

## [1.26.1] - 2026-11-10

### Fixed

- Running a task whose cursor sits on a finished stage answered "当前阶段已经完成" and did nothing. The runner now walks forward to the first stage that still has work and starts from there, which also repairs boards left behind by the older cursor drift.

## [1.26.0] - 2026-11-10

### Fixed

- A stage reused the same conversation but its outcome was dropped: the settle guard remembered the session, not the attempt, so the second and later runs of one session never closed and the row stayed `running` forever.
- An outcome landed on the wrong stage. The runner followed the board cursor when a run ended, and the cursor can move while a run is still closing, so a finished stage could stay `running` and its successor could be skipped. Each run now records the stage it was opened for, and both the outcome and the advance use that number.

## [1.25.0] - 2026-11-10

### Fixed

- A stage left in `running` by a Host restart is repaired along with its run. Reconcile used to fix the run row only, so the card and the stage row kept saying "running" with nothing behind them; the stage is now marked failed with the same reason.
- Cancelling such a row clears it instead of answering `canceled: false`. The stop button reported that there was nothing to stop while the stage stayed busy forever.

## [1.24.0] - 2026-11-10

### Added

- A rejected (or failed) stage now carries its own **Run again** button in the stage row, so the loop stays inside the dialog: reject, read the reason, run it again without going back to the card. The button is disabled while that task is running.

## [1.23.0] - 2026-11-10

### Changed

- The fields of the task dialog use a two-column layout: status and schedule sit above dependencies on the left, and the content group takes the right column at full height, so the description box grows into the space instead of leaving half the dialog empty.

### Fixed

- The narrow-window rule now wins over the base grid. It was written before the base rule in the stylesheet, so a 640px window still drew two columns; the selectors are doubled (`.tc-fields.tc-fields`) so the order does not matter.
- On a narrow window the description box keeps the full width instead of shrinking to its text.

## [1.22.0] - 2026-11-10

### Fixed

- The task dialog no longer leaves a hole. The stage list used to live in the same grid as the three field groups and, being full width, forced the remaining groups onto the next row, so one narrow column stood alone beside several hundred pixels of empty space. The field groups now share a grid of their own, and the stage list and subtasks follow as full-width sections.
- The dialog adapts to the window: three columns around 1100px, two around 800px, one at 720px and below; the panel is `min(1180px, 94vw)` wide.

## [1.21.0] - 2026-11-10

### Added

- Stage documents are rendered as markdown instead of being dumped as raw text: headings, quotes, bullet and numbered lists, inline code, fenced blocks, tables, links, bold and italics, with the panel's own 12/13px scale and theme colours.
- The renderer emits React elements rather than an HTML string, so a document that contains markup stays inert.

## [1.20.0] - 2026-11-10

### Changed

- The task editor is a dialog now, not a drawer: it centres itself, takes `min(1040px, 92vw)` by `min(88vh, 880px)`, is portalled to the body so the board's scroll box cannot clip it, and folds into a single column under 720px. The stage list spans the full width, and the document preview grows with the window instead of being capped at 260px.

## [1.19.1] - 2026-11-10

### Changed

- The field that holds what the task is asking for is now labelled 任务说明 / Description instead of 备注 / Notes: it is the brief the agent reads, not a memo. The prompts and the tool errors use the same wording; the stored field is still `notes` so existing boards keep working.

## [1.19.0] - 2026-11-10

### Changed

- Runs are no longer killed after thirty minutes by default: `timeoutMinutes` is `0` (no limit), because some tasks legitimately run for hours. Set a number to bound one; `0` stays unbounded.
- A settings file written before this version (no `version` field) is read as unbounded even when it carries the old `30`, so an inherited default is not mistaken for a decision. The file gains `version: 2` on the next save.

## [1.18.0] - 2026-11-05

### Added

- A run that finishes or fails while the panel is open raises a desktop notification (once per run), and the window title shows `▶ N` while runs are in flight.
- A real-browser regression, opt-in with `DSH_LIVE_BROWSER=1 npm run test:browser`: it bundles the panel, serves it to the Edge that ships with Windows, and asserts the things jsdom cannot see — four equal-width columns, the 10px card radius, 12/13px type, the dropdown list portalled with `position: fixed`, and no horizontal overflow.

### Changed

- `playwright-core` and `esbuild` join the dev-only dependencies; the published plugin still has no runtime dependencies.

## [1.17.0] - 2026-11-05

### Added

- A real end-to-end test for the browser half: `test/browser.test.mjs` loads `client.js` into jsdom, mounts the panel with React, and drives it with clicks — four columns and every card render, a card opens the drawer with its stage list, and the run button posts to the `run` route.

### Changed

- `jsdom`, `react` and `react-dom` are dev-only dependencies; the published plugin still has no runtime dependencies.
## [1.16.0] - 2026-11-05

### Fixed

- Two changes that landed at the same time no longer overwrite each other: every mutation runs through one queue and holds a `tasks.json.lock` file, so the read-modify-write is serialised across this Host and any other process.
- A lock left behind by a crashed Host is broken after 15 seconds instead of wedging the board.
- `list()` reloads the file when another process replaced it, so two windows do not show a stale board.
## [1.15.0] - 2026-11-05

### Added

- Every run records the context tokens the Host estimates (`tokenMeter.measure(agent.session)`) and the card shows them as `1.2k tok`; a Host without a meter leaves `run.tokens` null instead of inventing a number.
- `settings` diagnostics now carry `measureKeys`, so the fields a Host actually returns stay visible while adapting to a different build.
## [1.14.0] - 2026-11-05

### Added

- `classifyFailure()` tells apart failures that will simply repeat (context overflow, cancelled, rejected, auth, bad request, missing resource, unsupported) from ones worth another attempt. Only the latter consume `retries`.

### Changed

- An agent error that cannot heal now settles the run with `（不再重试：<reason>）` appended to its message instead of silently retrying.
## [1.13.0] - 2026-11-03

### Added

- `run.sessionRuns` records how many runs share the task session, and a continuation prompt ends with a line saying which round it is.

### Changed

- A session now carries at most six runs. From the seventh the task opens a fresh conversation, so a long task starts from its stage documents and the code instead of an ever-growing history.
- Queuing a task no longer forgets its session: `sessionId`, `sessionRuns` and the run kind survive the `queued` row.
## [1.12.0] - 2026-11-02

### Added

- Every card now carries a conversation button: it opens the session the task is running in through the shell (`uiWorkspace.openSession`), and copies the session id when this window has no such service.
- A stage that starts waiting for approval marks the window title with the count and raises a desktop notification (once per stage) when permission is already granted; the panel re-reads the board every 20 seconds while it is open.
## [1.11.0] - 2026-11-02

### Added

- A task now cleans up its worktree: when the last stage is approved and verified, `git worktree remove --force`, `git branch -D` and `git worktree prune` run and `workdir` is cleared.
- A worktree with uncommitted changes is kept, never silently discarded; the task row keeps pointing at it.
- Permanently deleting a task removes its worktree and branch regardless of uncommitted work.
- New `releaseWorktree` route for cleaning up by hand (`force: true` drops uncommitted work too).
## [1.10.0] - 2026-11-02

### Added

- Stage documents are checked before they are trusted: a `verify` command whose `cd` target does not exist, a `cd X && ... X/...` self-contradiction, destructive commands (`sudo`, `rm -rf /`, `curl | sh`, fork bombs) are refused at approval time, and the stage stays `awaiting-approval` with the reason in its message.
- Uncommon commands are reported as warnings rather than errors, so a project with its own toolchain still works.
- New `checkStage` route and a 「检查文档」button in the drawer to preview errors and warnings without approving.
## [1.9.0] - 2026-10-28

### Changed

- A task now keeps one session across its stages: approving a stage, or a re-plan after a rejection, continues the same conversation instead of opening a new one. A session that is gone or busy is replaced.
- Parallel work belongs to subagents the agent starts itself, not to extra sessions.
## [1.8.0] - 2026-10-27

### Added

- Rejecting a document asks why. The reason is stored on the stage and handed
  to the planning agent, which otherwise only knew that the last document was
  refused and had to guess what was wrong with it.

## [1.7.3] - 2026-10-27

### Fixed

- Remote commands now run in a login shell. An ssh session starts a
  non-interactive shell that never reads `/etc/profile`, so a toolchain kept
  outside the default `PATH` — Go in `/usr/local/go/bin` — was missing from it
  while the same user had it after logging in. Every check that called such a
  tool failed with `<tool>: command not found` on the remote host.

## [1.7.2] - 2026-10-27

### Added

- `/task-center/api/settings` reports `version`, the build the running host
  actually loaded. After a restart the panel can prove it is serving the new
  code instead of looking identical to the old one.

## [1.7.1] - 2026-10-27

### Fixed

- Remote workspaces verify in the right directory again. The path a run works
  in is a local one, and it was handed to ssh unchanged, so the remote shell
  tried `cd C:\Users\...\work` and reported `No such file or directory` on
  every check. Paths under the mirror now map onto the path the host owns,
  which is also what lets a task create its worktree on that host.
- A failed stage now says why. The reason and the output of the command that
  failed are rendered under the stage in the drawer instead of only living in
  the stored task.

## [1.7.0] - 2026-10-27

### Added

- Every task now works in a Git worktree of its own (`<repo>/.worktrees/<task id>`
  on branch `task-center/<task id>`), created the first time it runs. Nothing
  edits the branch you have checked out any more; the worktree path is stored on
  the task and drives the gate, the verification and the stage documents.
- With several repositories in one workspace the stage's allowed paths decide
  which one the worktree belongs to.

## [1.6.1] - 2026-10-27

### Added

- A failed stage can be re-checked on its own. Verification is the step that
  fails when the environment, not the work, is wrong, and repeating the whole
  stage to find that out costs an agent run. The drawer offers **Re-check** on a
  failed stage: it re-runs the document's acceptance commands and advances the
  stage when they pass.

### Fixed

- The auto-run test waited for the session instead of the row, so it could read
  a null run on a slow runner (failed once on Node 24 CI).

## [1.6.0] - 2026-10-27

### Added

- Verification runs on the machine the workspace lives on. A remote workspace
  is a local mirror holding only what the panel wrote, so `test -f`, `grep -q`
  or `go test` against it could never say anything about the work. When the
  workspace directory carries a `dsh-workspace/remote` marker and its host is in
  the workspace vault, every verification command now runs there over `ssh`.
- Stage documents are written to the remote workspace as well as the mirror.

### Fixed

- A verification that could not start now says why and names the remote host
  instead of reporting a plain non-zero exit.

## [1.5.4] - 2026-10-26

### Fixed

- Verification commands now run in bash, not cmd.exe. Stage documents are
  written in POSIX shell (`test -f`, `grep -q`, `&&`), and on Windows the
  platform shell has none of those commands, so every stage that declared such
  a check failed for a reason unrelated to the work. When Git Bash is installed
  it runs the command; otherwise the platform shell is still used.
- A failed check now carries the last line of its own output on the card, so the
  reason is visible without opening the stage document.

## [1.5.3] - 2026-10-26

### Changed

- Every dropdown in the panel is drawn by the panel itself. A native `select`
  hands its popup to Windows, so the open list could never match the panel; the
  seven dropdowns (draft status, board-card status, tag filter, workspace
  picker, and the drawer's priority / workspace / permission fields) now share
  one control, one highlight and one keyboard model (Up/Down, Enter, Escape).
  The open list is portalled to the body with fixed coordinates, so neither the
  scrolling board nor the drawer can clip it.

### Fixed

- Choosing a status in the board list view now actually moves the task; the
  dropdown replaced the native select there too.

## [1.5.2] - 2026-10-26

### Fixed

- The seven `task_*` agent tools are registered again. `tools.register`
  validates `output.schema` against an enforced JSON-schema subset: `type: "json"`
  is an authoring shorthand, and union types such as `type: ["string", "null"]`
  are rejected outright. The first rejection aborted the registration loop, so
  no agent has seen `task_list` … `task_stage_report` since 1.0 — which is why
  a planning run could never write its stage document.
- Optional string parameters are now `type: "string"` with "empty string clears"
  in their description; the handlers still accept `null`.

### Added

- The fake host in the tests validates tool definitions the same way the real
  host does, and a test asserts that all seven tools register.

## [1.5.1] - 2026-10-21

### Fixed

- The panel no longer renders blank when two tasks share a due date and a
  priority: the sort comparator called `localeCompare` on an epoch number.

### Added

- A render crash is contained by an error boundary that shows the stack in the
  panel and files it on the board as a blocked `[client-error]` task, so a
  blank slot can never happen again without a trace.

## [1.5.0] - 2026-10-21

### Added

- Tasks now run in stages. The first run only writes a document, the stage then
  waits for an explicit approval click, and only then does a second run execute
  the document. Writes, deletes and commands outside the document's declared
  scope are refused, so "execute strictly per the document" is enforced rather
  than suggested.
- Stage documents are rendered from a fixed template and written to
  `docs/task-center/<task id>/stage-<n>.md` inside the task workspace.
- `task_stage_plan` and `task_stage_report` agent tools, plus `stageDoc`,
  `approveStage` and `rejectStage` API routes.
- Each stage carries its own verification commands; they run on a timeout and a
  failing exit code marks the stage failed instead of trusting the agent.
- The drawer lists the stages with approve and reject buttons, previews the
  document, and the card shows stage progress.

### Changed

- `run.kind` distinguishes a planning run from an executing run, and a task
  without stages is migrated to a single draft stage.

### Fixed

- Approving while the planning run is still open no longer leaves that run
  behind: the plan row closes and the execution starts.
- A run settles once even though the host delivers events to both the plain and
  the global listener.
- A retry starts with a fresh attempt counter instead of inheriting the failed
  attempt's.
- A task that carries only a workspace path now runs in that directory rather
  than the host's default one.
- An outcome that arrives between session creation and the run write is applied
  when the row lands instead of being dropped.

## [1.4.4] - 2026-10-21

### Fixed

- Every form control now shares one style. Dropdowns lost their native OS
  chrome but had no replacement affordance, so they read as flat boxes: they
  now carry a theme-drawn chevron, themed option rows, and a pointer cursor.
  Number fields drop the browser spinners, date fields follow the colour
  scheme, and textareas share the same border, radius and focus ring.

## [1.4.3] - 2026-10-21

### Fixed

- A task with auto-approve on no longer runs under `danger-full-access`. Live,
  such a task wrote outside its workspace and no approval was raised at all: the
  sandbox allowed it, so the gate had nothing to refuse and the workspace was
  not a boundary. The preset is now capped at `workspace-write` (logged in
  `settings.notes`), which turns leaving the workspace into an escalation the
  gate can answer with `rejected`.

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
