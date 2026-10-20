"use strict";
window.__ModuleLoader__.load({
    id: 'dsh-task-center',
    factory: (require) => {
        const React = require('react');
        const h = React.createElement;
        const { useState, useEffect, useMemo, useRef, useCallback } = React;
        const NS = 'dsh-task-center';
        const PANEL_ID = 'task-center';
        const PANEL_ORDER = 6;
        const API = '/task-center/api/';
        const COLUMNS = ['todo', 'doing', 'blocked', 'done'];
        const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
        const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
        // ---------------------------------------------------------------- locale
        const DICT = {
            zh: {
                nav: '任务中心',
                title: '任务中心',
                newPlaceholder: '写个标题，按回车创建',
                create: '创建',
                search: '搜索标题、备注或标签',
                viewBoard: '看板',
                viewList: '清单',
                viewTrash: '回收站',
                'column.todo': '待办',
                'column.doing': '进行中',
                'column.blocked': '受阻',
                'column.done': '已完成',
                'column.add': '在这一列新建',
                emptyColumn: '拖到这里',
                emptyBoard: '还没有任务。在上面输入标题，按回车开始。',
                countTasks: '{n} 个任务',
                bannerToday: '今天到期 {n} 项',
                bannerOverdue: '已逾期 {n} 项',
                chipToday: '今天',
                chipTomorrow: '明天',
                chipOverdue: '逾期 {n} 天',
                'priority.low': '低',
                'priority.normal': '普通',
                'priority.high': '高',
                'priority.urgent': '紧急',
                'field.status': '状态',
                'field.priority': '优先级',
                'field.due': '截止日期',
                'field.tags': '标签',
                'field.notes': '备注',
                'field.title': '标题',
                groupSchedule: '状态与时间',
                groupContent: '内容',
                tagsPlaceholder: '用逗号分隔',
                notesPlaceholder: '补充说明…',
                dueClear: '清除日期',
                subtasks: '子任务',
                subtaskAdd: '添加子任务，回车确认',
                subtaskProgress: '{done}/{total}',
                subtaskOnlyOneLevel: '子任务下不能再加子任务',
                close: '关闭',
                deleteTask: '删除任务',
                created: '创建于 {time}',
                saveIdle: '',
                saveSaving: '保存中…',
                saveSaved: '已保存',
                saveError: '保存失败',
                trashEmpty: '回收站是空的。',
                trashHint: '删除的任务先进入回收站，清空后才会真正移除。',
                restore: '恢复',
                purge: '彻底删除',
                clearTrash: '清空回收站',
                trashCount: '{n} 项',
                confirmPurge: '彻底删除这个任务？无法撤销。',
                confirmClear: '清空回收站？无法恢复。',
                loadError: '加载失败',
                retry: '重试',
                allTags: '全部标签',
                noticeCreated: '已创建',
                noticeDeleted: '已移入回收站',
                noticeRestored: '已恢复',
                noticePurged: '已彻底删除',
                noticeCleared: '回收站已清空',
                untitled: '（无标题）',
                done: '完成',
            },
            en: {
                nav: 'Task Center',
                title: 'Task Center',
                newPlaceholder: 'Type a title, press Enter',
                create: 'Create',
                search: 'Search titles, notes or tags',
                viewBoard: 'Board',
                viewList: 'List',
                viewTrash: 'Trash',
                'column.todo': 'To do',
                'column.doing': 'Doing',
                'column.blocked': 'Blocked',
                'column.done': 'Done',
                'column.add': 'Add to this column',
                emptyColumn: 'Drop here',
                emptyBoard: 'No tasks yet. Type a title above and press Enter.',
                countTasks: '{n} tasks',
                bannerToday: '{n} due today',
                bannerOverdue: '{n} overdue',
                chipToday: 'Today',
                chipTomorrow: 'Tomorrow',
                chipOverdue: '{n}d overdue',
                'priority.low': 'Low',
                'priority.normal': 'Normal',
                'priority.high': 'High',
                'priority.urgent': 'Urgent',
                'field.status': 'Status',
                'field.priority': 'Priority',
                'field.due': 'Due',
                'field.tags': 'Tags',
                'field.notes': 'Notes',
                'field.title': 'Title',
                groupSchedule: 'Status and schedule',
                groupContent: 'Content',
                tagsPlaceholder: 'Comma separated',
                notesPlaceholder: 'Anything worth remembering…',
                dueClear: 'Clear date',
                subtasks: 'Subtasks',
                subtaskAdd: 'Add a subtask, press Enter',
                subtaskProgress: '{done}/{total}',
                subtaskOnlyOneLevel: 'A subtask cannot hold subtasks',
                close: 'Close',
                deleteTask: 'Delete task',
                created: 'Created {time}',
                saveIdle: '',
                saveSaving: 'Saving…',
                saveSaved: 'Saved',
                saveError: 'Save failed',
                trashEmpty: 'The recycle bin is empty.',
                trashHint: 'Deleted tasks land here first; clearing the bin removes them for good.',
                restore: 'Restore',
                purge: 'Delete forever',
                clearTrash: 'Empty the bin',
                trashCount: '{n} items',
                confirmPurge: 'Delete this task forever? This cannot be undone.',
                confirmClear: 'Empty the recycle bin? This cannot be undone.',
                loadError: 'Could not load',
                retry: 'Retry',
                allTags: 'All tags',
                noticeCreated: 'Created',
                noticeDeleted: 'Moved to the bin',
                noticeRestored: 'Restored',
                noticePurged: 'Deleted forever',
                noticeCleared: 'Bin emptied',
                untitled: '(untitled)',
                done: 'Done',
            },
        };
        let fallbackT = (key) => (DICT.zh[key] === undefined ? key : DICT.zh[key]);
        function useT(props) {
            return typeof props.t === 'function' ? props.t : fallbackT;
        }
        // ------------------------------------------------------------------ data
        async function call(method, payload) {
            const response = await fetch(API + method, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload === undefined ? {} : payload),
            });
            let envelope = null;
            try {
                envelope = await response.json();
            }
            catch (error) {
                envelope = null;
            }
            if (envelope === null || envelope.ok !== true) {
                const message = envelope && envelope.error && envelope.error.message
                    ? envelope.error.message
                    : 'HTTP ' + response.status;
                throw new Error(message);
            }
            return envelope.value;
        }
        function isoDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return year + '-' + month + '-' + day;
        }
        function todayIso() {
            return isoDate(new Date());
        }
        function shiftIso(iso, days) {
            const date = new Date(iso + 'T00:00:00');
            date.setDate(date.getDate() + days);
            return isoDate(date);
        }
        function dayGap(from, to) {
            const a = new Date(from + 'T00:00:00').getTime();
            const b = new Date(to + 'T00:00:00').getTime();
            return Math.round((b - a) / 86400000);
        }
        function dueLabel(due, t) {
            const today = todayIso();
            if (due === today)
                return t('chipToday');
            if (due === shiftIso(today, 1))
                return t('chipTomorrow');
            if (due < today)
                return t('chipOverdue', { n: dayGap(due, today) });
            return due.slice(5);
        }
        function dueTone(due) {
            const today = todayIso();
            if (due === null)
                return '';
            if (due < today)
                return ' tc-tone-late';
            if (due === today)
                return ' tc-tone-today';
            return '';
        }
        function formatTime(iso) {
            const date = new Date(iso);
            if (Number.isNaN(date.getTime()))
                return '';
            const pad = (value) => String(value).padStart(2, '0');
            return (date.getFullYear() +
                '-' +
                pad(date.getMonth() + 1) +
                '-' +
                pad(date.getDate()) +
                ' ' +
                pad(date.getHours()) +
                ':' +
                pad(date.getMinutes()));
        }
        function bySchedule(a, b) {
            const aDue = a.due === null ? '9999-99-99' : a.due;
            const bDue = b.due === null ? '9999-99-99' : b.due;
            if (aDue !== bDue)
                return aDue < bDue ? -1 : 1;
            if (a.priority !== b.priority)
                return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            return a.createdAt.localeCompare(b.createdAt);
        }
        // ------------------------------------------------------------------ icons
        function CheckMark(props) {
            return h('svg', {
                viewBox: '0 0 24 24',
                width: props.size || 12,
                height: props.size || 12,
                'aria-hidden': true,
                className: 'tc-checkmark',
            }, h('path', {
                d: 'M5 12.5l4.4 4.4L19 7.2',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2.6,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
            }));
        }
        function PanelIcon(props) {
            const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20;
            return h('svg', {
                viewBox: '0 0 24 24',
                width: size,
                height: size,
                'aria-hidden': true,
                className: 'tc-panel-icon',
            }, h('rect', {
                x: 3.4,
                y: 3.4,
                width: 17.2,
                height: 17.2,
                rx: 4.6,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.7,
            }), h('path', {
                d: 'M7.8 12.3l2.5 2.5 5.9-6.2',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.9,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
            }));
        }
        function SearchIcon() {
            return h('svg', {
                viewBox: '0 0 24 24',
                width: 13,
                height: 13,
                'aria-hidden': true,
                className: 'tc-search-icon',
            }, h('circle', {
                cx: 10.6,
                cy: 10.6,
                r: 6.1,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.8,
            }), h('path', {
                d: 'M15.2 15.2L20 20',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.8,
                strokeLinecap: 'round',
            }));
        }
        function EmptyIcon() {
            return h('svg', {
                viewBox: '0 0 24 24',
                width: 26,
                height: 26,
                'aria-hidden': true,
                className: 'tc-empty-icon',
            }, h('rect', {
                x: 3.4,
                y: 4.6,
                width: 17.2,
                height: 14.8,
                rx: 3.4,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.6,
            }), h('path', {
                d: 'M7.6 10h8.8M7.6 14h5.4',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.6,
                strokeLinecap: 'round',
            }));
        }
        // ------------------------------------------------------------------ parts
        function TaskCard(props) {
            const task = props.task;
            const subtasks = props.subtasks;
            const t = props.t;
            const finished = subtasks.filter((child) => child.status === 'done').length;
            const hasMeta = task.due !== null ||
                task.tags.length > 0 ||
                subtasks.length > 0 ||
                task.priority !== 'normal';
            const meta = [];
            if (task.priority !== 'normal') {
                meta.push(h('span', { key: 'pri', className: 'tc-pri tc-pri-' + task.priority }, t('priority.' + task.priority)));
            }
            if (task.due !== null) {
                meta.push(h('span', { key: 'due', className: 'tc-due' + dueTone(task.due) }, dueLabel(task.due, t)));
            }
            if (subtasks.length > 0) {
                meta.push(h('span', { key: 'sub', className: 'tc-subtag' }, t('subtaskProgress', { done: finished, total: subtasks.length })));
            }
            for (const name of task.tags) {
                meta.push(h('span', { key: 'tag:' + name, className: 'tc-tag' }, name));
            }
            return h('div', {
                className: 'tc-card' +
                    (task.status === 'done' ? ' tc-card-done' : '') +
                    (props.dragging ? ' tc-card-dragging' : ''),
                'data-priority': task.priority,
                draggable: true,
                role: 'button',
                tabIndex: 0,
                onClick: () => props.onOpen(task.id),
                onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        props.onOpen(task.id);
                    }
                },
                onDragStart: (event) => {
                    event.dataTransfer.setData('text/plain', task.id);
                    event.dataTransfer.effectAllowed = 'move';
                    props.onDragStart(task.id);
                },
                onDragEnd: () => props.onDragEnd(),
            }, h('div', { className: 'tc-card-top' }, h('button', {
                type: 'button',
                className: 'tc-check' + (task.status === 'done' ? ' tc-check-on' : ''),
                title: t('done'),
                'aria-label': t('done'),
                onClick: (event) => {
                    event.stopPropagation();
                    props.onToggle(task);
                },
            }, task.status === 'done' ? h(CheckMark, { size: 11 }) : null), h('span', { className: 'tc-card-title' }, task.title)), hasMeta ? h('div', { className: 'tc-card-meta' }, meta) : null);
        }
        function BoardColumn(props) {
            const t = props.t;
            const tasks = props.tasks;
            return h('section', {
                className: 'tc-col' + (props.active ? ' tc-col-active' : ''),
                'data-status': props.id,
                onDragOver: (event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    props.onHover(props.id);
                },
                onDragLeave: (event) => {
                    if (event.currentTarget.contains(event.relatedTarget))
                        return;
                    props.onHover('');
                },
                onDrop: (event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData('text/plain') || props.dragId;
                    props.onHover('');
                    if (id)
                        props.onDrop(id, props.id);
                },
            }, h('header', { className: 'tc-col-head' }, h('span', { className: 'tc-col-dot', 'aria-hidden': true }), h('span', { className: 'tc-col-name' }, t('column.' + props.id)), h('span', { className: 'tc-col-count' }, String(tasks.length)), h('button', {
                type: 'button',
                className: 'tc-col-add',
                title: t('column.add'),
                'aria-label': t('column.add'),
                onClick: () => props.onAdd(props.id),
            }, '+')), h('div', { className: 'tc-col-body' }, tasks.length === 0
                ? h('p', { className: 'tc-col-empty' }, h(EmptyIcon), h('span', null, t('emptyColumn')))
                : tasks.map((task) => h(TaskCard, {
                    key: task.id,
                    task,
                    t,
                    subtasks: props.childrenOf.get(task.id) || [],
                    dragging: props.dragId === task.id,
                    onOpen: props.onOpen,
                    onToggle: props.onToggle,
                    onDragStart: props.onDragStart,
                    onDragEnd: props.onDragEnd,
                }))));
        }
        function TaskEditor(props) {
            const t = props.t;
            const task = props.task;
            const [form, setForm] = useState(() => ({
                title: task.title,
                notes: task.notes,
                status: task.status,
                priority: task.priority,
                due: task.due === null ? '' : task.due,
                tags: task.tags.join(', '),
            }));
            const [subDraft, setSubDraft] = useState('');
            const [saveState, setSaveState] = useState('idle');
            const timerRef = React.useRef(null);
            const pendingRef = React.useRef(null);
            const patchRef = React.useRef(props.onPatch);
            const disposedRef = React.useRef(false);
            React.useEffect(() => {
                patchRef.current = props.onPatch;
            }, [props.onPatch]);
            const flush = React.useCallback(() => {
                if (timerRef.current !== null) {
                    clearTimeout(timerRef.current);
                    timerRef.current = null;
                }
                const payload = pendingRef.current;
                pendingRef.current = null;
                if (payload === null)
                    return;
                Promise.resolve(patchRef.current(payload)).then((ok) => {
                    if (disposedRef.current)
                        return;
                    setSaveState(ok === false ? 'error' : 'saved');
                }, () => {
                    if (disposedRef.current)
                        return;
                    setSaveState('error');
                });
            }, []);
            React.useEffect(() => () => {
                disposedRef.current = true;
                if (timerRef.current !== null) {
                    clearTimeout(timerRef.current);
                    timerRef.current = null;
                }
                const payload = pendingRef.current;
                pendingRef.current = null;
                if (payload !== null)
                    void patchRef.current(payload);
            }, []);
            const stage = (patch) => {
                setForm((previous) => {
                    const next = Object.assign({}, previous, patch);
                    const payload = { notes: next.notes, status: next.status, priority: next.priority, due: next.due === '' ? null : next.due, tags: splitTags(next.tags) };
                    if (next.title.trim() !== '')
                        payload.title = next.title.trim();
                    pendingRef.current = payload;
                    return next;
                });
                setSaveState('saving');
                if (timerRef.current !== null)
                    clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => {
                    timerRef.current = null;
                    const payload = pendingRef.current;
                    pendingRef.current = null;
                    if (payload === null)
                        return;
                    Promise.resolve(patchRef.current(payload)).then((ok) => {
                        if (disposedRef.current)
                            return;
                        setSaveState(ok === false ? 'error' : 'saved');
                    }, () => {
                        if (disposedRef.current)
                            return;
                        setSaveState('error');
                    });
                }, 420);
            };
            const addSubtask = () => {
                const title = subDraft.trim();
                if (title === '')
                    return;
                setSubDraft('');
                void props.onCreateSubtask(title);
            };
            const saveText = {
                idle: t('saveIdle'),
                saving: t('saveSaving'),
                saved: t('saveSaved'),
                error: t('saveError'),
            }[saveState];
            return h('aside', {
                className: 'tc-drawer',
                role: 'dialog',
                'aria-modal': true,
                'aria-label': t('field.title'),
                onKeyDown: (event) => {
                    if (event.key === 'Escape')
                        props.onClose();
                },
            }, h('header', { className: 'tc-drawer-head' }, h('input', {
                className: 'tc-drawer-title',
                value: form.title,
                placeholder: t('field.title'),
                'aria-label': t('field.title'),
                onChange: (event) => stage({ title: event.target.value }),
                onBlur: flush,
            }), h('button', { type: 'button', className: 'tc-iconbtn', title: t('close'), 'aria-label': t('close'), onClick: props.onClose }, '\u00d7')), h('div', { className: 'tc-drawer-body' }, h('section', { className: 'tc-group' }, h('span', { className: 'tc-group-title' }, t('groupSchedule')), h('div', { className: 'tc-field' }, h('span', { className: 'tc-label' }, t('field.status')), h('div', { className: 'tc-seg' }, COLUMNS.map((id) => h('button', {
                key: id,
                type: 'button',
                className: 'tc-seg-btn' + (form.status === id ? ' tc-seg-on' : ''),
                onClick: () => stage({ status: id }),
            }, t('column.' + id))))), h('div', { className: 'tc-field-row' }, h('label', { className: 'tc-field tc-field-half' }, h('span', { className: 'tc-label' }, t('field.priority')), h('select', {
                className: 'tc-input',
                value: form.priority,
                onChange: (event) => stage({ priority: event.target.value }),
            }, PRIORITIES.map((id) => h('option', { key: id, value: id }, t('priority.' + id))))), h('label', { className: 'tc-field tc-field-half' }, h('span', { className: 'tc-label' }, t('field.due')), h('input', {
                type: 'date',
                className: 'tc-input',
                value: form.due,
                onChange: (event) => stage({ due: event.target.value }),
            })))), h('section', { className: 'tc-group' }, h('span', { className: 'tc-group-title' }, t('groupContent')), h('label', { className: 'tc-field' }, h('span', { className: 'tc-label' }, t('field.tags')), h('input', {
                className: 'tc-input',
                value: form.tags,
                placeholder: t('tagsPlaceholder'),
                onChange: (event) => stage({ tags: event.target.value }),
                onBlur: flush,
            })), h('label', { className: 'tc-field' }, h('span', { className: 'tc-label' }, t('field.notes')), h('textarea', {
                className: 'tc-input tc-textarea',
                value: form.notes,
                rows: 4,
                placeholder: t('notesPlaceholder'),
                onChange: (event) => stage({ notes: event.target.value }),
                onBlur: flush,
            }))), h('section', { className: 'tc-group' }, h('span', { className: 'tc-group-title' }, t('subtasks')), h('div', { className: 'tc-sublist' }, props.subtasks.length === 0
                ? h('p', { className: 'tc-hint' }, t('subtaskAdd'))
                : props.subtasks.map((child) => h('div', { key: child.id, className: 'tc-subrow' }, h('button', {
                    type: 'button',
                    className: 'tc-check tc-check-sm' + (child.status === 'done' ? ' tc-check-on' : ''),
                    'aria-label': t('done'),
                    onClick: () => props.onToggleSubtask(child),
                }, child.status === 'done' ? h(CheckMark, { size: 9 }) : null), h('span', {
                    className: 'tc-subtext' + (child.status === 'done' ? ' tc-subtext-done' : ''),
                    onClick: () => props.onOpenTask(child.id),
                }, child.title), h('button', {
                    type: 'button',
                    className: 'tc-iconbtn tc-iconbtn-sm',
                    'aria-label': t('deleteTask'),
                    onClick: () => props.onDeleteSubtask(child.id),
                }, '\u00d7'))), h('input', {
                className: 'tc-input tc-subinput',
                value: subDraft,
                placeholder: t('subtaskAdd'),
                onChange: (event) => setSubDraft(event.target.value),
                onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        addSubtask();
                    }
                },
            })))), h('footer', { className: 'tc-drawer-foot' }, h('span', { className: 'tc-stamp' }, t('created', { time: formatTime(task.createdAt) })), h('span', { className: 'tc-savestate' }, saveText), h('button', { type: 'button', className: 'tc-btn tc-btn-danger', onClick: () => props.onDelete(task.id) }, t('deleteTask'))));
        }
        function ListView(props) {
            const t = props.t;
            return h('div', { className: 'tc-list' }, props.roots.length === 0
                ? h('div', { className: 'tc-empty' }, h(EmptyIcon), h('span', null, t('emptyBoard')))
                : props.roots.map((task) => {
                    const subtasks = props.childrenOf.get(task.id) || [];
                    const finished = subtasks.filter((child) => child.status === 'done').length;
                    return h('div', { key: task.id, className: 'tc-row' + (task.status === 'done' ? ' tc-row-done' : '') }, h('button', {
                        type: 'button',
                        className: 'tc-check' + (task.status === 'done' ? ' tc-check-on' : ''),
                        'aria-label': t('done'),
                        onClick: () => props.onToggle(task),
                    }, task.status === 'done' ? h(CheckMark, { size: 11 }) : null), h('button', { type: 'button', className: 'tc-row-title', onClick: () => props.onOpen(task.id) }, task.title), task.due === null
                        ? null
                        : h('span', { className: 'tc-due' + dueTone(task.due) }, dueLabel(task.due, t)), subtasks.length === 0
                        ? null
                        : h('span', { className: 'tc-subtag' }, t('subtaskProgress', { done: finished, total: subtasks.length })), task.tags.length === 0
                        ? null
                        : h('span', { className: 'tc-tags' }, task.tags.map((name) => h('span', { key: name, className: 'tc-tag' }, name))), h('select', {
                        className: 'tc-input tc-select-sm',
                        value: task.status,
                        'aria-label': t('field.status'),
                        onChange: (event) => props.onMove(task.id, event.target.value),
                    }, COLUMNS.map((id) => h('option', { key: id, value: id }, t('column.' + id)))));
                }));
        }
        function TrashView(props) {
            const t = props.t;
            return h('div', { className: 'tc-trash' }, h('div', { className: 'tc-trash-head' }, h('p', { className: 'tc-hint' }, t('trashHint')), props.trash.length === 0
                ? null
                : h('button', {
                    type: 'button',
                    className: 'tc-btn tc-btn-danger',
                    onClick: () => {
                        if (window.confirm(t('confirmClear')))
                            props.onClear();
                    },
                }, t('clearTrash'))), props.trash.length === 0
                ? h('div', { className: 'tc-empty' }, h(EmptyIcon), h('span', { className: 'tc-empty-title' }, t('trashEmpty')))
                : props.trash.map((task) => h('div', { key: task.id, className: 'tc-row' }, h('span', { className: 'tc-row-title tc-row-static' }, task.title || t('untitled')), h('span', { className: 'tc-stamp' }, formatTime(task.deletedAt)), h('button', { type: 'button', className: 'tc-btn', onClick: () => props.onRestore(task.id) }, t('restore')), h('button', {
                    type: 'button',
                    className: 'tc-btn tc-btn-danger',
                    onClick: () => {
                        if (window.confirm(t('confirmPurge')))
                            props.onPurge(task.id);
                    },
                }, t('purge')))));
        }
        // ------------------------------------------------------------------ panel
        function TaskCenterPage(props) {
            const t = useT(props);
            const [board, setBoard] = useState(null);
            const [phase, setPhase] = useState('loading');
            const [failure, setFailure] = useState('');
            const [mode, setMode] = useState('board');
            const [query, setQuery] = useState('');
            const [tag, setTag] = useState('');
            const [openId, setOpenId] = useState('');
            const [draft, setDraft] = useState('');
            const [draftStatus, setDraftStatus] = useState('todo');
            const [notice, setNotice] = useState(null);
            const [dragId, setDragId] = useState('');
            const [dropZone, setDropZone] = useState('');
            const addRef = React.useRef(null);
            const refresh = React.useCallback(async () => {
                try {
                    const value = await call('list', {});
                    setBoard(value);
                    setPhase('ready');
                    setFailure('');
                }
                catch (error) {
                    setPhase('error');
                    setFailure(error && error.message ? error.message : String(error));
                }
            }, []);
            React.useEffect(() => {
                void refresh();
            }, [refresh]);
            React.useEffect(() => {
                if (notice === null)
                    return undefined;
                const timer = setTimeout(() => setNotice(null), 2600);
                return () => clearTimeout(timer);
            }, [notice]);
            const mutate = React.useCallback(async (method, payload) => {
                try {
                    await call(method, payload);
                    await refresh();
                    return true;
                }
                catch (error) {
                    setNotice({ kind: 'error', text: error && error.message ? error.message : String(error) });
                    return false;
                }
            }, [refresh]);
            const tasks = board !== null && Array.isArray(board.tasks) ? board.tasks : [];
            const trash = board !== null && Array.isArray(board.trash) ? board.trash : [];
            const tags = React.useMemo(() => {
                const seen = new Set();
                for (const task of tasks)
                    for (const name of task.tags)
                        seen.add(name);
                return Array.from(seen).sort((a, b) => a.localeCompare(b));
            }, [tasks]);
            const filtered = React.useMemo(() => {
                const needle = query.trim().toLowerCase();
                return tasks.filter((task) => {
                    if (tag !== '' && task.tags.indexOf(tag) === -1)
                        return false;
                    if (needle === '')
                        return true;
                    if (task.title.toLowerCase().indexOf(needle) !== -1)
                        return true;
                    if (task.notes.toLowerCase().indexOf(needle) !== -1)
                        return true;
                    return task.tags.some((name) => name.toLowerCase().indexOf(needle) !== -1);
                });
            }, [tasks, query, tag]);
            const roots = React.useMemo(() => {
                const visible = new Set(filtered.map((task) => task.id));
                const list = filtered.filter((task) => task.parentId === null || !visible.has(task.parentId));
                list.sort(bySchedule);
                return list;
            }, [filtered]);
            const childrenOf = React.useMemo(() => {
                const map = new Map();
                for (const task of filtered) {
                    if (task.parentId === null)
                        continue;
                    const bucket = map.get(task.parentId);
                    if (bucket)
                        bucket.push(task);
                    else
                        map.set(task.parentId, [task]);
                }
                for (const bucket of map.values())
                    bucket.sort(bySchedule);
                return map;
            }, [filtered]);
            const columnTasks = React.useMemo(() => {
                const map = { todo: [], doing: [], blocked: [], done: [] };
                for (const task of roots)
                    map[task.status].push(task);
                return map;
            }, [roots]);
            const reminders = React.useMemo(() => {
                const today = todayIso();
                let late = 0;
                let dueToday = 0;
                for (const task of tasks) {
                    if (task.due === null || task.status === 'done')
                        continue;
                    if (task.due < today)
                        late += 1;
                    else if (task.due === today)
                        dueToday += 1;
                }
                return { late, dueToday };
            }, [tasks]);
            const openTask = openId === '' ? null : tasks.find((task) => task.id === openId) || null;
            const openSubtasks = openTask === null ? [] : childrenOf.get(openTask.id) || [];
            const createTask = async (title, status) => {
                const value = title.trim();
                if (value === '')
                    return false;
                const ok = await mutate('create', { title: value, status });
                if (ok)
                    setNotice({ kind: 'ok', text: t('noticeCreated') });
                return ok;
            };
            const submitDraft = async () => {
                const ok = await createTask(draft, draftStatus);
                if (ok)
                    setDraft('');
            };
            const toggleTask = (task) => {
                void mutate('update', { id: task.id, status: task.status === 'done' ? 'todo' : 'done' });
            };
            const moveTask = (id, status) => {
                if (!id)
                    return;
                void mutate('update', { id, status });
            };
            const deleteTask = async (id) => {
                const ok = await mutate('delete', { id });
                if (ok) {
                    setOpenId('');
                    setNotice({ kind: 'ok', text: t('noticeDeleted') });
                }
            };
            const patchOpen = async (payload) => {
                if (openTask === null)
                    return false;
                return mutate('update', Object.assign({ id: openTask.id }, payload));
            };
            const focusAdd = (status) => {
                setDraftStatus(status);
                if (addRef.current !== null)
                    addRef.current.focus();
            };
            if (phase === 'loading') {
                return h('div', { className: 'tc-root' }, h('div', { className: 'tc-center' }, h('p', { className: 'tc-hint' }, t('title') + '\u2026')));
            }
            if (phase === 'error') {
                return h('div', { className: 'tc-root' }, h('div', { className: 'tc-center' }, h('p', { className: 'tc-error' }, t('loadError')), h('p', { className: 'tc-hint' }, failure), h('button', { type: 'button', className: 'tc-btn', onClick: () => void refresh() }, t('retry'))));
            }
            const banner = [];
            if (reminders.late > 0) {
                banner.push(h('span', { key: 'late', className: 'tc-pill tc-pill-late' }, t('bannerOverdue', { n: reminders.late })));
            }
            if (reminders.dueToday > 0) {
                banner.push(h('span', { key: 'today', className: 'tc-pill tc-pill-today' }, t('bannerToday', { n: reminders.dueToday })));
            }
            const body = mode === 'trash'
                ? h(TrashView, {
                    t,
                    trash,
                    onRestore: (id) => {
                        void mutate('restore', { id }).then((ok) => {
                            if (ok)
                                setNotice({ kind: 'ok', text: t('noticeRestored') });
                        });
                    },
                    onPurge: (id) => {
                        void mutate('purge', { id }).then((ok) => {
                            if (ok)
                                setNotice({ kind: 'ok', text: t('noticePurged') });
                        });
                    },
                    onClear: () => {
                        void mutate('emptyTrash', {}).then((ok) => {
                            if (ok)
                                setNotice({ kind: 'ok', text: t('noticeCleared') });
                        });
                    },
                })
                : mode === 'list'
                    ? h(ListView, {
                        t,
                        roots,
                        childrenOf,
                        onOpen: setOpenId,
                        onToggle: toggleTask,
                        onMove: moveTask,
                    })
                    : h('div', { className: 'tc-board' }, COLUMNS.map((id) => h(BoardColumn, {
                        key: id,
                        id,
                        t,
                        tasks: columnTasks[id],
                        childrenOf,
                        dragId,
                        active: dropZone === id,
                        onAdd: focusAdd,
                        onOpen: setOpenId,
                        onToggle: toggleTask,
                        onDragStart: setDragId,
                        onDragEnd: () => {
                            setDragId('');
                            setDropZone('');
                        },
                        onHover: setDropZone,
                        onDrop: moveTask,
                    })));
            return h('div', { className: 'tc-root' }, h('header', { className: 'tc-head' }, h('div', { className: 'tc-head-row' }, h('h1', { className: 'tc-heading' }, t('title')), h('span', { className: 'tc-count' }, t('countTasks', { n: roots.length })), h('div', { className: 'tc-views' }, ['board', 'list', 'trash'].map((id) => h('button', {
                key: id,
                type: 'button',
                className: 'tc-view-btn' + (mode === id ? ' tc-view-on' : ''),
                onClick: () => setMode(id),
            }, t(id === 'board' ? 'viewBoard' : id === 'list' ? 'viewList' : 'viewTrash'))))), h('div', { className: 'tc-head-row' }, h('div', { className: 'tc-addbar' }, h('input', {
                ref: addRef,
                className: 'tc-input tc-addinput',
                value: draft,
                placeholder: t('newPlaceholder'),
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitDraft();
                    }
                },
            }), h('select', {
                className: 'tc-input tc-select-sm',
                value: draftStatus,
                'aria-label': t('field.status'),
                onChange: (event) => setDraftStatus(event.target.value),
            }, COLUMNS.map((id) => h('option', { key: id, value: id }, t('column.' + id)))), h('button', { type: 'button', className: 'tc-btn tc-btn-primary', onClick: () => void submitDraft() }, t('create'))), h('div', { className: 'tc-searchwrap' }, h(SearchIcon), h('input', {
                className: 'tc-input tc-search',
                value: query,
                placeholder: t('search'),
                'aria-label': t('search'),
                onChange: (event) => setQuery(event.target.value),
            })), tags.length === 0
                ? null
                : h('select', {
                    className: 'tc-input tc-select-sm',
                    value: tag,
                    'aria-label': t('allTags'),
                    onChange: (event) => setTag(event.target.value),
                }, h('option', { value: '' }, t('allTags')), tags.map((name) => h('option', { key: name, value: name }, name)))), banner.length === 0 ? null : h('div', { className: 'tc-banner' }, banner)), h('div', { className: 'tc-body' }, body), openTask === null
                ? null
                : h('div', {
                    className: 'tc-scrim',
                    'aria-hidden': true,
                    onClick: () => setOpenId(''),
                }), openTask === null
                ? null
                : h(TaskEditor, {
                    key: openTask.id,
                    t,
                    task: openTask,
                    subtasks: openSubtasks,
                    onClose: () => setOpenId(''),
                    onPatch: patchOpen,
                    onCreateSubtask: async (title) => {
                        if (openTask.parentId !== null) {
                            setNotice({ kind: 'error', text: t('subtaskOnlyOneLevel') });
                            return;
                        }
                        const ok = await mutate('create', { title, parentId: openTask.id, status: 'todo' });
                        if (ok)
                            setNotice({ kind: 'ok', text: t('noticeCreated') });
                    },
                    onToggleSubtask: (child) => {
                        void mutate('update', { id: child.id, status: child.status === 'done' ? 'todo' : 'done' });
                    },
                    onDeleteSubtask: (id) => {
                        void mutate('delete', { id });
                    },
                    onOpenTask: (id) => setOpenId(id),
                    onDelete: deleteTask,
                }), notice === null
                ? null
                : h('div', { className: 'tc-notice' + (notice.kind === 'error' ? ' tc-notice-error' : '') }, notice.text));
        }
        function splitTags(raw) {
            return raw
                .split(/[,，、\s]+/)
                .map((value) => value.trim())
                .filter((value) => value !== '');
        }
        // ------------------------------------------------------------------ style
        const PACKAGE_ID = 'dsh-task-center';
        const STYLE_ID = PACKAGE_ID + '/client.css';
        const CSS = `
.tc-root{--tc-priority:var(--dsw-alias-border-l2);position:relative;display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:hidden}
.tc-root *,.tc-root *::before,.tc-root *::after{box-sizing:border-box}

/* ---------------------------------------------------------------- header */
.tc-head{display:flex;flex-direction:column;gap:10px;padding:14px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.tc-head-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tc-heading{margin:0;font-size:13px;font-weight:600;letter-spacing:.01em;line-height:1.4}
.tc-count{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}

.tc-views{display:flex;gap:2px;margin-left:auto;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.tc-view-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.4;padding:4px 11px;border-radius:7px;cursor:pointer;transition:color .12s ease,background .12s ease}
.tc-view-btn:hover{color:var(--dsw-alias-label-primary)}
.tc-view-on{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:1px solid var(--dsw-alias-border-l1);outline-offset:-1px}

.tc-addbar{display:flex;align-items:center;gap:6px;flex:1 1 320px;min-width:240px}
.tc-addinput{flex:1 1 auto}

/* ---------------------------------------------------------------- inputs */
.tc-input{appearance:none;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 9px;min-width:0;outline:none;transition:border-color .12s ease,outline-color .12s ease}
.tc-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.75}
.tc-input:hover{border-color:var(--dsw-alias-border-l2)}
.tc-input:focus{border-color:var(--dsw-alias-brand-primary);outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent);outline-offset:0}
.tc-select-sm{flex:0 0 auto;font-size:12px;padding:5px 7px;cursor:pointer}

.tc-searchwrap{position:relative;display:flex;align-items:center;flex:0 1 230px;min-width:150px}
.tc-search-icon{position:absolute;left:9px;width:13px;height:13px;color:var(--dsw-alias-label-secondary);pointer-events:none}
.tc-search{width:100%;padding-left:27px;font-size:12px}

/* --------------------------------------------------------------- buttons */
.tc-btn{appearance:none;font:inherit;font-size:12px;line-height:1.4;padding:5px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease}
.tc-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.tc-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:500}
.tc-btn-primary:hover{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);opacity:.88}
.tc-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,var(--dsw-alias-border-l1))}
.tc-btn-danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);border-color:var(--dsw-alias-state-error-primary)}

/* ---------------------------------------------------------------- banner */
.tc-banner{display:flex;gap:6px;flex-wrap:wrap;padding-top:2px}
.tc-pill{font-size:12px;line-height:1.4;padding:2px 9px;border-radius:999px;border:1px solid transparent;font-variant-numeric:tabular-nums}
.tc-pill-late{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 11%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 26%,transparent)}
.tc-pill-today{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 26%,transparent)}

/* ------------------------------------------------------------------ body */
.tc-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 18px 24px}
.tc-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}

.tc-col{display:flex;flex-direction:column;min-width:0;min-height:120px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);transition:border-color .12s ease,background .12s ease}
.tc-col-active{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,var(--dsw-alias-bg-layer-1))}
.tc-col-head{display:flex;align-items:center;gap:7px;padding:9px 11px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-col-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.tc-col[data-status="doing"] .tc-col-dot{background:var(--dsw-alias-brand-primary)}
.tc-col[data-status="blocked"] .tc-col-dot{background:var(--dsw-alias-state-warn-primary)}
.tc-col[data-status="done"] .tc-col-dot{background:var(--dsw-alias-state-success-primary)}
.tc-col-name{font-size:12px;font-weight:600;letter-spacing:.01em;white-space:nowrap}
.tc-col-count{min-width:19px;height:19px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;font-variant-numeric:tabular-nums}
.tc-col-add{margin-left:auto;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;padding:0 4px 1px;cursor:pointer;border-radius:6px;transition:color .12s ease,background .12s ease}
.tc-col-add:hover{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}

.tc-col-body{display:flex;flex-direction:column;gap:7px;padding:9px;min-height:60px}

/* ----------------------------------------------------------------- cards */
.tc-card{position:relative;display:flex;flex-direction:column;gap:6px;padding:8px 10px 8px 13px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);cursor:pointer;transition:transform .14s ease,border-color .14s ease,background .14s ease}
.tc-card::before{content:"";position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:0 2px 2px 0;background:var(--tc-priority)}
.tc-card[data-priority="urgent"]{--tc-priority:var(--dsw-alias-state-error-primary)}
.tc-card[data-priority="high"]{--tc-priority:var(--dsw-alias-state-warn-primary)}
.tc-card[data-priority="normal"]{--tc-priority:var(--dsw-alias-brand-primary)}
.tc-card[data-priority="low"]{--tc-priority:var(--dsw-alias-border-l2)}
.tc-card:hover{transform:translateY(-1px);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.tc-card:active{transform:translateY(0)}
.tc-card-dragging{opacity:.45;transform:none}
.tc-card-done .tc-card-title{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}
.tc-card-top{display:flex;align-items:flex-start;gap:7px}
.tc-card-title{font-size:13px;line-height:1.45;word-break:break-word;min-width:0}
.tc-card-meta{display:flex;align-items:center;gap:5px;flex-wrap:wrap;padding-left:22px}

.tc-check{flex:0 0 auto;width:15px;height:15px;margin-top:2px;display:inline-flex;align-items:center;justify-content:center;appearance:none;padding:0;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-bg-base);cursor:pointer;transition:border-color .12s ease,background .12s ease}
.tc-check:hover{border-color:var(--dsw-alias-brand-primary)}
.tc-check-on{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.tc-check-on:hover{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.tc-check-sm{width:13px;height:13px;margin-top:0}
.tc-checkmark{display:block}

/* ------------------------------------------------------------ card meta */
.tc-pri{font-size:12px;line-height:1.4;padding:0 6px;border-radius:5px;border:1px solid transparent}
.tc-pri-urgent{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 24%,transparent)}
.tc-pri-high{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 24%,transparent)}
.tc-pri-low{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}
.tc-due{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.tc-tone-late{color:var(--dsw-alias-state-error-primary);font-weight:500}
.tc-tone-today{color:var(--dsw-alias-state-warn-primary);font-weight:500}
.tc-subtag{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);padding:0 6px;border-radius:5px;font-variant-numeric:tabular-nums}
.tc-tag{font-size:12px;line-height:1.4;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent);padding:0 7px;border-radius:999px;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis}
.tc-tags{display:inline-flex;gap:4px;flex-wrap:wrap;min-width:0}

/* ------------------------------------------------------------- list view */
.tc-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.tc-row{display:flex;align-items:center;gap:9px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);transition:background .12s ease}
.tc-row:last-child{border-bottom:0}
.tc-row:hover{background:var(--dsw-alias-bg-layer-2)}
.tc-row-title{flex:1 1 auto;min-width:0;appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;padding:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-row-static{cursor:default}
.tc-row-done .tc-row-title{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}

/* ------------------------------------------------------------ trash view */
.tc-trash{display:flex;flex-direction:column;gap:12px}
.tc-trash-head{display:flex;align-items:center;gap:10px}
.tc-trash-head .tc-btn{margin-left:auto}
.tc-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.tc-error{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-state-error-primary)}
.tc-center{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px}

/* ----------------------------------------------------------- empty state */
.tc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:34px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.tc-empty-icon{width:26px;height:26px;opacity:.55}
.tc-empty-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);opacity:.85}
.tc-col-empty{margin:0;padding:16px 8px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l2);border-radius:9px;opacity:.75}
.tc-col-empty .tc-empty-icon{width:18px;height:18px}

/* ---------------------------------------------------------------- drawer */
.tc-scrim{position:absolute;inset:0;background:color-mix(in srgb,var(--dsw-alias-bg-base) 58%,transparent);z-index:5;animation:tc-fade-in .16s ease-out}
.tc-drawer{position:absolute;top:0;right:0;bottom:0;width:min(400px,94%);display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);z-index:6;animation:tc-slide-in .18s ease-out}
@keyframes tc-slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}}
@keyframes tc-fade-in{from{opacity:0}to{opacity:1}}
.tc-drawer-head{display:flex;align-items:center;gap:6px;padding:12px 12px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.tc-drawer-title{flex:1 1 auto;min-width:0;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;line-height:1.4;padding:4px 5px;border-radius:7px;outline:none}
.tc-drawer-title:focus{background:var(--dsw-alias-bg-base);outline:1px solid var(--dsw-alias-border-l2);outline-offset:-1px}
.tc-drawer-body{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:12px}
.tc-drawer-foot{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.tc-drawer-foot .tc-btn{margin-left:auto}

/* ----------------------------------------------------------------- fields */
.tc-group{display:flex;flex-direction:column;gap:9px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-base)}
.tc-group-title{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}
.tc-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.tc-field-row{display:flex;gap:10px}
.tc-field-half{flex:1 1 0;min-width:0}
.tc-label{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.tc-textarea{resize:vertical;min-height:72px;font-family:inherit;line-height:1.55;font-size:13px}
.tc-seg{display:flex;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.tc-seg-btn{flex:1 1 0;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.4;padding:5px 2px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:color .12s ease,background .12s ease}
.tc-seg-btn:hover{color:var(--dsw-alias-label-primary)}
.tc-seg-on{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:1px solid var(--dsw-alias-border-l1);outline-offset:-1px}

.tc-sublist{display:flex;flex-direction:column;gap:3px}
.tc-subrow{display:flex;align-items:center;gap:8px;padding:4px 3px;border-radius:7px}
.tc-subrow:hover{background:var(--dsw-alias-bg-layer-2)}
.tc-subtext{flex:1 1 auto;min-width:0;font-size:13px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-subtext-done{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}
.tc-subinput{margin-top:5px;font-size:12px}

.tc-iconbtn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;padding:3px 7px;border-radius:7px;cursor:pointer;transition:background .12s ease,color .12s ease}
.tc-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.tc-iconbtn-sm{font-size:13px;padding:1px 5px}

.tc-stamp{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tc-savestate{font-size:12px;color:var(--dsw-alias-label-secondary);margin-left:auto;white-space:nowrap}

/* ----------------------------------------------------------------- notice */
.tc-notice{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);padding:7px 15px;border-radius:999px;font-size:12px;line-height:1.4;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);z-index:9;pointer-events:none;animation:tc-fade-in .16s ease-out;max-width:min(520px,90%);text-align:center}
.tc-notice-error{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,var(--dsw-alias-border-l2))}

/* ------------------------------------------------------------ focus ring */
.tc-root :where(button,input,select,textarea,[tabindex]):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}

/* ------------------------------------------------------------ responsive */
@media (max-width:960px){.tc-board{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.tc-board{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){.tc-card,.tc-drawer,.tc-scrim,.tc-notice{transition:none;animation:none}.tc-card:hover{transform:none}}
`;
        // Static Client halves receive no `styles` builtin (that symbol belongs to
        // dynamic halves) and `styles` is absent from the module-table seed, so the
        // package ships its own tag. The module system claims it by data-plugin and
        // removes it on unload; insertion stays idempotent across HMR re-runs.
        if (typeof document !== 'undefined') {
            const selector = 'style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']';
            if (document.querySelector(selector) === null) {
                const tag = document.createElement('style');
                tag.dataset.plugin = PACKAGE_ID;
                tag.dataset.pluginCss = STYLE_ID;
                tag.textContent = CSS;
                document.head.appendChild(tag);
            }
        }
        // -------------------------------------------------------------- lifecycle
        function apply(ctx) {
            let bound = null;
            try {
                ctx.locale.register(NS, DICT);
                bound = ctx.locale.bind(NS);
            }
            catch (error) {
                bound = null;
            }
            if (typeof bound === 'function') {
                fallbackT = bound;
            }
            ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => (fallbackT('nav')), locale: NS }, PanelIcon));
            ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, TaskCenterPage));
        }
        const name = 'task-center';
        return { inject: ['slots', 'locale'], apply, name };
    },
});
