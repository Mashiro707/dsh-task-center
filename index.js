/**
 * Task Center — host half.
 *
 * One JSON document is the entire persistence layer. The browser panel and the
 * agent tools both call the same store methods, so the two surfaces can never
 * drift apart.
 *
 * No third-party imports: this module only uses `node:` builtins and the host
 * services injected below, which keeps a plain workspace bundle installable
 * without a build step or a dependency resolution of `@deepseek-ai/*`.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRunner } from './runner.js';
/** Host services this plugin needs before `apply` runs. */
export const inject = ['webServer', 'tools'];
/** Route prefix owned by this plugin. */
const ROUTE = '/task-center/api';
/** Largest request body the JSON route accepts. */
const MAX_BODY_BYTES = 1 << 20;
/** Kanban columns, in board order. */
export const STATUSES = ['todo', 'doing', 'blocked', 'done'];
/** Priority ladder, ascending urgency. */
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** Accepted shapes of a due date. */
const DUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Loopback hostnames that may talk to the plugin route. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
/**
 * Reject cross-site and non-loopback callers before any store method runs.
 * @param {Record<string, unknown>} headers - the request headers, lower-cased.
 * @returns {boolean} whether this request may use the route.
 */
export function isTrustedRequest(headers) {
    const rawHost = typeof headers?.host === 'string' ? headers.host.trim().toLowerCase() : '';
    if (rawHost === '')
        return false;
    let hostname = rawHost;
    if (hostname.startsWith('[')) {
        const end = hostname.indexOf(']');
        hostname = end === -1 ? hostname : hostname.slice(0, end + 1);
    }
    else {
        const colon = hostname.lastIndexOf(':');
        if (colon !== -1)
            hostname = hostname.slice(0, colon);
    }
    if (!LOOPBACK_HOSTS.has(hostname))
        return false;
    const site = typeof headers['sec-fetch-site'] === 'string' ? headers['sec-fetch-site'].toLowerCase() : '';
    if (site === 'cross-site')
        return false;
    const origin = typeof headers.origin === 'string' ? headers.origin.trim() : '';
    if (origin !== '' && origin !== 'null') {
        let originHost = '';
        try {
            originHost = new URL(origin).hostname.toLowerCase();
        }
        catch {
            return false;
        }
        const same = originHost === hostname;
        const loopbackPair = (originHost === 'localhost' && hostname === '127.0.0.1') ||
            (originHost === '127.0.0.1' && hostname === 'localhost');
        if (!same && !loopbackPair)
            return false;
    }
    return true;
}
/**
 * One rejectable store failure carrying the wire code the panel displays.
 * @param {string} code - stable machine code.
 * @param {string} message - human sentence.
 * @returns {StoreError} the error to throw.
 */
function storeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
/**
 * The data file this install writes.
 * @returns {string} absolute path.
 */
function defaultDataFile() {
    const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
        ? process.env.DSH_HOME.trim()
        : join(homedir(), '.dsh');
    return join(home, 'task-center', 'tasks.json');
}
/**
 * Trim one title, rejecting empties and overlong text.
 * @param {unknown} value - raw input.
 * @returns {string} the clean title.
 */
function cleanTitle(value) {
    const title = typeof value === 'string' ? value.trim() : '';
    if (title === '')
        throw storeError('invalid-title', '任务标题不能为空。');
    if (title.length > 200)
        throw storeError('invalid-title', '任务标题最多 200 个字符。');
    return title;
}
/**
 * @param {unknown} value - raw status.
 * @returns {TaskStatus} a known status.
 */
function cleanStatus(value) {
    const status = typeof value === 'string' ? value.trim() : '';
    if (!STATUSES.includes(status)) {
        throw storeError('invalid-status', `状态必须是 ${STATUSES.join(' / ')} 之一。`);
    }
    return status;
}
/**
 * @param {unknown} value - raw priority.
 * @returns {TaskPriority} a known priority.
 */
function cleanPriority(value) {
    const priority = typeof value === 'string' ? value.trim() : '';
    if (!PRIORITIES.includes(priority)) {
        throw storeError('invalid-priority', `优先级必须是 ${PRIORITIES.join(' / ')} 之一。`);
    }
    return priority;
}
/**
 * @param {unknown} value - raw due date.
 * @returns {string|null} `YYYY-MM-DD` or null.
 */
function cleanDue(value) {
    if (value === null || value === undefined || value === '')
        return null;
    if (typeof value !== 'string' || !DUE_PATTERN.test(value.trim())) {
        throw storeError('invalid-due', '截止日期必须是 YYYY-MM-DD。');
    }
    const text = value.trim();
    const parsed = new Date(`${text}T00:00:00`);
    if (Number.isNaN(parsed.getTime()))
        throw storeError('invalid-due', '截止日期不是一个真实日期。');
    return text;
}
/**
 * @param {unknown} value - raw notes.
 * @returns {string} the clean notes.
 */
function cleanNotes(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value !== 'string')
        throw storeError('invalid-notes', '备注必须是文本。');
    if (value.length > 20000)
        throw storeError('invalid-notes', '备注最多 20000 个字符。');
    return value;
}
/**
 * @param {unknown} value - raw tag list.
 * @returns {string[]} deduplicated, trimmed tags.
 */
function cleanTags(value) {
    if (value === null || value === undefined)
        return [];
    if (!Array.isArray(value))
        throw storeError('invalid-tags', '标签必须是字符串数组。');
    const seen = new Set();
    const tags = [];
    for (const entry of value) {
        if (typeof entry !== 'string')
            throw storeError('invalid-tags', '标签必须是字符串数组。');
        const tag = entry.trim();
        if (tag === '')
            continue;
        if (tag.length > 40)
            throw storeError('invalid-tags', '单个标签最多 40 个字符。');
        if (seen.has(tag))
            continue;
        seen.add(tag);
        tags.push(tag);
    }
    if (tags.length > 20)
        throw storeError('invalid-tags', '一个任务最多 20 个标签。');
    return tags;
}
/**
 * Leniently rebuild one record read from disk; malformed rows are dropped.
 * @param {Record<string, unknown> | null} raw - one stored record.
 * @returns {TaskRecord | null} the normalized record or null.
 */
/**
 * Rebuild one run row from disk.
 * @param {unknown} raw - stored value.
 * @returns {TaskRun | null} the normalized run, or null when absent.
 */
function normalizeRun(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const source = raw;
    const status = source.status === 'running' || source.status === 'done' || source.status === 'failed'
        ? source.status
        : 'failed';
    return {
        sessionId: typeof source.sessionId === 'string' && source.sessionId !== '' ? source.sessionId : null,
        status,
        startedAt: Number.isFinite(source.startedAt) ? source.startedAt : Date.now(),
        endedAt: Number.isFinite(source.endedAt) ? source.endedAt : null,
        message: typeof source.message === 'string' && source.message !== '' ? source.message : null,
    };
}
/**
 * @param {unknown} raw - stored value.
 * @returns {string | null} an absolute-looking path, or null.
 */
function cleanCwd(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}
/**
 * @param {Record<string, unknown> | null} raw - one row from disk.
 * @returns {TaskRecord | null} the normalized row.
 */
function normalizeRecord(raw) {
    if (raw === null || typeof raw !== 'object')
        return null;
    const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : null;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (id === null || title === '')
        return null;
    const status = STATUSES.includes(raw.status) ? raw.status : 'todo';
    const priority = PRIORITIES.includes(raw.priority) ? raw.priority : 'normal';
    const due = typeof raw.due === 'string' && DUE_PATTERN.test(raw.due) ? raw.due : null;
    const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
    return {
        id,
        title,
        notes: typeof raw.notes === 'string' ? raw.notes : '',
        status,
        priority,
        due,
        tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '') : [],
        cwd: cleanCwd(raw.cwd),
        run: normalizeRun(raw.run),
        parentId: typeof raw.parentId === 'string' && raw.parentId !== '' ? raw.parentId : null,
        createdAt,
        updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt,
        completedAt: Number.isFinite(raw.completedAt) ? raw.completedAt : null,
        deletedAt: Number.isFinite(raw.deletedAt) ? raw.deletedAt : null,
        trashRoot: typeof raw.trashRoot === 'string' && raw.trashRoot !== '' ? raw.trashRoot : null,
    };
}
/**
 * Rebuild the whole document, keeping only usable rows.
 * @param {unknown} parsed - parsed file contents.
 * @returns {TaskRecord[]} normalized records.
 */
function normalizeRecords(parsed) {
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    const records = [];
    const seen = new Set();
    for (const row of rows) {
        const record = normalizeRecord(row);
        if (record === null || seen.has(record.id))
            continue;
        seen.add(record.id);
        records.push(record);
    }
    return records;
}
/**
 * Build one store bound to a single data file.
 *
 * Writes are serialized and land through `writeFile` + `rename`, so a crash can
 * never leave a half-written document behind, and the in-memory copy only moves
 * forward after the bytes are on disk.
 *
 * @param {{ dataFile?: string }} [options] - where the document lives.
 * @returns {TaskStore} the store surface shared by the route and the tools.
 */
export function createTaskStore(options = {}) {
    const dataFile = typeof options.dataFile === 'string' && options.dataFile !== ''
        ? options.dataFile
        : defaultDataFile();
    let cache = null;
    let loading = null;
    let warning = null;
    let writeChain = Promise.resolve();
    /** @returns {Promise<TaskRecord[]>} the current records. */
    async function readRecords() {
        if (cache !== null)
            return cache;
        if (loading !== null)
            return loading;
        loading = (async () => {
            let text = null;
            try {
                text = await readFile(dataFile, 'utf8');
            }
            catch (error) {
                if (error && error.code === 'ENOENT') {
                    cache = [];
                    return cache;
                }
                throw error;
            }
            try {
                cache = normalizeRecords(JSON.parse(text));
            }
            catch {
                const backup = `${dataFile}.corrupt-${Date.now()}`;
                try {
                    await copyFile(dataFile, backup);
                }
                catch {
                    // The backup is best effort; recovery must still proceed.
                }
                warning = `数据文件无法解析，已备份到 ${backup}，并以空清单继续。`;
                cache = [];
            }
            return cache;
        })();
        try {
            return await loading;
        }
        finally {
            loading = null;
        }
    }
    /**
     * Persist one record list, then adopt it as the live copy.
     * @param {TaskRecord[]} records - the next full document.
     * @returns {Promise<void>} resolves once the bytes are on disk.
     */
    async function commit(records) {
        const body = JSON.stringify({ version: 1, tasks: records }, null, 2);
        const run = writeChain.then(async () => {
            await mkdir(dirname(dataFile), { recursive: true });
            const temp = `${dataFile}.${process.pid}.tmp`;
            await writeFile(temp, body, 'utf8');
            await rename(temp, dataFile);
        });
        // Keep the chain alive after a failed write: the next call still queues.
        writeChain = run.then(() => undefined, () => undefined);
        await run;
        cache = records;
    }
    /**
     * Run one mutation against a copy, persisting only when it succeeds.
     * @param {(records: TaskRecord[]) => T} mutate - the change.
     * @returns {Promise<T>} whatever the change returns.
     */
    async function transact(mutate) {
        const current = await readRecords();
        const draft = current.map(record => ({ ...record, tags: [...record.tags] }));
        const result = mutate(draft);
        await commit(draft);
        return result;
    }
    /**
     * @param {TaskRecord[]} records - the document.
     * @param {unknown} id - task id, straight from the request body.
     * @returns {TaskRecord} the visible record.
     */
    function requireLive(records, id) {
        const found = records.find(record => record.id === id && record.deletedAt === null);
        if (found === undefined)
            throw storeError('not-found', `找不到任务 ${id}。`);
        return found;
    }
    /**
     * Collect a task and every descendant, deepest last.
     * @param {TaskRecord[]} records - the document.
     * @param {string} rootId - subtree root.
     * @returns {TaskRecord[]} the subtree.
     */
    function subtree(records, rootId) {
        const out = [];
        const queue = [rootId];
        while (queue.length > 0) {
            const id = queue.shift();
            const record = records.find(entry => entry.id === id);
            if (record === undefined || out.includes(record))
                continue;
            out.push(record);
            for (const child of records) {
                if (child.parentId === id)
                    queue.push(child.id);
            }
        }
        return out;
    }
    return {
        dataFile,
        /**
         * Read the whole board: live tasks plus one row per trashed tree.
         * @returns {Promise<TaskBoard>} the board payload.
         */
        async list() {
            const records = await readRecords();
            const tasks = records.filter(record => record.deletedAt === null);
            const trash = records
                .filter((record) => record.deletedAt !== null && record.trashRoot === record.id)
                .map(root => ({
                id: root.id,
                title: root.title,
                deletedAt: root.deletedAt,
                count: records.filter(record => record.deletedAt !== null && record.trashRoot === root.id).length,
            }))
                .sort((left, right) => right.deletedAt - left.deletedAt);
            return { tasks, trash, warning, dataFile };
        },
        /**
         * Add one task (or one subtask, when `parentId` names a top-level task).
         * @param {TaskCreatePayload} [input] - the new task.
         * @returns {Promise<TaskRecord>} the created record.
         */
        create(input = {}) {
            return transact(records => {
                const now = Date.now();
                let parentId = null;
                if (input.parentId !== null && input.parentId !== undefined && input.parentId !== '') {
                    const parent = records.find(record => record.id === input.parentId && record.deletedAt === null);
                    if (parent === undefined)
                        throw storeError('invalid-parent', `找不到父任务 ${input.parentId}。`);
                    if (parent.parentId !== null) {
                        throw storeError('subtask-depth', '子任务不能再带子任务，最多一层。');
                    }
                    parentId = parent.id;
                }
                const status = input.status === undefined ? 'todo' : cleanStatus(input.status);
                const record = {
                    id: `t_${now.toString(36)}_${randomUUID().slice(0, 8)}`,
                    title: cleanTitle(input.title),
                    notes: cleanNotes(input.notes),
                    status,
                    priority: input.priority === undefined ? 'normal' : cleanPriority(input.priority),
                    due: cleanDue(input.due),
                    tags: cleanTags(input.tags),
                    cwd: cleanCwd(input.cwd),
                    run: null,
                    parentId,
                    createdAt: now,
                    updatedAt: now,
                    completedAt: status === 'done' ? now : null,
                    deletedAt: null,
                    trashRoot: null,
                };
                records.push(record);
                return { ...record, tags: [...record.tags] };
            });
        },
        /**
         * Patch one live task. Only the fields present in `input` change.
         * @param {TaskUpdatePayload} [input] - `id` plus any editable field.
         * @returns {Promise<TaskRecord>} the updated record.
         */
        update(input = {}) {
            return transact(records => {
                const record = requireLive(records, input.id);
                if (input.title !== undefined)
                    record.title = cleanTitle(input.title);
                if (input.notes !== undefined)
                    record.notes = cleanNotes(input.notes);
                if (input.priority !== undefined)
                    record.priority = cleanPriority(input.priority);
                if (input.due !== undefined)
                    record.due = cleanDue(input.due);
                if (input.tags !== undefined)
                    record.tags = cleanTags(input.tags);
                if (input.cwd !== undefined)
                    record.cwd = cleanCwd(input.cwd);
                if (input.run !== undefined)
                    record.run = normalizeRun(input.run);
                if (input.status !== undefined) {
                    const status = cleanStatus(input.status);
                    if (status === 'done' && record.status !== 'done')
                        record.completedAt = Date.now();
                    if (status !== 'done' && record.status === 'done')
                        record.completedAt = null;
                    record.status = status;
                }
                if (input.parentId !== undefined) {
                    if (input.parentId === null || input.parentId === '') {
                        record.parentId = null;
                    }
                    else {
                        if (input.parentId === record.id)
                            throw storeError('invalid-parent', '任务不能成为自己的父任务。');
                        const parent = records.find(entry => entry.id === input.parentId && entry.deletedAt === null);
                        if (parent === undefined)
                            throw storeError('invalid-parent', `找不到父任务 ${input.parentId}。`);
                        if (parent.parentId !== null)
                            throw storeError('subtask-depth', '子任务不能再带子任务，最多一层。');
                        if (records.some(entry => entry.parentId === record.id && entry.deletedAt === null)) {
                            throw storeError('subtask-depth', '带子任务的任务不能变成子任务。');
                        }
                        record.parentId = parent.id;
                    }
                }
                record.updatedAt = Date.now();
                return { ...record, tags: [...record.tags] };
            });
        },
        /**
         * Move one task tree to the trash.
         * @param {TaskIdPayload} [input] - the task to remove.
         * @returns {Promise<{ removed: number }>} how many rows moved.
         */
        remove(input = {}) {
            return transact(records => {
                const record = requireLive(records, input.id);
                const now = Date.now();
                const rows = subtree(records, record.id).filter(entry => entry.deletedAt === null);
                for (const row of rows) {
                    row.deletedAt = now;
                    row.trashRoot = record.id;
                    row.updatedAt = now;
                }
                return { removed: rows.length };
            });
        },
        /**
         * Bring one trashed tree back to the board.
         * @param {TaskIdPayload} [input] - the trash root.
         * @returns {Promise<{ restored: number }>} how many rows returned.
         */
        restore(input = {}) {
            return transact(records => {
                const root = records.find(entry => entry.id === input.id);
                if (root === undefined || root.deletedAt === null)
                    throw storeError('not-found', `回收站里没有 ${input.id}。`);
                if (root.trashRoot !== root.id)
                    throw storeError('not-found', '请恢复整条任务，而不是它的子任务。');
                const now = Date.now();
                const rows = records.filter(entry => entry.trashRoot === root.id);
                for (const row of rows) {
                    row.deletedAt = null;
                    row.trashRoot = null;
                    row.updatedAt = now;
                }
                return { restored: rows.length };
            });
        },
        /**
         * Delete one trashed tree for good.
         * @param {TaskIdPayload} [input] - the trash root.
         * @returns {Promise<{ removed: number }>} how many rows were dropped.
         */
        purge(input = {}) {
            return transact(records => {
                const root = records.find(entry => entry.id === input.id);
                if (root === undefined || root.deletedAt === null)
                    throw storeError('not-found', `回收站里没有 ${input.id}。`);
                if (root.trashRoot !== root.id)
                    throw storeError('not-found', '请彻底删除整条任务，而不是它的子任务。');
                const doomed = new Set(records.filter(entry => entry.trashRoot === root.id).map(entry => entry.id));
                for (let index = records.length - 1; index >= 0; index -= 1) {
                    if (doomed.has(records[index].id))
                        records.splice(index, 1);
                }
                return { removed: doomed.size };
            });
        },
        /**
         * Drop every trashed tree.
         * @returns {Promise<{ removed: number }>} how many rows were dropped.
         */
        emptyTrash() {
            return transact(records => {
                const keep = records.filter(entry => entry.deletedAt === null);
                const removed = records.length - keep.length;
                records.length = 0;
                records.push(...keep);
                return { removed };
            });
        },
    };
}
/**
 * Read a JSON request body under a hard size cap.
 * @param {HttpRequest} request - the request.
 * @returns {Promise<Record<string, unknown>>} the parsed body.
 */
async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES)
            throw storeError('payload-too-large', '请求体过大。');
        chunks.push(chunk);
    }
    if (size === 0)
        return {};
    const text = Buffer.concat(chunks).toString('utf8');
    if (text.trim() === '')
        return {};
    try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw storeError('invalid-json', '请求体必须是一个 JSON 对象。');
        }
        return parsed;
    }
    catch (error) {
        if (error && typeof error.code === 'string')
            throw error;
        throw storeError('invalid-json', '请求体不是合法 JSON。');
    }
}
/**
 * Write one JSON envelope.
 * @param {HttpResponse} response - the response.
 * @param {number} status - HTTP status.
 * @param {unknown} payload - envelope body.
 * @returns {void}
 */
function writeJson(response, status, payload) {
    const body = JSON.stringify(payload);
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.end(body);
}
/**
 * The model-facing output envelope shared by every task tool.
 * @param {unknown} _args - tool arguments; unused by the JSON renderer.
 * @param {unknown} value - tool result.
 * @returns {{ type: string, text: string }[]} one text block.
 */
function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
/** JSON-shaped tool output: the host renders the value as text. */
const JSON_OUTPUT = { schema: { type: 'json' }, render: renderJson };
/**
 * Publish the four agent tools against one store.
 * @param {HostContext} ctx - host context.
 * @param {TaskStore} store - the shared store.
 * @returns {() => void} disposer releasing every registration.
 */
function publishTools(ctx, store) {
    const disposers = [];
    const add = (definition) => {
        disposers.push(ctx.tools.register(definition));
    };
    add({
        name: 'task_list',
        description: 'List tasks from the user task center. Returns live tasks (with subtasks nested under their parent) plus the trash. Every field of a task is included: status, priority, due date, tags and notes.',
        parameters: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: STATUSES, description: 'Only return tasks in this column.' },
                tag: { type: 'string', description: 'Only return tasks carrying this exact tag.' },
                query: { type: 'string', description: 'Case-insensitive substring match on title and notes.' },
                include_trash: { type: 'boolean', description: 'Also return the recycle bin rows.' },
            },
            additionalProperties: false,
        },
        output: JSON_OUTPUT,
        execute: async (args) => {
            const board = await store.list();
            const status = typeof args?.status === 'string' && args.status !== '' ? args.status : null;
            const tag = typeof args?.tag === 'string' && args.tag.trim() !== '' ? args.tag.trim() : null;
            const query = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
            const tasks = board.tasks.filter(task => {
                if (status !== null && task.status !== status)
                    return false;
                if (tag !== null && !task.tags.includes(tag))
                    return false;
                if (query !== '') {
                    const haystack = `${task.title}\n${task.notes}`.toLowerCase();
                    if (!haystack.includes(query))
                        return false;
                }
                return true;
            });
            return {
                tasks,
                total: tasks.length,
                ...(args?.include_trash === true ? { trash: board.trash } : {}),
                ...(board.warning === null ? {} : { warning: board.warning }),
            };
        },
    });
    add({
        name: 'task_create',
        description: 'Create one task in the user task center. Pass parent_id to add it as a subtask of an existing top-level task (subtasks are one level deep).',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Task title, required, at most 200 characters.' },
                notes: { type: 'string', description: 'Free-form notes.' },
                status: { type: 'string', enum: STATUSES, description: 'Defaults to todo.' },
                priority: { type: 'string', enum: PRIORITIES, description: 'Defaults to normal.' },
                due: { type: 'string', description: 'Due date as YYYY-MM-DD.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'At most 20 short tags.' },
                parent_id: { type: 'string', description: 'Id of the top-level task to nest under.' },
            },
            required: ['title'],
            additionalProperties: false,
        },
        output: JSON_OUTPUT,
        execute: args => store.create({
            title: args?.title,
            notes: args?.notes,
            status: args?.status,
            priority: args?.priority,
            due: args?.due,
            tags: args?.tags,
            parentId: args?.parent_id,
        }),
    });
    add({
        name: 'task_update',
        description: 'Update one task in the user task center. Only the fields you pass change. Use status done to complete it, or a different status to reopen it.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Task id.' },
                title: { type: 'string' },
                notes: { type: 'string' },
                status: { type: 'string', enum: STATUSES },
                priority: { type: 'string', enum: PRIORITIES },
                due: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear.' },
                tags: { type: 'array', items: { type: 'string' } },
                parent_id: { type: ['string', 'null'], description: 'Move under another top-level task, or null.' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        output: JSON_OUTPUT,
        execute: args => store.update({
            id: args?.id,
            title: args?.title,
            notes: args?.notes,
            status: args?.status,
            priority: args?.priority,
            due: args?.due,
            tags: args?.tags,
            parentId: args?.parent_id,
        }),
    });
    add({
        name: 'task_delete',
        description: 'Delete one task in the user task center. By default the task and its subtasks move to the recycle bin and can be restored from the panel. Pass permanent true to erase them for good.',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Task id.' },
                permanent: { type: 'boolean', description: 'Erase instead of moving to the recycle bin.' },
            },
            required: ['id'],
            additionalProperties: false,
        },
        output: JSON_OUTPUT,
        execute: async (args) => {
            if (args?.permanent === true) {
                await store.remove({ id: args?.id });
                return store.purge({ id: args?.id });
            }
            return store.remove({ id: args?.id });
        },
    });
    return () => {
        for (const dispose of disposers)
            dispose();
    };
}
/**
 * @param {Record<string, unknown>} input - a request body naming one task.
 * @returns {string} the task id.
 */
function requireId(input) {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (id === '')
        throw storeError('bad-request', '缺少任务 id。');
    return id;
}
/**
 * Mount the plugin: one HTTP route for the panel, four tools for the agent, and
 * the automatic runner behind both.
 * @param {HostContext} ctx - the host Cordis context.
 * @returns {void}
 */
export function apply(ctx) {
    const store = createTaskStore();
    const runner = createRunner(ctx, store);
    /** Every mutation the panel or a tool makes feeds the auto-run gate. */
    const watched = {
        ...store,
        create: async (input) => {
            const record = await store.create(input);
            runner.onTaskChanged(record);
            return record;
        },
        update: async (input) => {
            const record = await store.update(input);
            runner.onTaskChanged(record);
            return record;
        },
    };
    const handlers = {
        list: () => watched.list(),
        create: input => watched.create(input),
        update: input => watched.update(input),
        remove: input => watched.remove(input),
        // The panel has always called this `delete`; keep both spellings working.
        delete: input => watched.remove(input),
        restore: input => watched.restore(input),
        purge: input => watched.purge(input),
        emptyTrash: () => watched.emptyTrash(),
        run: input => runner.start(requireId(input)),
        cancelRun: input => runner.cancel(requireId(input)),
        settings: async () => ({
            ...(await runner.settings()),
            available: ctx.get('sessionController') !== undefined,
        }),
        saveSettings: input => runner.saveSettings(input),
    };
    /**
     * Dispatch one `/task-center/api/<method>` call.
     * @param {HttpRequest} request - the request.
     * @param {HttpResponse} response - the response.
     * @returns {Promise<void>} resolves after the response is written.
     */
    async function handler(request, response) {
        try {
            if (!isTrustedRequest(request.headers)) {
                writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: '只接受本机页面发起的请求。' } });
                return;
            }
            if (request.method !== 'POST') {
                writeJson(response, 405, { ok: false, error: { code: 'method', message: '请使用 POST。' } });
                return;
            }
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (!url.pathname.startsWith(`${ROUTE}/`)) {
                writeJson(response, 404, { ok: false, error: { code: 'not-found', message: '没有这个接口。' } });
                return;
            }
            const method = decodeURIComponent(url.pathname.slice(ROUTE.length + 1));
            const operation = Object.hasOwn(handlers, method) ? handlers[method] : null;
            if (operation === null) {
                writeJson(response, 404, { ok: false, error: { code: 'not-found', message: `没有 ${method} 这个接口。` } });
                return;
            }
            const body = await readJsonBody(request);
            const value = await operation(body);
            writeJson(response, 200, { ok: true, value });
        }
        catch (error) {
            const code = typeof error?.code === 'string' ? error.code : 'internal';
            const message = error instanceof Error ? error.message : String(error);
            const status = code === 'forbidden' ? 403 : code === 'internal' ? 500 : 400;
            if (code === 'internal')
                ctx.logger?.warn?.(`[task-center] ${message}`);
            writeJson(response, status, { ok: false, error: { code, message } });
        }
    }
    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler }), 'task-center: json api');
    ctx.effect(() => {
        try {
            return publishTools(ctx, watched);
        }
        catch (error) {
            ctx.logger?.warn?.(`[task-center] 工具注册失败：${error instanceof Error ? error.message : String(error)}`);
            return () => undefined;
        }
    }, 'task-center: agent tools');
    ctx.effect(() => () => runner.dispose(), 'task-center: runner');
    // No run can outlive the plugin, so any row still marked running is an orphan.
    void runner.reconcile().catch((error) => {
        ctx.logger?.warn?.(`[task-center] 中断运行清理失败：${error instanceof Error ? error.message : String(error)}`);
    });
}
