/**
 * Automatic agent runs.
 *
 * One run is: create a real DSH session in the task's working directory, install
 * the permission preset, admit one user message that carries the task, and wait
 * for the agent to go idle. Everything happens through services the Host already
 * composes — this module never imports a `@deepseek-ai/*` package, because the
 * plugin is loaded from its own path and those specifiers only resolve from the
 * profile root.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { resolveRemote, runRemoteCommand, shellQuote } from './remote.js';
import { currentStage, readStageDoc, stageAbsPath } from './stages.js';
import { DEFAULT_VERIFY_TIMEOUT_MS, runCommand, runVerifyCommands } from './verify.js';
import { pickRepo, worktreeBranch, worktreePath } from './worktree.js';
/** How many runs may be alive at once when the caller asks for no particular cap. */
const MAX_CONCURRENCY = 4;
/** Preset that reviews each call before it runs; the closest thing to unattended. */
const DEFAULT_PRESET = 'auto';
/** Retries the panel may ask for, on top of the first attempt. */
const MAX_RETRIES = 3;
/** Wall-clock limit for one attempt, in minutes, when nobody configured one. */
const DEFAULT_TIMEOUT_MINUTES = 30;
/** Upper bound the timeout setting is clamped to, in minutes. */
const MAX_TIMEOUT_MINUTES = 24 * 60;
/**
 * @param {string} code - stable error code the route maps to a status.
 * @param {string} message - user-facing text.
 * @returns {RunnerError} the error.
 */
function runnerError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
/**
 * @param {unknown} error - anything a service threw.
 * @returns {string} a one-line description.
 */
function describe(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === 'string')
        return error;
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
/**
 * Build the frozen user message the runner admits.
 *
 * This mirrors `createUserMessage` from `@deepseek-ai/dsh-llm` exactly — that
 * helper is a role tag plus a fresh UUID and a deep freeze — so the plugin can
 * stay free of runtime dependencies.
 *
 * @param {string} text - the prompt.
 * @returns {HostUserMessage} an immutable user message.
 */
export function createUserMessage(text) {
    const message = {
        id: randomUUID(),
        role: 'user',
        content: [Object.freeze({ type: 'text', text })],
        source: Object.freeze({ kind: 'user' }),
    };
    Object.freeze(message.content);
    return Object.freeze(message);
}
/**
 * Render the task into the prompt one agent receives.
 * @param {TaskRecord} task - the task to run.
 * @param {string} cwd - working directory the session starts in.
 * @param {TaskRecord[]} board - every live task, used to name the blockers.
 * @returns {string} the prompt.
 */
export function buildPrompt(task, cwd, board = []) {
    const tags = task.tags.length > 0 ? task.tags.join(' / ') : '无';
    const workspace = (task.workspacePath ?? '').trim() === '' ? '' : `所属工作区：${task.workspacePath}\n`;
    const finished = (task.blockedBy ?? [])
        .map(id => board.find(entry => entry.id === id))
        .filter((entry) => entry !== undefined)
        .map(entry => `- ${entry.id} ${entry.title}`);
    return [
        '你是任务中心自动拉起的执行智能体。请把下面这个任务真正做完。',
        '',
        `任务 ID：${task.id}`,
        `标题：${task.title}`,
        `状态：${task.status}　优先级：${task.priority}　截止：${task.due ?? '未设置'}`,
        `标签：${tags}`,
        `工作目录：${cwd}`,
        ...(workspace === '' ? [] : [workspace.trimEnd()]),
        ...(finished.length === 0 ? [] : ['前置任务（都已完成，可以直接依赖它们的结果）：', ...finished]),
        '',
        '说明：',
        task.notes.trim() === '' ? '（无）' : task.notes.trim(),
        '',
        '要求：',
        '1. 先读工作目录里的代码和文档，弄清楚要做什么，再动手。',
        '2. 做出真实改动并自己验证；只写计划不算完成。',
        `3. 结束时调用 task_update：把 ${task.id} 的 status 改成 done，并在 notes 末尾追加一行「[完成] 一句话结果」。`,
        '   如果做不完或者被卡住，把它改成 blocked，并写清楚卡在哪里。',
        '4. 不要删除这个任务，也不要改它的 id。',
    ].join('\n');
}
/**
 * Render the planning prompt: study the workspace, split the task into stages,
 * submit them as documents. No code may change in this mode.
 * @param {TaskRecord} task - the task being planned.
 * @param {string} cwd - working directory the session starts in.
 * @param {TaskStage} stage - the draft stage being planned.
 * @returns {string} the prompt.
 */
export function buildPlanPrompt(task, cwd, stage) {
    return [
        '你是任务中心自动拉起的规划智能体。这一轮只写文档，不改代码。',
        '',
        `任务 ID：${task.id}`,
        `标题：${task.title}`,
        `阶段序号：${stage.index}　阶段标题：${stage.title}`,
        `工作目录：${cwd}`,
        `文档将写到：${stage.docPath}`,
        '',
        '说明：',
        task.notes.trim() === '' ? '（无）' : task.notes.trim(),
        '',
        '要求：',
        `1. 先读工作目录里的代码，弄清楚这个任务到底要改哪些文件、分几步做完。`,
        `2. 把任务拆成 1 到 12 个阶段，每个阶段都必须能独立验收。`,
        `3. 每个阶段给出：title、goal、scope（允许改动的文件或目录，相对工作目录）、verify（验收命令，必须能在这台机器上跑）、steps（做法要点）。`,
        `4. 用 task_stage_plan 一次性提交全部阶段：task_id 填 ${task.id}。`,
        '5. 不要修改任何代码或配置；这一轮的任何写入都会被闸门拒绝。',
        '6. 提交后本轮就结束，等人在面板上批准阶段 1。',
    ].join('\n');
}
/**
 * Render the execution prompt: the stage document is the whole contract.
 * @param {TaskRecord} task - the task being executed.
 * @param {string} cwd - working directory the session starts in.
 * @param {TaskStage} stage - the approved stage.
 * @param {string} docText - that stage's document, verbatim.
 * @param {TaskRecord[]} board - every live task, used to name the blockers.
 * @returns {string} the prompt.
 */
export function buildStagePrompt(task, cwd, stage, docText, board = []) {
    const finished = (task.blockedBy ?? [])
        .map(id => board.find(entry => entry.id === id))
        .filter((entry) => entry !== undefined)
        .map(entry => `- ${entry.id} ${entry.title}`);
    return [
        '你是任务中心自动拉起的执行智能体。这一轮只做当前阶段，严格按文档来。',
        '',
        `任务 ID：${task.id}`,
        `标题：${task.title}`,
        `阶段 ${stage.index}：${stage.title}`,
        `工作目录：${cwd}`,
        `允许改动：${stage.scope.length === 0 ? '（无，只能读取）' : stage.scope.join('、')}`,
        ...(finished.length === 0 ? [] : ['前置任务（都已完成）：', ...finished]),
        '',
        '===== 阶段文档（这是唯一的执行依据）=====',
        docText.trim(),
        '===== 文档结束 =====',
        '',
        '要求：',
        '1. 严格按上面的文档执行；文档没允许的文件一律不要写。越界会被闸门拒绝，并让你重新计划。',
        '2. 文档里的验收命令必须真的能跑通；跑不跑得通由宿主执行，不看你的自述。',
        `3. 结束时调用 task_stage_report：task_id 填 ${task.id}，summary 写一句话结果。`,
        '4. 如果做不到或被卡住，也调用 task_stage_report，并在 summary 里写清楚卡在哪里。',
        '5. 不要修改文档本身，不要删除任务。',
    ].join('\n');
}
/**
 * Coerce anything into a usable settings object.
 * @param {unknown} raw - parsed file contents.
 * @returns {RunnerSettings} normalized settings.
 */
function normalizeSettings(raw) {
    const source = raw !== null && typeof raw === 'object' ? raw : {};
    const concurrency = Number.isFinite(source.concurrency) ? Math.trunc(source.concurrency) : 2;
    const timeout = Number.isFinite(source.timeoutMinutes) ? source.timeoutMinutes : DEFAULT_TIMEOUT_MINUTES;
    const retries = Number.isFinite(source.retries) ? Math.trunc(source.retries) : 0;
    return {
        autoRun: source.autoRun === true,
        concurrency: Math.min(MAX_CONCURRENCY, Math.max(1, concurrency)),
        preset: typeof source.preset === 'string' && source.preset !== '' ? source.preset : DEFAULT_PRESET,
        timeoutMinutes: Math.min(MAX_TIMEOUT_MINUTES, Math.max(0, timeout)),
        retries: Math.min(MAX_RETRIES, Math.max(0, retries)),
    };
}
/**
 * Look a host service up by name.
 *
 * Cordis exposes services as plain properties (`ctx.sessionController`) and also
 * answers `ctx.get(name)`; accessing an uncomposed service may throw. Both are
 * tried, so the runner works whether or not the service is there.
 * @param {HostContext} context - the host context.
 * @param {string} name - service name.
 * @returns {T | undefined} the service, or undefined when it is not composed.
 */
export function service(context, name) {
    const lookup = context.get;
    if (typeof lookup === 'function') {
        try {
            const found = lookup.call(context, name);
            if (found !== undefined && found !== null)
                return found;
        }
        catch {
            // Some contexts throw for an unknown service; fall through to the property.
        }
    }
    try {
        return context[name];
    }
    catch {
        return undefined;
    }
}
/**
 * The blockers of one task that are not done yet.
 * @param {TaskRecord} task - the task about to run.
 * @param {TaskRecord[]} board - every live task.
 * @returns {TaskRecord[]} unfinished prerequisites, in the declared order.
 */
function pendingBlockers(task, board) {
    const found = [];
    for (const id of task.blockedBy) {
        const blocker = board.find(entry => entry.id === id);
        if (blocker === undefined)
            continue;
        if (blocker.status !== 'done')
            found.push(blocker);
    }
    return found;
}
/**
 * Normalize a directory the way Windows compares paths.
 * @param {string} value - some path.
 * @returns {string} lower-cased, forward-slashed, without a trailing slash.
 */
function normalizePath(value) {
    return value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
/**
 * Whether one path stays inside a directory.
 * @param {string} candidate - the path to test.
 * @param {string} root - the workspace directory.
 * @returns {boolean} true when the path is the root or below it.
 */
function isInsideRoot(candidate, root) {
    const target = normalizePath(candidate);
    if (target === '')
        return true;
    const base = normalizePath(root);
    if (base === '')
        return false;
    if (target === base)
        return true;
    return target.startsWith(`${base}/`);
}
/**
 * Whether a path exists on disk.
 * @param {string} path - absolute path.
 * @returns {Promise<boolean>} true when it can be stat'ed.
 */
async function fileExists(path) {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Flatten one argument tree into the text the path scan reads.
 * @param {unknown} args - the tool-call arguments.
 * @returns {string} JSON or the raw string.
 */
function serializeArgs(args) {
    try {
        return typeof args === 'string' ? args : JSON.stringify(args);
    }
    catch {
        return '~';
    }
}
/**
 * Pull every absolute path out of one argument tree.
 *
 * The regexes only claim tokens that look like a filesystem path, so URLs,
 * flags and plain words stay out.
 * @param {string} text - serialized arguments.
 * @returns {string[]} absolute paths.
 */
function collectPaths(text) {
    const found = [];
    const windows = /(?:^|[\s"'(=,;])([A-Za-z]:[\\/][^\s"',;|&=<>]*)/g;
    for (const match of text.matchAll(windows))
        found.push(match[1]);
    const posix = /(?:^|[\s"'(=,;])(\/(?!\/)[^\s"',;|&=<>]*)/g;
    for (const match of text.matchAll(posix))
        found.push(match[1]);
    return found;
}
/**
 * Decide whether one tool call stays inside the task's workspace.
 * @param {unknown} args - the tool-call arguments.
 * @param {string} root - the workspace directory.
 * @returns {'inside' | 'outside' | 'unknown'} the verdict.
 */
function classifyCall(args, root) {
    if (normalizePath(root) === '')
        return 'unknown';
    const text = serializeArgs(args);
    if (/(?:^|[\s"'(=,;])~(?:\/|\\|\s|$)/.test(text))
        return 'outside';
    if (/(?:^|[\\/\s"'=;])\.\.(?:[\\/]|[\s"'=;&|)]|$)/.test(text))
        return 'outside';
    for (const path of collectPaths(text)) {
        if (!isInsideRoot(path, root))
            return 'outside';
    }
    return 'inside';
}
/**
 * Pull the file a write-style call is aimed at, when the arguments name one.
 * @param {unknown} args - the tool-call arguments.
 * @returns {string | null} the raw path string.
 */
function namedPath(args) {
    if (args === null || typeof args !== 'object' || Array.isArray(args))
        return null;
    const source = args;
    for (const key of ['path', 'file_path', 'filePath', 'filename', 'file', 'target', 'destination', 'source']) {
        const value = source[key];
        if (typeof value === 'string' && value.trim() !== '')
            return value.trim();
    }
    return null;
}
/** Command shapes that must never run inside a stage. */
const DANGEROUS_COMMAND = [
    /(?:^|[\s;&|])(?:rm|rmdir)\s+(?:-[a-z]+\s+)*(?:\/|~|[A-Za-z]:)/i,
    /(?:^|[\s;&|])del\s+\/[a-z]/i,
    /(?:^|[\s;&|])rd\s+\/[a-z]/i,
    /(?:^|[\s;&|])format\s+[a-z]:/i,
    /(?:^|[\s;&|])(?:mkfs|shutdown|reboot)/i,
];
/**
 * Decide whether one call stays inside a stage's declared scope.
 * @param {unknown} args - the tool-call arguments.
 * @param {string} root - the workspace directory.
 * @param {string[]} scope - allowed files or directories, relative or absolute.
 * @returns {'inside' | 'outside' | 'unknown'} the verdict.
 */
function classifyScoped(args, root, scope) {
    if (normalizePath(root) === '')
        return 'unknown';
    if (scope.length === 0)
        return 'outside';
    const text = serializeArgs(args);
    if (/(?:^|[\s"'(=,;])~(?:\/|\\|\s|$)/.test(text))
        return 'outside';
    if (/(?:^|[\\/\s"'=;])\.\.(?:[\\/]|[\s"'=;&|)]|$)/.test(text))
        return 'outside';
    for (const pattern of DANGEROUS_COMMAND) {
        if (pattern.test(text))
            return 'outside';
    }
    const allowed = (candidate) => scope.some(entry => {
        const resolved = isAbsolute(entry) ? entry : join(root, entry);
        return isInsideRoot(candidate, resolved);
    });
    const named = namedPath(args);
    if (named !== null) {
        const absolute = isAbsolute(named) ? named : join(root, named);
        return allowed(absolute) ? 'inside' : 'outside';
    }
    const paths = collectPaths(text);
    if (paths.length === 0)
        return 'unknown';
    for (const path of paths) {
        if (!allowed(path))
            return 'outside';
    }
    return 'inside';
}
/**
 * Build one runner bound to a store and the live host context.
 * @param {HostContext} ctx - host context.
 * @param {RunnerStore} store - the shared store.
 * @returns {TaskRunner} the runner.
 */
export function createRunner(ctx, store) {
    const settingsFile = join(dirname(store.dataFile), 'settings.json');
    /** sessionId -> taskId for every run that has not settled yet. */
    const sessionToTask = new Map();
    /** taskId -> sessionId, the reverse lookup the panel needs. */
    const taskToSession = new Map();
    /** Task ids waiting for a slot, in start order. */
    const queue = [];
    /** Task ids whose session is being created right now. */
    const starting = new Set();
    /** Task ids cancelled while `starting`, to be stopped once a session exists. */
    const stopping = new Set();
    /** taskId -> timeout handle for the current attempt. */
    const timers = new Map();
    /** callId -> the call that is waiting for an approval answer. */
    const pendingCalls = new Map();
    /** Sessions that reported idle before this runner knew which task owns them. */
    const earlyIdle = new Set();
    /** Outcomes that arrived before the run row they belong to was written. */
    const pendingSettle = new Map();
    /** Sessions whose run already closed, so a duplicate idle cannot close it twice. */
    const settledSessions = [];
    let settings = null;
    const approvals = { approved: 0, blocked: 0, delegated: 0, seen: 0 };
    // Counted so a stuck "running" row can be explained from the outside: either
    // the status event never arrives, or it arrives without the agent we need.
    const diagnostics = {
        statusEvents: 0,
        statusSamples: [],
        eventTypes: new Map(),
        notes: [],
    };
    /**
     * Keep one short breadcrumb for the settings response.
     * @param {string} line - what happened.
     */
    function note(line) {
        if (diagnostics.notes.length < 12)
            diagnostics.notes.push(line);
    }
    let disposed = false;
    let draining = false;
    /**
     * @returns {Promise<RunnerSettings>} the settings, read at most once.
     */
    async function readSettings() {
        if (settings !== null)
            return settings;
        try {
            settings = normalizeSettings(JSON.parse(await readFile(settingsFile, 'utf8')));
        }
        catch {
            settings = normalizeSettings(null);
        }
        return settings;
    }
    /**
     * Persist settings atomically, then adopt them.
     * @param {RunnerSettings} next - the next settings.
     * @returns {Promise<void>} resolves once the bytes are on disk.
     */
    async function writeSettings(next) {
        await mkdir(dirname(settingsFile), { recursive: true });
        const temp = `${settingsFile}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
        await rename(temp, settingsFile);
        settings = next;
    }
    /**
     * Install the configured permission preset, when the Host composes it.
     * @param {HostAgent} agent - the run's agent.
     * @param {string} name - preset name.
     * @returns {void}
     */
    function installPreset(agent, name, stayInside) {
        const presets = service(ctx, 'permissionPresets');
        if (presets === undefined)
            return;
        try {
            // A workspace only bounds a task if the sandbox enforces it. The `auto`
            // preset is danger-full-access: the agent may write anywhere, no approval
            // is ever raised, and the gate below is never consulted. Narrow it here so
            // leaving the workspace becomes an escalation the gate can refuse.
            let effective = name;
            if (stayInside) {
                const spec = presets.resolve(name);
                if (spec?.sandbox === 'danger-full-access') {
                    const catalog = presets.catalog().options;
                    const fallback = ['workspace-write', 'read-only'].find(candidate => catalog.some(option => option.value === candidate));
                    if (fallback !== undefined) {
                        effective = fallback;
                        note(`preset ${name} 收窄到 ${fallback}（任务要求不出工作区）`);
                    }
                }
            }
            const available = presets.catalog().options.some(option => option.value === effective);
            if (!available) {
                note(`preset ${effective}: 不在目录里`);
                ctx.logger?.warn?.(`[task-center] 没有 ${effective} 这个权限预设，沿用会话默认值。`);
                return;
            }
            presets.set(agent.session, effective);
            // Recorded because "the preset silently did not stick" looks exactly like
            // "the agent behaved well" from the outside.
            note(`preset ${effective} -> ${String(presets.current?.(agent.session) ?? '?')}`);
        }
        catch (error) {
            note(`preset ${name} 失败：${describe(error)}`);
            ctx.logger?.warn?.(`[task-center] 安装权限预设失败：${describe(error)}`);
        }
    }
    /**
     * Write one run row back to its task, ignoring rows that moved on.
     * @param {string} taskId - task being run.
     * @param {TaskRun} run - the row to write.
     * @returns {Promise<void>} resolves once the store is updated.
     */
    async function writeRun(taskId, run) {
        try {
            await store.update({ id: taskId, run });
        }
        catch (error) {
            ctx.logger?.warn?.(`[task-center] 运行结果没能写回任务 ${taskId}：${describe(error)}`);
        }
    }
    /**
     * The directory a task is allowed to work in.
     * @param {TaskRecord} task - the task.
     * @returns {string} an absolute path, or '' when the task has none.
     */
    /** The workspace the task was created in, before isolation. */
    function workspaceBase(task) {
        return (task.workspacePath ?? task.cwd ?? '').trim();
    }
    /** Where the run actually works: its own worktree once one exists. */
    function workspaceRoot(task) {
        const workdir = (task.workdir ?? '').trim();
        return workdir === '' ? workspaceBase(task) : workdir;
    }
    /** Host that owns this task's workspace, when it is not this machine. */
    function remoteOf(task) {
        const base = workspaceBase(task);
        return base === '' ? null : resolveRemote(base);
    }
    /** Host to verify on: the one that owns the workspace, pointed at the workdir. */
    function verifyTarget(task) {
        const target = remoteOf(task);
        return target === null ? null : { ...target, remotePath: workspaceRoot(task) };
    }
    /** Run one shell command where the directory really lives. */
    async function shellIn(task, dir, command) {
        const target = remoteOf(task);
        if (target === null) {
            const outcome = await runCommand(command, dir, DEFAULT_VERIFY_TIMEOUT_MS);
            return { ok: outcome.ok, output: outcome.output === '' ? (outcome.error ?? '') : outcome.output };
        }
        const outcome = await runRemoteCommand({ ...target, remotePath: dir }, command);
        return { ok: outcome.code === 0, output: outcome.output };
    }
    /**
     * Give the task a checkout of its own, once.
     * The branch is named after the task and lives in `.worktrees/<task id>` of
     * the repository the stage touches, so the user's own branch is never edited.
     * @param {TaskRecord} task - task about to run.
     * @returns {Promise<string | null>} the directory to run in, or null when the
     *   workspace is not a repository at all (then the run keeps the plain path).
     */
    async function ensureWorkdir(task) {
        const existing = (task.workdir ?? '').trim();
        if (existing !== '')
            return existing;
        const base = workspaceBase(task);
        if (base === '')
            return null;
        const top = await shellIn(task, base, 'git rev-parse --show-toplevel');
        let repoRoot = top.ok ? top.output.trim() : '';
        if (repoRoot === '') {
            const listed = await shellIn(task, base, 'for d in */; do [ -d "$d/.git" ] && echo "${d%/}"; done');
            const names = listed.ok
                ? listed.output.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
                : [];
            if (names.length === 0)
                return null;
            const scope = currentStage(task)?.scope ?? [];
            const joined = names.map(name => (base.replace(/[\/]+$/, '') + '/' + name));
            const picked = pickRepo(joined, scope, () => false);
            const chosen = scope.length === 0 ? (joined.length === 1 ? joined[0] : null) : picked;
            if (chosen === null) {
                throw runnerError('repo-ambiguous', `这个工作区里有多个仓库（${names.join('、')}），当前阶段的改动路径不属于其中任何一个，没法决定在哪隔离。`);
            }
            repoRoot = chosen;
        }
        const branch = worktreeBranch(task.id);
        const path = worktreePath(repoRoot, task.id);
        const listed = await shellIn(task, repoRoot, 'git worktree list --porcelain');
        if (listed.ok && listed.output.includes(path)) {
            await store.update({ id: task.id, workdir: path });
            return path;
        }
        const known = await shellIn(task, repoRoot, `git rev-parse --verify --quiet ${shellQuote(branch)}`);
        const reuse = known.ok && known.output.trim() !== '';
        const created = await shellIn(task, repoRoot, reuse
            ? `git worktree add ${shellQuote(path)} ${shellQuote(branch)}`
            : `git worktree add -b ${shellQuote(branch)} ${shellQuote(path)} HEAD`);
        if (!created.ok) {
            throw runnerError('worktree-failed', `没能在这个仓库里建独立工作树：${briefOutput(created.output)}`);
        }
        await store.update({ id: task.id, workdir: path });
        return path;
    }
    /**
     * Write one stage back to its task.
     * @param {string} taskId - the task owning the stage.
     * @param {number} ordinal - 1-based stage number.
     * @param {Partial<TaskStage>} patch - fields to replace.
     * @returns {Promise<void>} resolves once the store is updated.
     */
    async function patchStage(taskId, ordinal, patch) {
        const board = await store.list();
        const task = board.tasks.find(entry => entry.id === taskId);
        if (task === undefined)
            return;
        const stages = task.stages.map(stage => (stage.index === ordinal ? { ...stage, ...patch } : stage));
        await store.update({ id: taskId, stages });
    }
    /**
     * Decide what one run does: write the next stage document, or execute one
     * that a person approved.
     *
     * A stage whose document already exists means planning finished earlier, so
     * the only way forward is the approval — the run refuses instead of quietly
     * planning again.
     * @param {TaskRecord} task - the task to run.
     * @returns {Promise<{kind: TaskRunKind, stage: TaskStage}>} the run's shape.
     */
    async function resolveMode(task) {
        const stage = currentStage(task);
        if (stage === null)
            throw runnerError('no-stage', '这个任务没有待执行的阶段。');
        if (stage.status === 'running')
            throw runnerError('running', '这个任务的阶段正在执行。');
        if (stage.status === 'awaiting-approval') {
            throw runnerError('awaiting-approval', `阶段 ${stage.index} 的文档已经写好，等你在面板上批准。`);
        }
        if (stage.status === 'done')
            throw runnerError('no-stage', '当前阶段已经完成，没有待执行的阶段。');
        if (stage.status === 'draft') {
            const root = workspaceRoot(task);
            const ready = root !== '' && (await fileExists(stageAbsPath(root, stage.docPath)));
            if (ready) {
                await patchStage(task.id, stage.index, { status: 'awaiting-approval' });
                throw runnerError('awaiting-approval', `阶段 ${stage.index} 的文档已经写好，等你在面板上批准。`);
            }
            return { kind: 'plan', stage };
        }
        if (stage.status === 'failed') {
            // A retry repeats what failed: planning when there is no document yet,
            // execution when the document survived.
            const root = workspaceRoot(task);
            const ready = root !== '' && (await fileExists(stageAbsPath(root, stage.docPath)));
            if (ready) {
                await patchStage(task.id, stage.index, { status: 'approved', message: null });
                return { kind: 'execute', stage: { ...stage, status: 'approved' } };
            }
            await patchStage(task.id, stage.index, { status: 'draft', message: null });
            return { kind: 'plan', stage: { ...stage, status: 'draft' } };
        }
        return { kind: 'execute', stage: { ...stage, status: 'approved' } };
    }
    /**
     * Close the books on one finished run: verify the stage, advance the plan.
     * @param {TaskRecord} task - the task as it stood when the run started.
     * @param {TaskRunKind} kind - planning or execution.
     * @param {boolean} passed - whether the session ended without an error.
     * @param {string | null} message - why it ended, when it failed.
     * @returns {Promise<void>} resolves once the board is updated.
     */
    async function finishStage(task, kind, passed, message) {
        const stage = currentStage(task);
        if (stage === null)
            return;
        if (kind === 'plan') {
            // A plan tool call leaves the stage in `awaiting-approval`; anything still
            // `running` or `draft` means the agent never produced a document.
            if (stage.status === 'running' || stage.status === 'draft') {
                await patchStage(task.id, stage.index, {
                    status: 'failed',
                    message: message ?? '规划结束，但没有提交阶段文档。',
                    endedAt: Date.now(),
                });
                return;
            }
            // The user can approve while the planning run is still closing. Once its
            // row is written as finished, start the execute run for them.
            if (stage.status === 'approved') {
                setTimeout(() => {
                    void start(task.id).catch(error => note(`approved stage did not start: ${describe(error)}`));
                }, 0);
            }
            return;
        }
        if (stage.status !== 'running' && stage.status !== 'approved')
            return;
        if (!passed) {
            await patchStage(task.id, stage.index, { status: 'failed', message: message ?? '执行失败。', endedAt: Date.now() });
            return;
        }
        if (stage.verify.length === 0) {
            await patchStage(task.id, stage.index, {
                status: 'failed',
                message: '阶段文档没有声明验收命令，没法判定这一步已经做完。',
                endedAt: Date.now(),
            });
            return;
        }
        const root = workspaceRoot(task);
        let outcomes = [];
        try {
            outcomes = await runVerifyCommands(stage.verify, root, DEFAULT_VERIFY_TIMEOUT_MS, verifyTarget(task));
        }
        catch (error) {
            await patchStage(task.id, stage.index, {
                status: 'failed',
                message: `验收命令没能跑起来：${describe(error)}`,
                endedAt: Date.now(),
            });
            return;
        }
        const failure = outcomes.find(outcome => !outcome.ok);
        if (failure !== undefined) {
            const brief = briefOutput(failure.output === '' ? (failure.error ?? '') : failure.output);
            const where = failure.where === 'remote' ? '（远端）' : '';
            const reason = failure.error !== null
                ? `验收没能跑起来：${failure.error}`
                : `验收没通过${where}：${failure.command}${failure.timedOut ? '（超时）' : ''}`;
            await patchStage(task.id, stage.index, {
                status: 'failed',
                message: reason + (brief === '' ? '' : `（${brief}）`),
                output: failure.output,
                endedAt: Date.now(),
            });
            return;
        }
        const output = outcomes
            .map(outcome => `$ ${outcome.command}\n${outcome.output}`)
            .join('\n\n')
            .slice(0, 4000);
        await advanceStage(task, stage, output);
    }
    /**
     * Pick the one line of command output worth showing on a card.
     * @param {string} output - combined output of the failed command.
     * @returns {string} a short reason, or '' when there is nothing to say.
     */
    function briefOutput(output) {
        const lines = output
            .split('\n')
            .map(line => line.trim())
            .filter(line => line !== '');
        if (lines.length === 0)
            return '';
        const line = lines[lines.length - 1];
        return line.length > 120 ? line.slice(0, 117) + '...' : line;
    }
    /**
     * Mark one stage done and open the review of the next one.
     * @param {TaskRecord} task - the task owning the stage.
     * @param {TaskStage} stage - the stage that passed.
     * @param {string} output - the verification output to keep.
     * @returns {Promise<void>} resolves once the board is updated.
     */
    async function advanceStage(task, stage, output) {
        const board = await store.list();
        const current = board.tasks.find(entry => entry.id === task.id);
        if (current === undefined)
            return;
        const nextIndex = current.stageIndex + 1;
        const stages = current.stages.map((entry, position) => {
            if (position === current.stageIndex) {
                return { ...entry, status: 'done', message: null, output, endedAt: Date.now() };
            }
            if (position === nextIndex && entry.status === 'draft') {
                return { ...entry, status: 'awaiting-approval' };
            }
            return entry;
        });
        const finished = nextIndex >= stages.length;
        await store.update({
            id: current.id,
            stages,
            stageIndex: finished ? current.stageIndex : nextIndex,
            ...(finished ? { status: 'done' } : {}),
        });
        note(`stage ${stage.index} done`);
        if (!finished)
            ctx.logger?.info?.(`[task-center] 阶段 ${stage.index} 验收通过，下一步等批准。`);
    }
    /**
     * Record the end of one attempt, then retry it when the settings allow.
     * @param {string} taskId - task being run.
     * @param {string} sessionId - the attempt's session.
     * @param {TaskRunStatus} status - how it ended.
     * @param {string | null} message - failure text.
     * @param {{retry?: boolean, force?: boolean}} options - whether a retry is
     *   allowed, and whether to apply an outcome saved before its row existed.
     * @returns {Promise<void>} resolves once the store is updated.
     */
    async function settle(taskId, sessionId, status, message, options = {}) {
        if (options.force !== true && sessionToTask.get(sessionId) !== taskId) {
            note(`settle ${taskId}: 会话已不在本 runner 名下`);
            return;
        }
        if (options.force !== true && settledSessions.indexOf(sessionId) !== -1) {
            // Both the plain and the global status listener can deliver the same idle.
            note(`settle ${taskId}: 这个会话已经收过尾了`);
            return;
        }
        settledSessions.push(sessionId);
        if (settledSessions.length > 128)
            settledSessions.shift();
        sessionToTask.delete(sessionId);
        taskToSession.delete(taskId);
        stopping.delete(taskId);
        for (const [callId, call] of pendingCalls) {
            if (call.taskId === taskId)
                pendingCalls.delete(callId);
        }
        const timer = timers.get(taskId);
        if (timer !== undefined) {
            clearTimeout(timer);
            timers.delete(taskId);
        }
        if (disposed)
            return;
        let attempts = 1;
        let retryable = false;
        try {
            const board = await store.list();
            const task = board.tasks.find(entry => entry.id === taskId);
            const run = task?.run ?? null;
            if (task === undefined || run === null || run.sessionId !== sessionId) {
                // The row may simply not be written yet: `admit` records the session
                // before it writes the run, so an outcome in that window must not be
                // lost. A forced re-apply that still does not match is genuinely stale.
                if (options.force !== true && pendingSettle.size < 64) {
                    pendingSettle.set(sessionId, { status, message, retry: options.retry === true });
                    note(`settle ${taskId}: 任务行还没写，先记下结果`);
                    return;
                }
                note(`settle ${taskId}: 任务行已被替换（${run?.sessionId ?? 'null'}）`);
                return;
            }
            attempts = run.attempts;
            retryable = options.retry === true && message !== null;
            await store.update({
                id: taskId,
                run: { ...run, status, endedAt: Date.now(), message },
            });
            // The stage decides what happens next: verify it, advance, or record the
            // failure. Only after that row is on disk, so a crash cannot skip it.
            await finishStage(task, run.kind ?? 'execute', status === 'done', message);
        }
        catch (error) {
            ctx.logger?.warn?.(`[task-center] 运行结果没能写回任务 ${taskId}：${describe(error)}`);
        }
        void drain();
        if (!retryable)
            return;
        const config = await readSettings();
        if (attempts > config.retries)
            return;
        try {
            await start(taskId);
            ctx.logger?.info?.(`[task-center] 第 ${attempts} 次尝试失败，已重新排队。`);
        }
        catch (error) {
            ctx.logger?.warn?.(`[task-center] 重试没能排上：${describe(error)}`);
        }
    }
    /**
     * Cancel the session of one attempt, ignoring a Host that cannot cancel.
     * @param {string} sessionId - session to stop.
     * @returns {void}
     */
    function cancelSession(sessionId) {
        const controller = service(ctx, 'sessionController');
        try {
            controller?.cancel?.({ sessionId });
        }
        catch (error) {
            ctx.logger?.warn?.(`[task-center] 取消会话失败：${describe(error)}`);
        }
    }
    /**
     * Arm the wall-clock limit for one attempt.
     * @param {string} taskId - the task being run.
     * @param {string} sessionId - its session.
     * @param {number} minutes - limit in minutes; 0 means no limit.
     * @returns {void}
     */
    function armTimeout(taskId, sessionId, minutes) {
        const previous = timers.get(taskId);
        if (previous !== undefined)
            clearTimeout(previous);
        if (minutes <= 0) {
            timers.delete(taskId);
            return;
        }
        const handle = setTimeout(() => {
            if (sessionToTask.get(sessionId) !== taskId)
                return;
            cancelSession(sessionId);
            void settle(taskId, sessionId, 'failed', `运行超时（${minutes} 分钟）`, { retry: true });
        }, minutes * 60 * 1000);
        if (typeof handle === 'object' && handle !== null && 'unref' in handle)
            handle.unref();
        timers.set(taskId, handle);
    }
    /**
     * Admit one attempt, unless a cancel landed while its session was created.
     * @param {TaskRecord} task - the task to run.
     * @param {TaskRecord[]} board - every live task, for the prompt.
     * @returns {Promise<TaskRecord>} the task, now in `doing` with a live run.
     */
    async function launch(task, board) {
        starting.add(task.id);
        try {
            return await admit(task, board);
        }
        finally {
            starting.delete(task.id);
        }
    }
    /**
     * Create the session and hand it the prompt.
     * @param {TaskRecord} task - the task to run.
     * @param {TaskRecord[]} board - every live task, for the prompt.
     * @returns {Promise<TaskRecord>} the task, now in `doing` with a live run.
     */
    async function admit(task, board) {
        const controller = service(ctx, 'sessionController');
        if (controller === undefined) {
            throw runnerError('unavailable', '当前 Host 没有会话服务，没法拉起智能体。');
        }
        const config = await readSettings();
        const workspaceId = (task.workspaceId ?? '').trim();
        const cwd = (task.cwd ?? '').trim();
        const workdir = await ensureWorkdir(task);
        const root = workdir ?? workspaceRoot(task);
        if (root === '')
            throw runnerError('workspace-missing', '先给这个任务指定工作区，再让它开跑。');
        const mode = await resolveMode(task);
        // Retries count inside one kind of run: a fresh execute after a plan is not
        // the plan's second attempt.
        const carried = task.run !== null && (task.run.kind ?? 'execute') === mode.kind ? task.run.attempts : 0;
        const attempt = carried + 1;
        // Exactly one of the two: the Host rejects a request naming both.
        // A task that only carries a workspace path still needs that directory.
        // An isolated worktree is a directory the workspace itself does not name, so
        // the run is pointed at it directly even when a workspace id is on the task.
        const created = workdir !== null
            ? await controller.create({ cwd: workdir })
            : await controller.create(workspaceId === '' ? { cwd: root } : { workspaceId });
        // A cancel that landed while the session was being created wins: stop the
        // session we just made instead of handing it a prompt it should not run.
        if (stopping.delete(task.id)) {
            cancelSession(created.sessionId);
            return store.update({
                id: task.id,
                run: {
                    sessionId: created.sessionId,
                    status: 'failed',
                    startedAt: Date.now(),
                    endedAt: Date.now(),
                    message: '已取消',
                    attempts: attempt,
                    kind: mode.kind,
                },
            });
        }
        const resolved = await controller.resolveAgent(created.sessionId);
        if (resolved.agent === undefined) {
            throw runnerError('unavailable', `会话 ${created.sessionId} 建好后拿不到智能体：${describe(resolved.error)}`);
        }
        const agent = resolved.agent;
        const preset = (task.permission ?? '').trim();
        installPreset(agent, preset === '' ? config.preset : preset, task.autoApprove === true);
        // Register before the prompt: the agent may flip to running immediately.
        sessionToTask.set(agent.id, task.id);
        taskToSession.set(task.id, agent.id);
        let prompt = '';
        try {
            if (mode.kind === 'plan') {
                prompt = buildPlanPrompt(task, root, mode.stage);
            }
            else {
                const docText = await readStageDoc(root, mode.stage.docPath);
                prompt = buildStagePrompt(task, workspaceId === '' ? cwd : root, mode.stage, docText, board);
            }
        }
        catch (error) {
            sessionToTask.delete(agent.id);
            taskToSession.delete(task.id);
            throw runnerError('doc-missing', `读不到阶段文档 ${mode.stage.docPath}：${describe(error)}`);
        }
        await patchStage(task.id, mode.stage.index, { status: 'running', startedAt: Date.now() });
        try {
            agent.followup(createUserMessage(prompt));
        }
        catch (error) {
            sessionToTask.delete(agent.id);
            taskToSession.delete(task.id);
            throw runnerError('unavailable', `投递任务失败：${describe(error)}`);
        }
        const sessions = service(ctx, 'sessions');
        if (sessions !== undefined && typeof sessions.flush === 'function') {
            try {
                await sessions.flush(agent.session);
            }
            catch (error) {
                ctx.logger?.warn?.(`[task-center] 会话落盘失败：${describe(error)}`);
            }
        }
        armTimeout(task.id, agent.id, config.timeoutMinutes);
        const record = await store.update({
            id: task.id,
            status: 'doing',
            run: {
                sessionId: agent.id,
                status: 'running',
                startedAt: Date.now(),
                endedAt: null,
                message: null,
                attempts: attempt,
                kind: mode.kind,
            },
        });
        // An outcome may have arrived before this row existed; honour it now.
        const pending = pendingSettle.get(agent.id);
        if (pending !== undefined) {
            pendingSettle.delete(agent.id);
            void settle(task.id, agent.id, pending.status, pending.message, { retry: pending.retry, force: true });
        }
        else if (earlyIdle.delete(agent.id)) {
            // The session may have reported idle before this row existed.
            void settle(task.id, agent.id, 'done', null);
        }
        return record;
    }
    /**
     * Park one task until a slot frees up.
     * @param {TaskRecord} task - the task to queue.
     * @returns {Promise<TaskRecord>} the task, now with a `queued` run.
     */
    async function enqueue(task) {
        if (!queue.includes(task.id))
            queue.push(task.id);
        return store.update({
            id: task.id,
            run: {
                sessionId: null,
                status: 'queued',
                startedAt: Date.now(),
                endedAt: null,
                message: null,
                attempts: task.run?.attempts ?? 0,
            },
        });
    }
    /**
     * Start whatever is waiting, as far as the concurrency cap allows.
     * @returns {Promise<void>} resolves when the queue cannot advance further.
     */
    async function drain() {
        if (disposed || draining)
            return;
        draining = true;
        try {
            const config = await readSettings();
            while (!disposed && queue.length > 0 && taskToSession.size < config.concurrency) {
                const taskId = queue.shift();
                try {
                    const board = await store.list();
                    const task = board.tasks.find(entry => entry.id === taskId);
                    if (task === undefined || task.deletedAt !== null)
                        continue;
                    if (task.run !== null && task.run.status === 'running')
                        continue;
                    const blockers = pendingBlockers(task, board.tasks);
                    if (blockers.length > 0) {
                        await writeRun(taskId, {
                            sessionId: null,
                            status: 'failed',
                            startedAt: task.run?.startedAt ?? Date.now(),
                            endedAt: Date.now(),
                            message: `前置任务还没完成：${blockers.map(entry => entry.title).join('、')}`,
                            attempts: task.run?.attempts ?? 0,
                        });
                        continue;
                    }
                    if ((task.workspaceId ?? '').trim() === '' && (task.cwd ?? '').trim() === '') {
                        await writeRun(taskId, {
                            sessionId: null,
                            status: 'failed',
                            startedAt: task.run?.startedAt ?? Date.now(),
                            endedAt: Date.now(),
                            message: '没有可用的工作区，排队已取消',
                            attempts: task.run?.attempts ?? 0,
                        });
                        continue;
                    }
                    await launch(task, board.tasks);
                }
                catch (error) {
                    ctx.logger?.warn?.(`[task-center] 排队任务 ${taskId} 起不来：${describe(error)}`);
                }
            }
        }
        finally {
            draining = false;
        }
    }
    /**
     * Start one run, or park it when every slot is taken.
     * @param {string} taskId - the task to run.
     * @returns {Promise<TaskRecord>} the task, queued or running.
     */
    async function start(taskId) {
        if (disposed)
            throw runnerError('unavailable', '任务中心已经卸载，无法开跑。');
        stopping.delete(taskId);
        const controller = service(ctx, 'sessionController');
        if (controller === undefined) {
            throw runnerError('unavailable', '当前 Host 没有会话服务，没法拉起智能体。');
        }
        const board = await store.list();
        const task = board.tasks.find(entry => entry.id === taskId);
        if (task === undefined)
            throw runnerError('not-found', `找不到任务 ${taskId}。`);
        if (task.run !== null && task.run.status === 'running')
            throw runnerError('running', '这个任务已经在跑了。');
        if (queue.includes(taskId))
            return enqueue(task);
        const workspaceId = (task.workspaceId ?? '').trim();
        const cwd = (task.cwd ?? '').trim();
        if (workspaceId === '' && cwd === '' && workspaceRoot(task) === '') {
            throw runnerError('workspace-missing', '先给这个任务指定工作区，再让它开跑。');
        }
        const blockers = pendingBlockers(task, board.tasks);
        if (blockers.length > 0) {
            throw runnerError('blocked', `还有 ${blockers.length} 个前置任务没完成：${blockers.map(entry => entry.title).join('、')}`);
        }
        // Refuse here rather than in `admit`, so a queued task never sits in the
        // queue waiting to discover it still needs a plan approved.
        await resolveMode(task);
        const config = await readSettings();
        if (taskToSession.size >= config.concurrency)
            return enqueue(task);
        return launch(task, board.tasks);
    }
    /**
     * Start every dependent that just became runnable.
     * @param {TaskRecord} done - the task that reached `done`.
     * @returns {Promise<void>} resolves when the sweep is over.
     */
    async function unlockDependents(done) {
        const config = await readSettings();
        if (!config.autoRun)
            return;
        const board = await store.list();
        for (const candidate of board.tasks) {
            if (!candidate.blockedBy.includes(done.id))
                continue;
            if (candidate.deletedAt !== null)
                continue;
            if (candidate.status === 'done')
                continue;
            if (candidate.run !== null && (candidate.run.status === 'running' || candidate.run.status === 'queued'))
                continue;
            if (pendingBlockers(candidate, board.tasks).length > 0)
                continue;
            if ((candidate.workspaceId ?? '').trim() === '' && (candidate.cwd ?? '').trim() === '')
                continue;
            try {
                await start(candidate.id);
                ctx.logger?.info?.(`[task-center] 前置完成，${candidate.id} 开始排队/开跑。`);
            }
            catch (error) {
                ctx.logger?.warn?.(`[task-center] 解锁 ${candidate.id} 失败：${describe(error)}`);
            }
        }
    }
    /**
     * React to a task mutation: `autoRun` may start it, and dependents may unlock.
     * @param {TaskRecord} record - the row as it was just written.
     * @returns {void}
     */
    /**
     * Start the tasks that were already waiting when auto-run was switched on.
     *
     * Only tasks that never ran are picked up: a task that already has a run was
     * either finished by its agent or started by hand, and re-running it on a
     * settings change would surprise the user.
     * @returns {Promise<void>} resolves once every candidate was offered to the queue.
     */
    async function sweepBoard() {
        if (disposed)
            return;
        const config = await readSettings();
        if (!config.autoRun)
            return;
        const board = await store.list();
        for (const task of board.tasks) {
            if (task.deletedAt !== null || task.status !== 'doing' || task.run !== null)
                continue;
            if ((task.workspaceId ?? '').trim() === '' && (task.cwd ?? '').trim() === '')
                continue;
            try {
                await start(task.id);
            }
            catch (error) {
                ctx.logger?.warn?.(`[task-center] 补跑失败：${describe(error)}`);
            }
        }
    }
    function onTaskChanged(record) {
        if (disposed)
            return;
        if (record.deletedAt !== null)
            return;
        if (record.status === 'done') {
            void unlockDependents(record);
            return;
        }
        if (record.status !== 'doing')
            return;
        if (record.run !== null && (record.run.status === 'running' || record.run.status === 'queued'))
            return;
        if (taskToSession.has(record.id))
            return;
        if (queue.includes(record.id))
            return;
        void (async () => {
            const config = await readSettings();
            if (!config.autoRun)
                return;
            if ((record.workspaceId ?? '').trim() === '' && (record.cwd ?? '').trim() === '')
                return;
            try {
                await start(record.id);
            }
            catch (error) {
                ctx.logger?.warn?.(`[task-center] 自动开跑失败：${describe(error)}`);
            }
        })();
    }
    // The host dispatches agent events through a scope, and a root listener does
    // not always see them. Registering twice (plain and global) keeps one run
    // from leaving the row stuck at "running" for a wiring reason.
    function onAgentStatus(payload, scope) {
        diagnostics.statusEvents += 1;
        if (diagnostics.statusEvents <= 6) {
            const agentId = typeof payload?.agent?.id === 'string' ? payload.agent.id : 'no-agent';
            diagnostics.statusSamples.push(`${scope}:${agentId}:${String(payload?.status)}`);
        }
        const sessionId = payload?.agent?.id ?? '';
        if (sessionId === '')
            return;
        const taskId = sessionToTask.get(sessionId);
        if (taskId === undefined) {
            // An idle can beat the mapping: `create()` resolves before this runner
            // records which task owns the session. Adopt the row instead of dropping
            // the only chance to close it.
            if (payload?.status === 'running')
                return;
            if (settledSessions.indexOf(sessionId) !== -1)
                return;
            void adopt(sessionId).then((adopted) => {
                if (adopted !== undefined) {
                    void settle(adopted, sessionId, 'done', null);
                    return;
                }
                // Nothing owns it yet: remember the idle so the launch that is still
                // resolving can close itself the moment it records the session.
                if (earlyIdle.size < 64)
                    earlyIdle.add(sessionId);
            });
            return;
        }
        if (payload?.status === 'running')
            return;
        void settle(taskId, sessionId, 'done', null);
    }
    /**
     * Find the task that owns a session this runner has not mapped yet.
     *
     * Retried for a short while: an idle that beats the mapping usually arrives
     * while `admit` is still between "session created" and "row written", so the
     * row shows up a few milliseconds later.
     * @param {string} sessionId - the session that went idle.
     * @param {number} [tries] - how many times to look before giving up.
     * @returns {Promise<string | undefined>} the owning task id, when found.
     */
    async function adopt(sessionId, tries = 12) {
        for (let attempt = 0; attempt < tries; attempt += 1) {
            try {
                const board = await store.list();
                const owner = board.tasks.find(entry => entry.run !== null && entry.run.sessionId === sessionId && entry.run.status === 'running');
                if (owner !== undefined) {
                    sessionToTask.set(sessionId, owner.id);
                    taskToSession.set(owner.id, sessionId);
                    note(`adopted ${owner.id} from ${sessionId}`);
                    return owner.id;
                }
            }
            catch {
                return undefined;
            }
            await new Promise(resolve => setTimeout(resolve, 15));
        }
        return undefined;
    }
    function onAgentError(payload, scope) {
        const sessionId = payload?.agent?.id ?? '';
        const taskId = sessionToTask.get(sessionId);
        note(`agent/error ${scope} ${sessionId === '' ? 'no-agent' : sessionId}`);
        if (taskId === undefined)
            return;
        void settle(taskId, sessionId, 'failed', describe(payload?.error), { retry: true });
    }
    function onAgentDisposed(payload, scope) {
        const sessionId = payload?.agent?.id ?? '';
        const taskId = sessionToTask.get(sessionId);
        note(`agent/disposed ${scope} ${sessionId === '' ? 'no-agent' : sessionId}`);
        if (taskId === undefined)
            return;
        void settle(taskId, sessionId, 'failed', '会话已结束');
    }
    ctx.on('agent/status', (payload) => onAgentStatus(payload, 'plain'));
    ctx.on('agent/status', (payload) => onAgentStatus(payload, 'global'), {
        global: true,
    });
    ctx.on('agent/error', (payload) => onAgentError(payload, 'plain'));
    ctx.on('agent/error', (payload) => onAgentError(payload, 'global'), {
        global: true,
    });
    ctx.on('agent/disposed', (payload) => onAgentDisposed(payload, 'plain'));
    ctx.on('agent/disposed', (payload) => onAgentDisposed(payload, 'global'), { global: true });
    // Remember what each call asked for: the approval request carries only the
    // call id, so the arguments are read back from the session log.
    function onSessionEvent(session, event) {
        if (diagnostics.eventTypes.size < 64) {
            const key = String(event?.type ?? '?');
            diagnostics.eventTypes.set(key, (diagnostics.eventTypes.get(key) ?? 0) + 1);
        }
        if (event.type === 'turn/end')
            note(`turn/end ${session.id}`);
        if (event.type !== 'tool/call')
            return;
        const data = (event.data ?? {});
        const callId = typeof data?.callId === 'string' ? data.callId : '';
        if (callId === '')
            return;
        const taskId = sessionToTask.get(session.id);
        if (taskId === undefined)
            return;
        pendingCalls.set(callId, {
            taskId,
            name: typeof data?.name === 'string' ? data.name : '',
            args: data?.arguments,
        });
        while (pendingCalls.size > 256) {
            const oldest = pendingCalls.keys().next();
            if (oldest.done === true)
                break;
            pendingCalls.delete(oldest.value);
        }
    }
    ctx.on('session/event', (session, event) => onSessionEvent(session, event));
    ctx.on('session/event', (session, event) => onSessionEvent(session, event), { global: true });
    // Answer approvals for this runner's own runs, but only while the call stays
    // inside the task's workspace. Everything else falls through to the user.
    // Registered twice because the host routes this waterfall through an agent
    // scope; whichever registration is in the chain answers first and the other
    // is never reached.
    function onApprovalRequest(request, next, scope) {
        // Counted before any lookup: a rising `autoSeen` proves the request reached
        // this plugin at all, which a silent panel cannot tell.
        approvals.seen += 1;
        const agentId = request?.agent?.id ?? '';
        note(`approval ${scope} agent=${agentId === '' ? 'none' : agentId} tool=${request?.toolName ?? '?'}`);
        const taskId = sessionToTask.get(agentId);
        if (taskId === undefined)
            return next();
        return (async () => {
            try {
                const board = await store.list();
                const task = board.tasks.find(entry => entry.id === taskId);
                if (task === undefined || task.autoApprove !== true)
                    return await next();
                const root = workspaceRoot(task);
                if (root === '')
                    return await next();
                const call = request.callId === undefined ? undefined : pendingCalls.get(request.callId);
                if (call === undefined)
                    return await next();
                // Planning only reads: anything that needs approval while a plan is
                // being written is judged by the workspace rule, because no stage has
                // declared a narrower scope yet.
                const stage = currentStage(task);
                const verdict = (task.run?.kind ?? 'execute') !== 'plan' && stage !== null && stage.scope.length > 0
                    ? classifyScoped(call.args, root, stage.scope)
                    : classifyCall(call.args, root);
                if (verdict !== 'inside') {
                    if (verdict === 'outside') {
                        // A task scoped to a workspace must not reach past it, and this
                        // deployment's own answerers would allow the call without a human
                        // seeing it. Refusing here is the only way "stay inside the
                        // workspace" stays true; an `unknown` verdict still asks a person.
                        approvals.blocked += 1;
                        note(`approval blocked outside ${request.toolName}`);
                        ctx.logger?.info?.(`[task-center] ${request.toolName} 脱离当前阶段范围，已拒绝（任务 ${taskId}）。`);
                        return 'rejected';
                    }
                    approvals.delegated += 1;
                    ctx.logger?.info?.(`[task-center] 无法判断 ${request.toolName} 是否在范围内，交给你确认。`);
                    return await next();
                }
                approvals.approved += 1;
                ctx.logger?.info?.(`[task-center] 阶段范围内自动批准 ${request.toolName}（任务 ${taskId}）。`);
                return 'allowed-once';
            }
            catch (error) {
                approvals.delegated += 1;
                ctx.logger?.warn?.(`[task-center] 自动批准判断失败，交给用户：${describe(error)}`);
                return await next();
            }
        })();
    }
    // Registered once and as early as the host allows: live, this waterfall is
    // answered by another listener before a plain subscriber ever runs, so the
    // gate has to sit in front of it. `prepend` is the documented way to do that;
    // if this host ignores the option the registration still works, just later.
    const approvalListener = (request, next) => onApprovalRequest(request, next, 'global');
    try {
        ctx.on('approval/request', approvalListener, { global: true, prepend: true });
        note('approval listener: global+prepend');
    }
    catch (error) {
        note(`approval listener: prepend 被拒（${describe(error)}），退回 global`);
        ctx.on('approval/request', approvalListener, { global: true });
    }
    return {
        start,
        async approveStage(taskId, ordinal) {
            const board = await store.list();
            const task = board.tasks.find(entry => entry.id === taskId);
            if (task === undefined)
                throw runnerError('not-found', `找不到任务 ${taskId}。`);
            const position = ordinal === undefined ? (task.stageIndex < 0 ? 0 : task.stageIndex) : ordinal - 1;
            const stage = task.stages[position];
            if (stage === undefined)
                throw runnerError('no-stage', `任务没有第 ${position + 1} 个阶段。`);
            if (stage.status !== 'awaiting-approval' && stage.status !== 'failed') {
                throw runnerError('not-awaiting', `阶段 ${stage.index} 现在是 ${stage.status}，不用批准。`);
            }
            const stages = task.stages.map((entry, index) => index === position ? { ...entry, status: 'approved', message: null } : entry);
            const approved = await store.update({ id: taskId, stages, stageIndex: position });
            note(`stage ${stage.index} approved`);
            // The planning run may still be closing; approving is a state change, so
            // let the click land and start the execute run when the slot is free.
            if (approved.run !== null && (approved.run.status === 'running' || approved.run.status === 'queued')) {
                return approved;
            }
            return start(taskId);
        },
        async reverify(taskId) {
            const board = await store.list();
            const task = board.tasks.find(entry => entry.id === taskId);
            if (task === undefined)
                throw runnerError('not-found', `找不到任务 ${taskId}。`);
            const stage = currentStage(task);
            if (stage === null)
                throw runnerError('no-stage', '这个任务没有待执行的阶段。');
            if (stage.status !== 'failed') {
                throw runnerError('not-failed', `阶段 ${stage.index} 现在不是失败状态，不用重新验收。`);
            }
            if (stage.verify.length === 0)
                throw runnerError('no-verify', '阶段文档没有声明验收命令。');
            const outcomes = await runVerifyCommands(stage.verify, workspaceRoot(task), DEFAULT_VERIFY_TIMEOUT_MS, verifyTarget(task));
            const failure = outcomes.find(outcome => !outcome.ok);
            if (failure !== undefined) {
                const brief = briefOutput(failure.output === '' ? (failure.error ?? '') : failure.output);
                const where = failure.where === 'remote' ? '（远端）' : '';
                await patchStage(task.id, stage.index, {
                    status: 'failed',
                    message: (failure.error !== null
                        ? `验收没能跑起来：${failure.error}`
                        : `验收没通过${where}：${failure.command}`) + (brief === '' ? '' : `（${brief}）`),
                    output: failure.output,
                    endedAt: Date.now(),
                });
                throw runnerError('verify-failed', `验收仍未通过：${failure.command}`);
            }
            const output = outcomes
                .map(outcome => `$ ${outcome.command}\n${outcome.output}`)
                .join('\n\n')
                .slice(0, 4000);
            await advanceStage(task, stage, output);
            note(`stage ${stage.index} re-verified`);
            const after = await store.list();
            const updated = after.tasks.find(entry => entry.id === taskId);
            if (updated === undefined)
                throw runnerError('not-found', `找不到任务 ${taskId}。`);
            return updated;
        },
        async rejectStage(taskId, ordinal, feedback) {
            const board = await store.list();
            const task = board.tasks.find(entry => entry.id === taskId);
            if (task === undefined)
                throw runnerError('not-found', `找不到任务 ${taskId}。`);
            const position = ordinal === undefined ? (task.stageIndex < 0 ? 0 : task.stageIndex) : ordinal - 1;
            const stage = task.stages[position];
            if (stage === undefined)
                throw runnerError('no-stage', `任务没有第 ${position + 1} 个阶段。`);
            const reason = (feedback ?? '').trim() === '' ? '文档被驳回，请重新规划。' : feedback.trim();
            const stages = task.stages.map((entry, index) => index === position ? { ...entry, status: 'draft', message: reason } : entry);
            const updated = await store.update({ id: taskId, stages, stageIndex: position });
            // Drop the rejected document: `resolveMode` treats an existing document as
            // "waiting for approval", so leaving it behind would loop forever.
            const root = workspaceRoot(task);
            if (root !== '') {
                try {
                    await unlink(stageAbsPath(root, stage.docPath));
                }
                catch {
                    // Already gone, or the workspace moved: planning recreates it anyway.
                }
            }
            note(`stage ${stage.index} rejected`);
            return updated;
        },
        async stageDoc(taskId, ordinal) {
            const board = await store.list();
            const task = board.tasks.find(entry => entry.id === taskId);
            if (task === undefined)
                throw runnerError('not-found', `找不到任务 ${taskId}。`);
            const position = ordinal === undefined ? (task.stageIndex < 0 ? 0 : task.stageIndex) : ordinal - 1;
            const stage = task.stages[position];
            if (stage === undefined)
                throw runnerError('no-stage', `任务没有第 ${position + 1} 个阶段。`);
            const root = workspaceRoot(task);
            if (root === '')
                throw runnerError('workspace-missing', '这个任务还没有工作区。');
            return { path: stage.docPath, text: await readStageDoc(root, stage.docPath) };
        },
        async cancel(taskId) {
            const position = queue.indexOf(taskId);
            if (position >= 0) {
                queue.splice(position, 1);
                const board = await store.list();
                const task = board.tasks.find(entry => entry.id === taskId);
                if (task !== undefined && task.run !== null) {
                    await writeRun(taskId, {
                        ...task.run,
                        status: 'failed',
                        endedAt: Date.now(),
                        message: '排队已取消',
                    });
                }
                void drain();
                return { canceled: true };
            }
            const sessionId = taskToSession.get(taskId);
            if (sessionId === undefined) {
                // The session is still being created: flag the task so `admit` stops it.
                if (starting.has(taskId)) {
                    stopping.add(taskId);
                    return { canceled: true };
                }
                return { canceled: false };
            }
            cancelSession(sessionId);
            await settle(taskId, sessionId, 'failed', '已取消');
            return { canceled: true };
        },
        async queue() {
            const config = await readSettings();
            return { queued: [...queue], running: taskToSession.size, concurrency: config.concurrency };
        },
        settings: readSettings,
        stats() {
            return {
                autoApproved: approvals.approved,
                autoBlocked: approvals.blocked,
                autoDelegated: approvals.delegated,
                autoSeen: approvals.seen,
                statusEvents: diagnostics.statusEvents,
                statusSamples: [...diagnostics.statusSamples],
                eventTypes: Object.fromEntries(diagnostics.eventTypes),
                notes: [...diagnostics.notes],
            };
        },
        async saveSettings(patch = {}) {
            const current = await readSettings();
            const next = normalizeSettings({
                autoRun: patch.autoRun === undefined ? current.autoRun : patch.autoRun,
                concurrency: patch.concurrency === undefined ? current.concurrency : patch.concurrency,
                preset: patch.preset === undefined ? current.preset : patch.preset,
                timeoutMinutes: patch.timeoutMinutes === undefined ? current.timeoutMinutes : patch.timeoutMinutes,
                retries: patch.retries === undefined ? current.retries : patch.retries,
            });
            await writeSettings(next);
            const wasIdle = taskToSession.size < current.concurrency;
            const nowRoom = taskToSession.size < next.concurrency;
            if (nowRoom && (!wasIdle || next.concurrency > current.concurrency))
                void drain();
            if (!current.autoRun && next.autoRun)
                void sweepBoard();
            return next;
        },
        onTaskChanged,
        async reconcile() {
            const board = await store.list();
            let repaired = 0;
            let requeued = 0;
            const config = await readSettings();
            for (const task of board.tasks) {
                const run = task.run;
                if (run === null)
                    continue;
                if (run.status === 'running') {
                    await writeRun(task.id, {
                        ...run,
                        status: 'failed',
                        endedAt: run.endedAt ?? Date.now(),
                        message: '运行中断（Host 或插件已重启）',
                    });
                    repaired += 1;
                    continue;
                }
                if (run.status === 'queued') {
                    if (config.autoRun) {
                        if (!queue.includes(task.id))
                            queue.push(task.id);
                        requeued += 1;
                    }
                    else {
                        await writeRun(task.id, {
                            ...run,
                            status: 'failed',
                            endedAt: run.endedAt ?? Date.now(),
                            message: '排队已取消（Host 重启时自动开跑是关的）',
                        });
                        repaired += 1;
                    }
                }
            }
            void drain();
            return { repaired, requeued };
        },
        dispose() {
            disposed = true;
            for (const handle of timers.values())
                clearTimeout(handle);
            timers.clear();
            queue.length = 0;
            pendingCalls.clear();
            sessionToTask.clear();
            taskToSession.clear();
        },
    };
}
