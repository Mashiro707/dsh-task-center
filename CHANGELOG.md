# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
