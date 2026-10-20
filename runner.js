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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
/** How many runs may be alive at once when the caller asks for no particular cap. */
const MAX_CONCURRENCY = 4;
/** Preset that reviews each call before it runs; the closest thing to unattended. */
const DEFAULT_PRESET = 'auto';
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
 * @returns {string} the prompt.
 */
export function buildPrompt(task, cwd) {
    const tags = task.tags.length > 0 ? task.tags.join(' / ') : '无';
    return [
        '你是任务中心自动拉起的执行智能体。请把下面这个任务真正做完。',
        '',
        `任务 ID：${task.id}`,
        `标题：${task.title}`,
        `状态：${task.status}　优先级：${task.priority}　截止：${task.due ?? '未设置'}`,
        `标签：${tags}`,
        `工作目录：${cwd}`,
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
 * Coerce anything into a usable settings object.
 * @param {unknown} raw - parsed file contents.
 * @returns {RunnerSettings} normalized settings.
 */
function normalizeSettings(raw) {
    const source = raw !== null && typeof raw === 'object' ? raw : {};
    const concurrency = Number.isFinite(source.concurrency) ? Math.trunc(source.concurrency) : 2;
    return {
        autoRun: source.autoRun === true,
        concurrency: Math.min(MAX_CONCURRENCY, Math.max(1, concurrency)),
        preset: typeof source.preset === 'string' && source.preset !== '' ? source.preset : DEFAULT_PRESET,
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
    let settings = null;
    let disposed = false;
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
    function installPreset(agent, name) {
        const presets = service(ctx, 'permissionPresets');
        if (presets === undefined)
            return;
        try {
            const available = presets.catalog().options.some(option => option.value === name);
            if (!available) {
                ctx.logger?.warn?.(`[task-center] 没有 ${name} 这个权限预设，沿用会话默认值。`);
                return;
            }
            presets.set(agent.session, name);
        }
        catch (error) {
            ctx.logger?.warn?.(`[task-center] 安装权限预设失败：${describe(error)}`);
        }
    }
    /**
     * Record the end of one run, whichever way it ended.
     * @param {string} taskId - task being run.
     * @param {string} sessionId - the run's session.
     * @param {TaskRunStatus} status - how it ended.
     * @param {string | null} message - failure text.
     * @returns {Promise<void>} resolves once the store is updated.
     */
    async function settle(taskId, sessionId, status, message) {
        if (sessionToTask.get(sessionId) !== taskId)
            return;
        sessionToTask.delete(sessionId);
        taskToSession.delete(taskId);
        if (disposed)
            return;
        try {
            const board = await store.list();
            const task = board.tasks.find(entry => entry.id === taskId);
            const run = task?.run ?? null;
            if (task === undefined || run === null || run.sessionId !== sessionId)
                return;
            await store.update({
                id: taskId,
                run: { ...run, status, endedAt: Date.now(), message },
            });
        }
        catch (error) {
            ctx.logger?.warn?.(`[task-center] 运行结果没能写回任务 ${taskId}：${describe(error)}`);
        }
    }
    /**
     * Start one run.
     * @param {string} taskId - the task to run.
     * @returns {Promise<TaskRecord>} the task, now in `doing` with a live run.
     */
    async function start(taskId) {
        if (disposed)
            throw runnerError('unavailable', '任务中心已经卸载，无法开跑。');
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
        const cwd = (task.cwd ?? '').trim();
        if (cwd === '')
            throw runnerError('cwd-missing', '先给这个任务设置工作目录，再让它开跑。');
        const config = await readSettings();
        if (taskToSession.size >= config.concurrency) {
            throw runnerError('busy', `同时最多跑 ${config.concurrency} 个任务，先等一个结束。`);
        }
        const created = await controller.create({ cwd });
        const resolved = await controller.resolveAgent(created.sessionId);
        if (resolved.agent === undefined) {
            throw runnerError('unavailable', `会话 ${created.sessionId} 建好后拿不到智能体：${describe(resolved.error)}`);
        }
        const agent = resolved.agent;
        installPreset(agent, config.preset);
        // Register before the prompt: the agent may flip to running immediately.
        sessionToTask.set(agent.id, task.id);
        taskToSession.set(task.id, agent.id);
        try {
            agent.followup(createUserMessage(buildPrompt(task, cwd)));
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
        return store.update({
            id: task.id,
            status: 'doing',
            run: {
                sessionId: agent.id,
                status: 'running',
                startedAt: Date.now(),
                endedAt: null,
                message: null,
            },
        });
    }
    /**
     * React to a task mutation: `autoRun` may start it now.
     * @param {TaskRecord} record - the row as it was just written.
     * @returns {void}
     */
    function onTaskChanged(record) {
        if (disposed)
            return;
        if (record.deletedAt !== null)
            return;
        if (record.status !== 'doing')
            return;
        if (record.run !== null && record.run.status === 'running')
            return;
        if (taskToSession.has(record.id))
            return;
        void (async () => {
            const config = await readSettings();
            if (!config.autoRun)
                return;
            if ((record.cwd ?? '').trim() === '')
                return;
            if (taskToSession.size >= config.concurrency) {
                ctx.logger?.info?.(`[task-center] 并发已满，${record.id} 排队等下一次。`);
                return;
            }
            try {
                await start(record.id);
            }
            catch (error) {
                ctx.logger?.warn?.(`[task-center] 自动开跑失败：${describe(error)}`);
            }
        })();
    }
    ctx.on('agent/status', (payload) => {
        const taskId = sessionToTask.get(payload.agent.id);
        if (taskId === undefined || payload.status === 'running')
            return;
        void settle(taskId, payload.agent.id, 'done', null);
    });
    ctx.on('agent/error', (payload) => {
        const taskId = sessionToTask.get(payload.agent.id);
        if (taskId === undefined)
            return;
        void settle(taskId, payload.agent.id, 'failed', describe(payload.error));
    });
    ctx.on('agent/disposed', (payload) => {
        const taskId = sessionToTask.get(payload.agent.id);
        if (taskId === undefined)
            return;
        void settle(taskId, payload.agent.id, 'failed', '会话已结束');
    });
    return {
        start,
        async cancel(taskId) {
            const sessionId = taskToSession.get(taskId);
            if (sessionId === undefined)
                return { canceled: false };
            const controller = service(ctx, 'sessionController');
            try {
                controller?.cancel?.({ sessionId });
            }
            catch (error) {
                ctx.logger?.warn?.(`[task-center] 取消会话失败：${describe(error)}`);
            }
            await settle(taskId, sessionId, 'failed', '已取消');
            return { canceled: true };
        },
        settings: readSettings,
        async saveSettings(patch = {}) {
            const current = await readSettings();
            const next = normalizeSettings({
                autoRun: patch.autoRun === undefined ? current.autoRun : patch.autoRun,
                concurrency: patch.concurrency === undefined ? current.concurrency : patch.concurrency,
                preset: patch.preset === undefined ? current.preset : patch.preset,
            });
            await writeSettings(next);
            return next;
        },
        onTaskChanged,
        async reconcile() {
            const board = await store.list();
            let repaired = 0;
            for (const task of board.tasks) {
                const run = task.run;
                if (run === null || run.status !== 'running')
                    continue;
                try {
                    await store.update({
                        id: task.id,
                        run: {
                            ...run,
                            status: 'failed',
                            endedAt: run.endedAt ?? Date.now(),
                            message: '运行中断（Host 或插件已重启）',
                        },
                    });
                    repaired += 1;
                }
                catch (error) {
                    ctx.logger?.warn?.(`[task-center] 清理中断运行失败：${describe(error)}`);
                }
            }
            return { repaired };
        },
        dispose() {
            disposed = true;
            sessionToTask.clear();
            taskToSession.clear();
        },
    };
}
