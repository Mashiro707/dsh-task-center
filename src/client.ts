window.__ModuleLoader__.load({
  id: 'dsh-task-center',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'dsh-task-center'
    const PANEL_ID = 'task-center'
    const PANEL_ORDER = 6
    const API = '/task-center/api/'
    const COLUMNS = ['todo', 'doing', 'blocked', 'done']
    const PRIORITIES = ['low', 'normal', 'high', 'urgent']
    const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 }

    // An open list is portalled when react-dom is reachable, so neither the
    // scrolling board nor the drawer can clip it; otherwise it expands in place.
    let createPortal: ((node: unknown, container: Element) => any) | null = null
    try {
      const reactDom = require('react-dom')
      if (reactDom !== null && typeof reactDom.createPortal === 'function') {
        createPortal = reactDom.createPortal
      }
    } catch (error) {
      createPortal = null
    }

    interface DropdownOption {
      value: string
      label: string
    }

    interface DropdownPlacement {
      left: number
      width: number
      top: number | null
      bottom: number | null
      maxHeight: number
    }

    interface DropdownProps {
      value: string
      options: DropdownOption[]
      onChange: (value: string) => void
      className?: string
      ariaLabel?: string
      title?: string
      disabled?: boolean
    }

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
        groupDeps: '依赖',
        groupStages: '阶段',
        stageHint: '每个阶段先写文档，你批准之后才会执行。',
        stageDraft: '待规划',
        stageAwait: '待批准',
        stageApproved: '已批准',
        stageRunning: '执行中',
        stageDone: '已完成',
        stageFailed: '失败',
        approve: '批准',
        reject: '驳回',
        viewDoc: '查看文档',
        crashTitle: '面板出错了，错误详情已记录到任务板（[client-error] 开头的任务）。',
        hideDoc: '收起文档',
        docEmpty: '文档还没生成。',
        awaitBadge: '待批准',
        noticeApproved: '已批准，开跑就会按文档执行。',
        noticeRejected: '已驳回，这一阶段会重新规划。',
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
        run: '开跑',
        running: '运行中',
        cancelRun: '停止',
        runFailed: '上次运行失败',
        runDone: '跑过一次',
        autoRun: '自动开跑',
        autoRunOn: '自动：开',
        autoRunOff: '自动：关',
        autoRunHint: '任务进入「进行中」时自动拉起一个智能体',
        queued: '排队中',
        cancelQueued: '取消排队',
        queueHint: '同时最多跑 {n} 个，其余的在这里等',
        'field.timeout': '超时',
        timeoutHint: '单次运行最多多少分钟，0 表示不限',
        'field.retries': '重试',
        retriesHint: '失败或超时后再试几次',
        'field.blockers': '前置任务',
        blockersHint: '这些都完成之后，这个任务才会开跑',
        noBlockers: '没有可选的前置任务',
        blockerPending: '等 {n} 个前置任务',
        noticeQueued: '已排队',
        noticeUnblocked: '前置已完成，已开跑',
        'field.cwd': '工作目录',
        cwdPlaceholder: '绝对路径，例如 D:\\code\\my-project',
        cwdHint: '开跑时智能体就在这个目录里工作',
        noCwd: '先设置工作目录，再开跑',
        noticeRun: '已拉起智能体',
        noticeCanceled: '已停止',
        noticeSettings: '设置已保存',
        'field.workspace': '工作区',
        workspaceHint: '这个任务拉起的智能体都在该目录里工作',
        pickWorkspace: '选择一个工作区',
        noWorkspace: '（未指定）',
        newDir: '登记新目录',
        newDirPlaceholder: '已存在的绝对路径，例如 D:\\code\\my-project',
        addWorkspace: '登记',
        workspaceInvalid: '目录登记失败',
        'field.permission': '权限',
        permissionInherit: '跟随全局（{name}）',
        permissionHint: '只影响这个任务拉起的智能体',
        'field.autoApprove': '自动批准',
        autoApproveOn: '工作区内放行',
        autoApproveOff: '每次都问我',
        autoApproveHint: '只放行工作区内的工具调用，越界的直接拒绝；开着它时，比 workspace-write 更宽的权限预设会被收窄',
        needWorkspace: '先选一个工作区，再建任务',
        targetWs: '新建到',
        noWorkspaceRun: '这个任务还没有工作区，先指定一个再开跑',
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
        groupDeps: 'Dependencies',
        groupStages: 'Stages',
        stageHint: 'Each stage writes a document first; it runs only after you approve it.',
        stageDraft: 'To plan',
        stageAwait: 'Awaiting approval',
        stageApproved: 'Approved',
        stageRunning: 'Running',
        stageDone: 'Done',
        stageFailed: 'Failed',
        approve: 'Approve',
        reject: 'Reject',
        viewDoc: 'View document',
        crashTitle: 'The panel hit an error; the details were filed on the board as a [client-error] task.',
        hideDoc: 'Hide document',
        docEmpty: 'No document yet.',
        awaitBadge: 'Awaiting approval',
        noticeApproved: 'Approved — the next run follows the document.',
        noticeRejected: 'Rejected — this stage will be planned again.',
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
        run: 'Run',
        running: 'Running',
        cancelRun: 'Stop',
        runFailed: 'Last run failed',
        runDone: 'Ran once',
        autoRun: 'Auto-run',
        autoRunOn: 'Auto: on',
        autoRunOff: 'Auto: off',
        autoRunHint: 'Start an agent by itself when a task moves to Doing',
        queued: 'Queued',
        cancelQueued: 'Leave the queue',
        queueHint: 'At most {n} run at once; the rest wait here',
        'field.timeout': 'Timeout',
        timeoutHint: 'Minutes one attempt may take; 0 means no limit',
        'field.retries': 'Retries',
        retriesHint: 'Extra attempts after a failure or a timeout',
        'field.blockers': 'Blocked by',
        blockersHint: 'This task starts only after those are done',
        noBlockers: 'No other task can be picked',
        blockerPending: 'Waiting on {n} task(s)',
        noticeQueued: 'Queued',
        noticeUnblocked: 'Blockers cleared, agent started',
        'field.cwd': 'Working directory',
        cwdPlaceholder: 'Absolute path, for example D:\\code\\my-project',
        cwdHint: 'The agent works in this directory when the task runs',
        noCwd: 'Set a working directory before running',
        noticeRun: 'Agent started',
        noticeCanceled: 'Stopped',
        noticeSettings: 'Settings saved',
        'field.workspace': 'Workspace',
        workspaceHint: 'Agents started by this task work inside that directory',
        pickWorkspace: 'Pick a workspace',
        noWorkspace: '(none)',
        newDir: 'Register a directory',
        newDirPlaceholder: 'An existing absolute path, for example D:\\code\\my-project',
        addWorkspace: 'Register',
        workspaceInvalid: 'Could not register that directory',
        'field.permission': 'Permission',
        permissionInherit: 'Follow the global setting ({name})',
        permissionHint: 'Only affects agents started by this task',
        'field.autoApprove': 'Auto-approve',
        autoApproveOn: 'Allow inside the workspace',
        autoApproveOff: 'Ask me every time',
        autoApproveHint: 'Allows tool calls inside the workspace and refuses the rest; presets wider than workspace-write are narrowed while it is on',
        needWorkspace: 'Pick a workspace before creating a task',
        targetWs: 'New task in',
        noWorkspaceRun: 'This task has no workspace yet — set one before running it',
      },
    }

    let fallbackT = (key) => (DICT.zh[key] === undefined ? key : DICT.zh[key])

    function useT(props) {
      return props !== null && props !== undefined && typeof props.t === 'function' ? props.t : fallbackT
    }

    /** Shape of the JSON envelope every host call answers with. */
    interface CallEnvelope {
      ok?: boolean
      error?: { message?: string }
      value?: any
    }

    // ------------------------------------------------------------------ data

    async function call(method, payload) {
      const response = await fetch(API + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      })
      let envelope: CallEnvelope | null = null
      try {
        envelope = await response.json()
      } catch (error) {
        envelope = null
      }
      if (envelope === null || envelope.ok !== true) {
        const message =
          envelope && envelope.error && envelope.error.message
            ? envelope.error.message
            : 'HTTP ' + response.status
        throw new Error(message)
      }
      return envelope.value
    }

    /**
     * A crash in the browser half is invisible from the host, so it is reported
     * into the board itself: a blocked task titled `[client-error] …` carries
     * the stack in its notes. Nothing here may throw, or reporting would become
     * a second failure.
     */
    function reportClientError(kind: string, error: any, extra: string): void {
      try {
        const message = error && error.message ? String(error.message) : String(error)
        const stack = error && error.stack ? String(error.stack) : ''
        const where = typeof location !== 'undefined' ? String(location.href) : ''
        const agent = typeof navigator !== 'undefined' ? String(navigator.userAgent) : ''
        const notes = [stack, extra, where, agent].filter((part) => part !== '').join('\n\n')
        void fetch(API + 'create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: ('[client-error] ' + kind + ': ' + message).slice(0, 160),
            notes: notes.slice(0, 4000),
            status: 'blocked',
            priority: 'urgent',
            tags: ['client-error'],
          }),
        }).catch(() => undefined)
      } catch (ignored) {
        // Reporting must never escalate a crash.
      }
    }

    // Real React always provides Component; the loading tests stub a minimal
    // React, so fall back to a class that simply renders its children.
    const BoundaryBase: any =
      React !== null && typeof React === 'object' && typeof React.Component === 'function'
        ? React.Component
        : class {
            props: any
            state: any
            constructor(props: any) {
              this.props = props
              this.state = { error: null }
            }
          }

    /** Keeps a render crash inside the panel instead of blanking the slot. */
    class PanelBoundary extends BoundaryBase {
      constructor(props: any) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error: any): any {
        return { error }
      }

      componentDidCatch(error: any, info: any): void {
        reportClientError('render', error, info && info.componentStack ? String(info.componentStack) : '')
      }

      render(): any {
        const error = this.state.error
        if (error === null || error === undefined) return this.props.children
        const t = this.props.t
        const detail = error && error.stack ? String(error.stack) : String(error)
        return h(
          'div',
          { className: 'tc-root' },
          h(
            'div',
            { className: 'tc-crash' },
            h('p', { className: 'tc-crash-title' }, t('crashTitle')),
            h('pre', { className: 'tc-crash-detail' }, detail),
          ),
        )
      }
    }

    /** Slot entry point: the boundary sits above the page, so it catches it all. */
    function PanelShell(props: any): any {
      const safe = props === null || props === undefined ? {} : props
      const t = useT(safe)
      return h(PanelBoundary, { t }, h(TaskCenterPage, safe))
    }

    function isoDate(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return year + '-' + month + '-' + day
    }

    function todayIso() {
      return isoDate(new Date())
    }

    function shiftIso(iso, days) {
      const date = new Date(iso + 'T00:00:00')
      date.setDate(date.getDate() + days)
      return isoDate(date)
    }

    function dayGap(from, to) {
      const a = new Date(from + 'T00:00:00').getTime()
      const b = new Date(to + 'T00:00:00').getTime()
      return Math.round((b - a) / 86400000)
    }

    /**
     * @param {number} startedAt - when the run started.
     * @returns {string} compact elapsed time for the running pill.
     */
    function elapsedLabel(startedAt) {
      const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      const minutes = Math.floor(seconds / 60)
      return minutes < 1 ? seconds + 's' : minutes + 'm'
    }

    function dueLabel(due, t) {
      const today = todayIso()
      if (due === today) return t('chipToday')
      if (due === shiftIso(today, 1)) return t('chipTomorrow')
      if (due < today) return t('chipOverdue', { n: dayGap(due, today) })
      return due.slice(5)
    }

    function dueTone(due) {
      const today = todayIso()
      if (due === null) return ''
      if (due < today) return ' tc-tone-late'
      if (due === today) return ' tc-tone-today'
      return ''
    }

    function formatTime(iso) {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (value) => String(value).padStart(2, '0')
      return (
        date.getFullYear() +
        '-' +
        pad(date.getMonth() + 1) +
        '-' +
        pad(date.getDate()) +
        ' ' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes())
      )
    }

    function bySchedule(a, b) {
      const aDue = typeof a.due === 'string' && a.due !== '' ? a.due : '9999-99-99'
      const bDue = typeof b.due === 'string' && b.due !== '' ? b.due : '9999-99-99'
      if (aDue !== bDue) return aDue < bDue ? -1 : 1
      if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      // Timestamps arrive as epoch numbers, so `localeCompare` is not available.
      if (typeof a.createdAt === 'number' && typeof b.createdAt === 'number') {
        return a.createdAt - b.createdAt
      }
      const aAt = String(a.createdAt === null || a.createdAt === undefined ? '' : a.createdAt)
      const bAt = String(b.createdAt === null || b.createdAt === undefined ? '' : b.createdAt)
      return aAt < bAt ? -1 : aAt > bAt ? 1 : 0
    }

    // ------------------------------------------------------------------ icons

    function CheckMark(props) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: props.size || 12,
          height: props.size || 12,
          'aria-hidden': true,
          className: 'tc-checkmark',
        },
        h('path', {
          d: 'M5 12.5l4.4 4.4L19 7.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function PlayIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 11, height: 11, 'aria-hidden': true, className: 'tc-play-icon' },
        h('path', { d: 'M8 5.4l11 6.6-11 6.6z', fill: 'currentColor' }),
      )
    }

    function StopIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 10, height: 10, 'aria-hidden': true, className: 'tc-stop-icon' },
        h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2.2, fill: 'currentColor' }),
      )
    }

    function PanelIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 20
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': true,
          className: 'tc-panel-icon',
        },
        h('rect', {
          x: 3.4,
          y: 3.4,
          width: 17.2,
          height: 17.2,
          rx: 4.6,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
        }),
        h('path', {
          d: 'M7.8 12.3l2.5 2.5 5.9-6.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function SearchIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 13,
          height: 13,
          'aria-hidden': true,
          className: 'tc-search-icon',
        },
        h('circle', {
          cx: 10.6,
          cy: 10.6,
          r: 6.1,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
        }),
        h('path', {
          d: 'M15.2 15.2L20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
      )
    }

    function ChevronIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 12,
          height: 12,
          'aria-hidden': true,
          className: 'tc-chevron',
        },
        h('path', {
          d: 'M6 9.5l6 6 6-6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * A themed picker.
     *
     * A native `select` hands its popup to the operating system on Windows, so
     * that list can never match the panel. This draws both halves itself: the
     * closed control stays in flow, and the open list is portalled to the body
     * with fixed coordinates so a scrolling board or drawer cannot clip it.
     */
    function Dropdown(props: DropdownProps) {
      const [open, setOpen] = useState(false)
      const [active, setActive] = useState(0)
      const [placed, setPlaced] = useState(null)
      const rootRef = useRef(null)
      const listRef = useRef(null)
      const options = props.options
      const selected = options.findIndex((option) => option.value === props.value)
      const label = selected < 0 ? (options.length === 0 ? '' : options[0].label) : options[selected].label
      const portal = createPortal
      const floating = portal !== null

      useEffect(() => {
        if (!open) {
          return undefined
        }
        const measure = () => {
          const root = rootRef.current
          if (root === null) {
            return
          }
          const box = root.getBoundingClientRect()
          const below = window.innerHeight - box.bottom
          const above = box.top
          const up = below < 180 && above > below
          setPlaced({
            left: Math.max(8, Math.min(box.left, window.innerWidth - Math.max(box.width, 160) - 8)),
            width: Math.max(box.width, 160),
            top: up ? null : box.bottom + 4,
            bottom: up ? window.innerHeight - box.top + 4 : null,
            maxHeight: Math.max(120, (up ? above : below) - 12),
          })
        }
        measure()
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
        return () => {
          window.removeEventListener('resize', measure)
          window.removeEventListener('scroll', measure, true)
        }
      }, [open])

      useEffect(() => {
        if (!open) {
          return undefined
        }
        const onPointer = (event: MouseEvent) => {
          const root = rootRef.current
          const list = listRef.current
          if (event.target instanceof Node) {
            if (root !== null && root.contains(event.target)) {
              return
            }
            if (list !== null && list.contains(event.target)) {
              return
            }
          }
          setOpen(false)
        }
        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            setOpen(false)
          }
        }
        document.addEventListener('mousedown', onPointer, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onPointer, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      useEffect(() => {
        if (open) {
          setActive(selected < 0 ? 0 : selected)
        }
      }, [open, selected])

      const choose = (value: string) => {
        setOpen(false)
        if (value !== props.value) {
          props.onChange(value)
        }
      }

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (!open) {
            setOpen(true)
            return
          }
          const step = event.key === 'ArrowDown' ? 1 : -1
          setActive((index) => (index + step + options.length) % options.length)
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (!open) {
            setOpen(true)
            return
          }
          const option = options[active]
          if (option !== undefined) {
            choose(option.value)
          }
          return
        }
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          setOpen(false)
        }
      }

      let popup = null
      if (open) {
        const style =
          floating && placed !== null
            ? {
                position: 'fixed',
                left: placed.left + 'px',
                width: placed.width + 'px',
                maxHeight: placed.maxHeight + 'px',
                top: placed.top === null ? undefined : placed.top + 'px',
                bottom: placed.bottom === null ? undefined : placed.bottom + 'px',
              }
            : undefined
        const list = h(
          'div',
          {
            ref: listRef,
            className: 'tc-dd-list' + (floating ? '' : ' tc-dd-list-inline'),
            role: 'listbox',
            'aria-label': props.ariaLabel,
            style,
          },
          options.map((option, index) =>
            h(
              'div',
              {
                key: option.value,
                role: 'option',
                'aria-selected': option.value === props.value,
                className:
                  'tc-dd-item' +
                  (option.value === props.value ? ' tc-dd-item-on' : '') +
                  (index === active ? ' tc-dd-item-active' : ''),
                onMouseEnter: () => setActive(index),
                onClick: () => choose(option.value),
              },
              option.label,
            ),
          ),
        )
        popup = portal !== null && placed !== null ? portal(list, document.body) : list
      }

      const className = 'tc-dd' + (props.className === undefined ? '' : ' ' + props.className) + (open ? ' tc-dd-open' : '')
      return h(
        'div',
        { className, ref: rootRef },
        h(
          'button',
          {
            type: 'button',
            className: 'tc-dd-btn',
            disabled: props.disabled === true,
            onClick: () => setOpen(!open),
            onKeyDown,
            'aria-haspopup': 'listbox',
            'aria-expanded': open,
            'aria-label': props.ariaLabel ?? props.title,
            title: props.title ?? props.ariaLabel,
          },
          h('span', { className: 'tc-dd-value' }, label),
          h(ChevronIcon),
        ),
        popup,
      )
    }

    function FolderIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 12,
          height: 12,
          'aria-hidden': true,
          className: 'tc-folder-icon',
        },
        h('path', {
          d: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.4h7a1.5 1.5 0 0 1 1.5 1.5v7.6A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinejoin: 'round',
        }),
      )
    }

    function EmptyIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 26,
          height: 26,
          'aria-hidden': true,
          className: 'tc-empty-icon',
        },
        h('rect', {
          x: 3.4,
          y: 4.6,
          width: 17.2,
          height: 14.8,
          rx: 3.4,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
        }),
        h('path', {
          d: 'M7.6 10h8.8M7.6 14h5.4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      )
    }

    // ------------------------------------------------------------------ parts

    function TaskCard(props) {
      const task = props.task
      const subtasks = props.subtasks
      const t = props.t
      const finished = subtasks.filter((child) => child.status === 'done').length
      const run = task.run === null || task.run === undefined ? null : task.run
      const running = run !== null && run.status === 'running'
      const queued = run !== null && run.status === 'queued'
      const failed = run !== null && run.status === 'failed'
      const canRun = !running && !queued && task.status !== 'done'
      const hasMeta =
        task.due !== null ||
        task.tags.length > 0 ||
        subtasks.length > 0 ||
        task.priority !== 'normal'

      const stages = Array.isArray(task.stages) ? task.stages : []
      const stageIndex = typeof task.stageIndex === 'number' ? task.stageIndex : 0
      const stageCurrent = stages.length === 0 ? null : stages[Math.min(stageIndex, stages.length - 1)]
      const stageAwaiting = stageCurrent !== null && stageCurrent.status === 'awaiting-approval'

      const meta: any[] = []
      const workspaceName = typeof props.workspaceName === 'string' ? props.workspaceName : ''
      if (workspaceName !== '') {
        meta.push(
          h(
            'span',
            { key: 'ws', className: 'tc-ws', title: props.workspacePath === undefined ? workspaceName : props.workspacePath },
            h(FolderIcon),
            workspaceName,
          ),
        )
      }
      if (task.priority !== 'normal') {
        meta.push(
          h(
            'span',
            { key: 'pri', className: 'tc-pri tc-pri-' + task.priority },
            t('priority.' + task.priority),
          ),
        )
      }
      if (task.due !== null) {
        meta.push(
          h('span', { key: 'due', className: 'tc-due' + dueTone(task.due) }, dueLabel(task.due, t)),
        )
      }
      if (subtasks.length > 0) {
        meta.push(
          h(
            'span',
            { key: 'sub', className: 'tc-subtag' },
            t('subtaskProgress', { done: finished, total: subtasks.length }),
          ),
        )
      }
      for (const name of task.tags) {
        meta.push(h('span', { key: 'tag:' + name, className: 'tc-tag' }, name))
      }

      return h(
        'div',
        {
          className:
            'tc-card' +
            (task.status === 'done' ? ' tc-card-done' : '') +
            (props.dragging ? ' tc-card-dragging' : ''),
          'data-priority': task.priority,
          draggable: true,
          role: 'button',
          tabIndex: 0,
          onClick: () => props.onOpen(task.id),
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              props.onOpen(task.id)
            }
          },
          onDragStart: (event) => {
            event.dataTransfer.setData('text/plain', task.id)
            event.dataTransfer.effectAllowed = 'move'
            props.onDragStart(task.id)
          },
          onDragEnd: () => props.onDragEnd(),
        },
        h(
          'div',
          { className: 'tc-card-top' },
          h(
            'button',
            {
              type: 'button',
              className: 'tc-check' + (task.status === 'done' ? ' tc-check-on' : ''),
              title: t('done'),
              'aria-label': t('done'),
              onClick: (event) => {
                event.stopPropagation()
                props.onToggle(task)
              },
            },
            task.status === 'done' ? h(CheckMark, { size: 11 }) : null,
          ),
          h('span', { className: 'tc-card-title' }, task.title),
          running
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'tc-runpill',
                  title: t('cancelRun'),
                  'aria-label': t('cancelRun'),
                  onClick: (event) => {
                    event.stopPropagation()
                    props.onCancelRun(task.id)
                  },
                },
                h('span', { className: 'tc-run-dot', 'aria-hidden': true }),
                h('span', { className: 'tc-run-time' }, elapsedLabel(run.startedAt)),
                h(StopIcon),
              )
            : queued
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'tc-runpill tc-runpill-queued',
                    title: t('cancelQueued'),
                    'aria-label': t('cancelQueued'),
                    onClick: (event) => {
                      event.stopPropagation()
                      props.onCancelRun(task.id)
                    },
                  },
                  h('span', { className: 'tc-queue-dot', 'aria-hidden': true }),
                  h('span', { className: 'tc-run-time' }, t('queued')),
                  h(StopIcon),
                )
              : canRun
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'tc-runbtn' + (failed ? ' tc-runbtn-failed' : ''),
                    title: failed && run.message !== null ? t('runFailed') + '：' + run.message : t('run'),
                    'aria-label': t('run'),
                    onClick: (event) => {
                      event.stopPropagation()
                      props.onRun(task.id)
                    },
                  },
                  h(PlayIcon),
                )
              : null,
        ),
        stages.length > 0 && task.status !== 'done'
          ? h(
              'div',
              { className: 'tc-stagebar' + (stageAwaiting ? ' tc-stagebar-await' : '') },
              h(
                'span',
                { className: 'tc-stagebar-dots' },
                stages.map((entry, index) =>
                  h('span', {
                    key: String(index),
                    className:
                      'tc-sdot tc-sdot-' +
                      String(entry.status).replace(/-/g, '') +
                      (index === stageIndex ? ' tc-sdot-current' : ''),
                  }),
                ),
              ),
              h(
                'span',
                { className: 'tc-stagebar-text' },
                stageAwaiting
                  ? t('awaitBadge')
                  : t('groupStages') + ' ' + String(Math.min(stageIndex + 1, stages.length)) + '/' + String(stages.length),
              ),
            )
          : null,
        hasMeta ? h('div', { className: 'tc-card-meta' }, meta) : null,
      )
    }

    function BoardColumn(props) {
      const t = props.t
      const tasks = props.tasks
      return h(
        'section',
        {
          className: 'tc-col' + (props.active ? ' tc-col-active' : ''),
          'data-status': props.id,
          onDragOver: (event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            props.onHover(props.id)
          },
          onDragLeave: (event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return
            props.onHover('')
          },
          onDrop: (event) => {
            event.preventDefault()
            const id = event.dataTransfer.getData('text/plain') || props.dragId
            props.onHover('')
            if (id) props.onDrop(id, props.id)
          },
        },
        h(
          'header',
          { className: 'tc-col-head' },
          h('span', { className: 'tc-col-dot', 'aria-hidden': true }),
          h('span', { className: 'tc-col-name' }, t('column.' + props.id)),
          h('span', { className: 'tc-col-count' }, String(tasks.length)),
          h(
            'button',
            {
              type: 'button',
              className: 'tc-col-add',
              title: t('column.add'),
              'aria-label': t('column.add'),
              onClick: () => props.onAdd(props.id),
            },
            '+',
          ),
        ),
        h(
          'div',
          { className: 'tc-col-body' },
          tasks.length === 0
            ? h(
                'p',
                { className: 'tc-col-empty' },
                h(EmptyIcon),
                h('span', null, t('emptyColumn')),
              )
            : tasks.map((task) =>
                h(TaskCard, {
                  key: task.id,
                  task,
                  t,
                  workspaceName: props.workspaceNameOf(task),
                  workspacePath: task.workspacePath === null || task.workspacePath === undefined ? undefined : task.workspacePath,
                  subtasks: props.childrenOf.get(task.id) || [],
                  dragging: props.dragId === task.id,
                  onOpen: props.onOpen,
                  onToggle: props.onToggle,
                  onRun: props.onRun,
                  onCancelRun: props.onCancelRun,
                  onDragStart: props.onDragStart,
                  onDragEnd: props.onDragEnd,
                }),
              ),
        ),
      )
    }

    function TaskEditor(props) {
      const t = props.t
      const task = props.task
      const [form, setForm] = useState(() => ({
        title: task.title,
        notes: task.notes,
        status: task.status,
        priority: task.priority,
        due: task.due === null ? '' : task.due,
        tags: task.tags.join(', '),
        workspaceId: task.workspaceId === null || task.workspaceId === undefined ? '' : task.workspaceId,
        workspacePath: task.workspacePath === null || task.workspacePath === undefined ? '' : task.workspacePath,
        permission: task.permission === null || task.permission === undefined ? '' : task.permission,
        cwd: task.cwd === null || task.cwd === undefined ? '' : task.cwd,
        blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.slice() : [],
        autoApprove: task.autoApprove === true,
      }))
      const [dirDraft, setDirDraft] = useState('')
      const [dirBusy, setDirBusy] = useState(false)
      const allTasks = Array.isArray(props.tasks) ? props.tasks : []
      const candidates = allTasks.filter(
        (entry) => entry.id !== task.id && entry.parentId !== task.id,
      )
      const workspaces = Array.isArray(props.workspaces) ? props.workspaces : []
      const permissions = Array.isArray(props.permissions) ? props.permissions : []
      const stages = Array.isArray(task.stages) ? task.stages : []
      const stageIndex = typeof task.stageIndex === 'number' ? task.stageIndex : 0
      const [doc, setDoc] = useState(null)
      const [docBusy, setDocBusy] = useState(false)
      const stageLabel = {
        draft: t('stageDraft'),
        'awaiting-approval': t('stageAwait'),
        approved: t('stageApproved'),
        running: t('stageRunning'),
        done: t('stageDone'),
        failed: t('stageFailed'),
      }
      const toggleDoc = async (ordinal) => {
        if (doc !== null && doc.ordinal === ordinal) {
          setDoc(null)
          return
        }
        setDocBusy(true)
        try {
          const value = await props.onStageDoc(task.id, ordinal)
          setDoc({ ordinal, text: value === null || value.text === undefined ? '' : String(value.text) })
        } catch (error: any) {
          setDoc({ ordinal, text: error && error.message ? String(error.message) : String(error) })
        } finally {
          setDocBusy(false)
        }
      }
      const act = (action, ordinal) => {
        void props.onStageAction(task.id, ordinal, action)
      }
      const globalPreset = typeof props.globalPreset === 'string' && props.globalPreset !== '' ? props.globalPreset : 'auto'
      const presetLabel = permissions.find((option) => option.value === globalPreset)
      const inheritLabel = t('permissionInherit').replace('{name}', presetLabel === undefined ? globalPreset : presetLabel.name)
      const [subDraft, setSubDraft] = useState('')
      const [saveState, setSaveState] = useState('idle')
      const timerRef = React.useRef(null)
      const pendingRef = React.useRef(null)
      const patchRef = React.useRef(props.onPatch)
      const disposedRef = React.useRef(false)

      React.useEffect(() => {
        patchRef.current = props.onPatch
      }, [props.onPatch])

      const flush = React.useCallback(() => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        const payload = pendingRef.current
        pendingRef.current = null
        if (payload === null) return
        Promise.resolve(patchRef.current(payload)).then(
          (ok) => {
            if (disposedRef.current) return
            setSaveState(ok === false ? 'error' : 'saved')
          },
          () => {
            if (disposedRef.current) return
            setSaveState('error')
          },
        )
      }, [])

      React.useEffect(
        () => () => {
          disposedRef.current = true
          if (timerRef.current !== null) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
          const payload = pendingRef.current
          pendingRef.current = null
          if (payload !== null) void patchRef.current(payload)
        },
        [],
      )

      const stage = (patch) => {
        setForm((previous) => {
          const next = Object.assign({}, previous, patch)
          const chosen = workspaces.find((entry) => entry.id === next.workspaceId)
          const storedPath = next.workspacePath !== '' ? next.workspacePath : chosen === undefined ? '' : chosen.path
          const payload: Omit<TaskUpdateInput, 'id'> = { notes: next.notes, status: next.status, priority: next.priority, due: next.due === '' ? null : next.due, tags: splitTags(next.tags), workspaceId: next.workspaceId === '' ? null : next.workspaceId, workspacePath: next.workspaceId === '' || storedPath === '' ? null : storedPath, permission: next.permission === '' ? null : next.permission, cwd: next.cwd.trim() === '' ? null : next.cwd.trim(), blockedBy: next.blockedBy, autoApprove: next.autoApprove === true }
          if (next.title.trim() !== '') payload.title = next.title.trim()
          pendingRef.current = payload
          return next
        })
        setSaveState('saving')
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          const payload = pendingRef.current
          pendingRef.current = null
          if (payload === null) return
          Promise.resolve(patchRef.current(payload)).then(
            (ok) => {
              if (disposedRef.current) return
              setSaveState(ok === false ? 'error' : 'saved')
            },
            () => {
              if (disposedRef.current) return
              setSaveState('error')
            },
          )
        }, 420)
      }

      const addSubtask = () => {
        const title = subDraft.trim()
        if (title === '') return
        setSubDraft('')
        void props.onCreateSubtask(title)
      }

      const saveText = {
        idle: t('saveIdle'),
        saving: t('saveSaving'),
        saved: t('saveSaved'),
        error: t('saveError'),
      }[saveState]

      return h(
        'aside',
        {
          className: 'tc-drawer',
          role: 'dialog',
          'aria-modal': true,
          'aria-label': t('field.title'),
          onKeyDown: (event) => {
            if (event.key === 'Escape') props.onClose()
          },
        },
        h(
          'header',
          { className: 'tc-drawer-head' },
          h('input', {
            className: 'tc-drawer-title',
            value: form.title,
            placeholder: t('field.title'),
            'aria-label': t('field.title'),
            onChange: (event) => stage({ title: event.target.value }),
            onBlur: flush,
          }),
          h(
            'button',
            { type: 'button', className: 'tc-iconbtn', title: t('close'), 'aria-label': t('close'), onClick: props.onClose },
            '\u00d7',
          ),
        ),
        h(
          'div',
          { className: 'tc-drawer-body' },
          h(
            'section',
            { className: 'tc-group' },
            h('span', { className: 'tc-group-title' }, t('groupSchedule')),
            h(
              'div',
              { className: 'tc-field' },
              h('span', { className: 'tc-label' }, t('field.status')),
              h(
                'div',
                { className: 'tc-seg' },
                COLUMNS.map((id) =>
                  h(
                    'button',
                    {
                      key: id,
                      type: 'button',
                      className: 'tc-seg-btn' + (form.status === id ? ' tc-seg-on' : ''),
                      onClick: () => stage({ status: id }),
                    },
                    t('column.' + id),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { className: 'tc-field-row' },
              h(
                'label',
                { className: 'tc-field tc-field-half' },
                h('span', { className: 'tc-label' }, t('field.priority')),
                h(Dropdown, {
                  className: 'tc-dd-block',
                  value: form.priority,
                  options: PRIORITIES.map((id) => ({ value: id, label: t('priority.' + id) })),
                  onChange: (value) => stage({ priority: value }),
                }),
              ),
              h(
                'label',
                { className: 'tc-field tc-field-half' },
                h('span', { className: 'tc-label' }, t('field.due')),
                h('input', {
                  type: 'date',
                  className: 'tc-input',
                  value: form.due,
                  onChange: (event) => stage({ due: event.target.value }),
                }),
              ),
            ),
            h(
              'label',
              { className: 'tc-field' },
              h('span', { className: 'tc-label' }, t('field.workspace')),
              h(Dropdown, {
                className: 'tc-dd-block',
                value: form.workspaceId,
                options: [{ value: '', label: t('noWorkspace') }].concat(
                  workspaces.map((entry) => ({ value: entry.id, label: entry.title + ' — ' + entry.path })),
                ),
                onChange: (nextId) => {
                  const found = workspaces.find((entry) => entry.id === nextId)
                  stage({ workspaceId: nextId, workspacePath: nextId === '' || found === undefined ? '' : found.path })
                },
              }),
              h('span', { className: 'tc-fieldhint' }, t('workspaceHint')),
            ),
            h(
              'div',
              { className: 'tc-field' },
              h('span', { className: 'tc-label' }, t('newDir')),
              h(
                'div',
                { className: 'tc-inline' },
                h('input', {
                  className: 'tc-input tc-path',
                  value: dirDraft,
                  placeholder: t('newDirPlaceholder'),
                  disabled: dirBusy,
                  onChange: (event) => setDirDraft(event.target.value),
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tc-btn',
                    disabled: dirBusy || dirDraft.trim() === '',
                    onClick: () => {
                      if (dirBusy || dirDraft.trim() === '') return
                      // Reuse the workspace when the directory is already registered.
                      const wanted = samePathKey(dirDraft.trim())
                      const existing = workspaces.find((entry) => samePathKey(entry.path) === wanted)
                      if (existing !== undefined) {
                        setDirDraft('')
                        stage({ workspaceId: existing.id, workspacePath: existing.path })
                        return
                      }
                      setDirBusy(true)
                      Promise.resolve(props.onCreateWorkspace(dirDraft.trim())).then(
                        (created) => {
                          setDirBusy(false)
                          if (created === null) return
                          setDirDraft('')
                          stage({ workspaceId: created.id, workspacePath: created.path })
                        },
                        () => setDirBusy(false),
                      )
                    },
                  },
                  t('addWorkspace'),
                ),
              ),
            ),
            h(
              'label',
              { className: 'tc-field' },
              h('span', { className: 'tc-label' }, t('field.permission')),
              h(Dropdown, {
                className: 'tc-dd-block',
                value: form.permission,
                options: [{ value: '', label: inheritLabel }].concat(
                  permissions
                    .filter((option) => option.value !== globalPreset)
                    .map((option) => ({ value: option.value, label: option.name })),
                ),
                onChange: (value) => stage({ permission: value }),
              }),
              h('span', { className: 'tc-fieldhint' }, t('permissionHint')),
            ),
            h(
              'label',
              { className: 'tc-field' },
              h('span', { className: 'tc-label' }, t('field.autoApprove')),
              h(
                'label',
                { className: 'tc-switch' },
                h('input', {
                  type: 'checkbox',
                  className: 'tc-switch-check',
                  checked: form.autoApprove,
                  onChange: (event) => stage({ autoApprove: event.target.checked }),
                }),
                h('span', { className: 'tc-switch-track' }, h('span', { className: 'tc-switch-dot' })),
                h('span', { className: 'tc-switch-text' }, form.autoApprove ? t('autoApproveOn') : t('autoApproveOff')),
              ),
              h('span', { className: 'tc-fieldhint' }, t('autoApproveHint')),
            ),
          ),
          stages.length > 0
            ? h(
                'section',
                { className: 'tc-group' },
                h('span', { className: 'tc-group-title' }, t('groupStages')),
                h(
                  'ol',
                  { className: 'tc-stagelist' },
                  stages.map((entry, index) => {
                    const awaiting = entry.status === 'awaiting-approval'
                    const current = index === stageIndex
                    return h(
                      'li',
                      {
                        key: String(index),
                        className: 'tc-stage' + (current ? ' tc-stage-current' : ''),
                      },
                      h('span', { className: 'tc-stage-no' }, String(index + 1)),
                      h('span', { className: 'tc-stage-title' }, entry.title),
                      h(
                        'span',
                        { className: 'tc-stage-pill tc-stage-' + String(entry.status).replace(/-/g, '') },
                        stageLabel[entry.status] === undefined ? String(entry.status) : stageLabel[entry.status],
                      ),
                      h(
                        'span',
                        { className: 'tc-stage-acts' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'tc-btn tc-btn-quiet',
                            disabled: docBusy,
                            onClick: () => {
                              void toggleDoc(index + 1)
                            },
                          },
                          doc !== null && doc.ordinal === index + 1 ? t('hideDoc') : t('viewDoc'),
                        ),
                        awaiting
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'tc-btn tc-btn-primary',
                                onClick: () => act('approveStage', index + 1),
                              },
                              t('approve'),
                            )
                          : null,
                        awaiting
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'tc-btn tc-btn-danger',
                                onClick: () => act('rejectStage', index + 1),
                              },
                              t('reject'),
                            )
                          : null,
                      ),
                    )
                  }),
                ),
                h('span', { className: 'tc-fieldhint' }, t('stageHint')),
                doc === null
                  ? null
                  : h('pre', { className: 'tc-doc' }, doc.text.trim() === '' ? t('docEmpty') : doc.text),
              )
            : null,
          h(
            'section',
            { className: 'tc-group' },
            h('span', { className: 'tc-group-title' }, t('groupDeps')),
            candidates.length === 0
              ? h('p', { className: 'tc-fieldhint' }, t('noBlockers'))
              : h(
                  'div',
                  { className: 'tc-blockers' },
                  candidates.map((candidate) => {
                    const checked = form.blockedBy.indexOf(candidate.id) !== -1
                    return h(
                      'label',
                      {
                        key: candidate.id,
                        className: 'tc-blocker' + (checked ? ' tc-blocker-on' : ''),
                      },
                      h('input', {
                        type: 'checkbox',
                        className: 'tc-blocker-check',
                        checked,
                        onChange: () => {
                          const next = checked
                            ? form.blockedBy.filter((entry) => entry !== candidate.id)
                            : form.blockedBy.concat([candidate.id])
                          stage({ blockedBy: next })
                        },
                      }),
                      h('span', { className: 'tc-blocker-title' }, candidate.title),
                      candidate.status === 'done'
                        ? h('span', { className: 'tc-blocker-done' }, t('column.done'))
                        : null,
                    )
                  }),
                ),
            h('span', { className: 'tc-fieldhint' }, t('blockersHint')),
          ),
          h(
            'section',
            { className: 'tc-group' },
            h('span', { className: 'tc-group-title' }, t('groupContent')),
            h(
              'label',
              { className: 'tc-field' },
              h('span', { className: 'tc-label' }, t('field.tags')),
              h('input', {
                className: 'tc-input',
                value: form.tags,
                placeholder: t('tagsPlaceholder'),
                onChange: (event) => stage({ tags: event.target.value }),
                onBlur: flush,
              }),
            ),
            h(
              'label',
              { className: 'tc-field' },
              h('span', { className: 'tc-label' }, t('field.notes')),
              h('textarea', {
                className: 'tc-input tc-textarea',
                value: form.notes,
                rows: 4,
                placeholder: t('notesPlaceholder'),
                onChange: (event) => stage({ notes: event.target.value }),
                onBlur: flush,
              }),
            ),
          ),
          h(
            'section',
            { className: 'tc-group' },
            h('span', { className: 'tc-group-title' }, t('subtasks')),
            h(
              'div',
              { className: 'tc-sublist' },
              props.subtasks.length === 0
                ? h('p', { className: 'tc-hint' }, t('subtaskAdd'))
                : props.subtasks.map((child) =>
                    h(
                      'div',
                      { key: child.id, className: 'tc-subrow' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'tc-check tc-check-sm' + (child.status === 'done' ? ' tc-check-on' : ''),
                          'aria-label': t('done'),
                          onClick: () => props.onToggleSubtask(child),
                        },
                        child.status === 'done' ? h(CheckMark, { size: 9 }) : null,
                      ),
                      h(
                        'span',
                        {
                          className: 'tc-subtext' + (child.status === 'done' ? ' tc-subtext-done' : ''),
                          onClick: () => props.onOpenTask(child.id),
                        },
                        child.title,
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'tc-iconbtn tc-iconbtn-sm',
                          'aria-label': t('deleteTask'),
                          onClick: () => props.onDeleteSubtask(child.id),
                        },
                        '\u00d7',
                      ),
                    ),
                  ),
              h('input', {
                className: 'tc-input tc-subinput',
                value: subDraft,
                placeholder: t('subtaskAdd'),
                onChange: (event) => setSubDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addSubtask()
                  }
                },
              }),
            ),
          ),
        ),
        h(
          'footer',
          { className: 'tc-drawer-foot' },
          h('span', { className: 'tc-stamp' }, t('created', { time: formatTime(task.createdAt) })),
          h('span', { className: 'tc-savestate' }, saveText),
          h(
            'button',
            { type: 'button', className: 'tc-btn tc-btn-danger', onClick: () => props.onDelete(task.id) },
            t('deleteTask'),
          ),
        ),
      )
    }

    function ListView(props) {
      const t = props.t
      return h(
        'div',
        { className: 'tc-list' },
        props.roots.length === 0
          ? h('div', { className: 'tc-empty' }, h(EmptyIcon), h('span', null, t('emptyBoard')))
          : props.roots.map((task) => {
              const subtasks = props.childrenOf.get(task.id) || []
              const finished = subtasks.filter((child) => child.status === 'done').length
              const workspaceName = typeof props.workspaceNameOf === 'function' ? props.workspaceNameOf(task) : ''
              return h(
                'div',
                { key: task.id, className: 'tc-row' + (task.status === 'done' ? ' tc-row-done' : '') },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tc-check' + (task.status === 'done' ? ' tc-check-on' : ''),
                    'aria-label': t('done'),
                    onClick: () => props.onToggle(task),
                  },
                  task.status === 'done' ? h(CheckMark, { size: 11 }) : null,
                ),
                h(
                  'button',
                  { type: 'button', className: 'tc-row-title', onClick: () => props.onOpen(task.id) },
                  task.title,
                ),
                task.due === null
                  ? null
                  : h('span', { className: 'tc-due' + dueTone(task.due) }, dueLabel(task.due, t)),
                subtasks.length === 0
                  ? null
                  : h('span', { className: 'tc-subtag' }, t('subtaskProgress', { done: finished, total: subtasks.length })),
                workspaceName === '' ? null : h('span', { className: 'tc-ws' }, h(FolderIcon), workspaceName),
                task.tags.length === 0
                  ? null
                  : h(
                      'span',
                      { className: 'tc-tags' },
                      task.tags.map((name) => h('span', { key: name, className: 'tc-tag' }, name)),
                    ),
                h(Dropdown, {
                  className: 'tc-dd-sm',
                  value: task.status,
                  options: COLUMNS.map((id) => ({ value: id, label: t('column.' + id) })),
                  onChange: (value) => props.onMove(task.id, value),
                  ariaLabel: t('field.status'),
                }),
              )
            }),
      )
    }

    function TrashView(props) {
      const t = props.t
      return h(
        'div',
        { className: 'tc-trash' },
        h(
          'div',
          { className: 'tc-trash-head' },
          h('p', { className: 'tc-hint' }, t('trashHint')),
          props.trash.length === 0
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'tc-btn tc-btn-danger',
                  onClick: () => {
                    if (window.confirm(t('confirmClear'))) props.onClear()
                  },
                },
                t('clearTrash'),
              ),
        ),
        props.trash.length === 0
          ? h(
              'div',
              { className: 'tc-empty' },
              h(EmptyIcon),
              h('span', { className: 'tc-empty-title' }, t('trashEmpty')),
            )
          : props.trash.map((task) =>
              h(
                'div',
                { key: task.id, className: 'tc-row' },
                h('span', { className: 'tc-row-title tc-row-static' }, task.title || t('untitled')),
                h('span', { className: 'tc-stamp' }, formatTime(task.deletedAt)),
                h(
                  'button',
                  { type: 'button', className: 'tc-btn', onClick: () => props.onRestore(task.id) },
                  t('restore'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'tc-btn tc-btn-danger',
                    onClick: () => {
                      if (window.confirm(t('confirmPurge'))) props.onPurge(task.id)
                    },
                  },
                  t('purge'),
                ),
              ),
            ),
      )
    }

    // ------------------------------------------------------------------ panel

    function TaskCenterPage(props) {
      const t = useT(props)
      const [board, setBoard] = useState(null)
      const [phase, setPhase] = useState('loading')
      const [failure, setFailure] = useState('')
      const [mode, setMode] = useState('board')
      const [query, setQuery] = useState('')
      const [tag, setTag] = useState('')
      const [openId, setOpenId] = useState('')
      const [draft, setDraft] = useState('')
      const [draftStatus, setDraftStatus] = useState('todo')
      const [notice, setNotice] = useState(null)
      const [dragId, setDragId] = useState('')
      const [dropZone, setDropZone] = useState('')
      const [runner, setRunner] = useState(null)
      const [workspaces, setWorkspaces] = useState([])
      const [permissions, setPermissions] = useState([])
      const [defaultPreset, setDefaultPreset] = useState('')
      const [targetWs, setTargetWs] = useState('')
      const addRef = React.useRef(null)

      const refresh = React.useCallback(async () => {
        try {
          const value = await call('list', {})
          setBoard(value)
          setPhase('ready')
          setFailure('')
          try {
            setRunner(await call('settings', {}))
          } catch (error) {
            // The board still works without the runner settings.
          }
          try {
            const found = await call('workspaces', {})
            setWorkspaces(Array.isArray(found.workspaces) ? found.workspaces : [])
          } catch (error) {
            setWorkspaces([])
          }
          try {
            const catalog = await call('permissions', {})
            setPermissions(Array.isArray(catalog.options) ? catalog.options : [])
            setDefaultPreset(typeof catalog.defaultPreset === 'string' ? catalog.defaultPreset : '')
          } catch (error) {
            setPermissions([])
          }
        } catch (error: any) {
          setPhase('error')
          setFailure(error && error.message ? error.message : String(error))
        }
      }, [])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      // Keep the quick-add target pointing at a workspace that still exists.
      React.useEffect(() => {
        if (workspaces.length === 0) return
        if (workspaces.some((entry) => entry.id === targetWs)) return
        setTargetWs(workspaces[0].id)
      }, [workspaces, targetWs])

      React.useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 2600)
        return () => clearTimeout(timer)
      }, [notice])

      const mutate = React.useCallback(
        async (method, payload) => {
          try {
            await call(method, payload)
            await refresh()
            return true
          } catch (error: any) {
            setNotice({ kind: 'error', text: error && error.message ? error.message : String(error) })
            return false
          }
        },
        [refresh],
      )

      const tasks = board !== null && Array.isArray(board.tasks) ? board.tasks : []
      const trash = board !== null && Array.isArray(board.trash) ? board.trash : []

      const queuedCount = React.useMemo(() => {
        let total = 0
        for (const task of tasks) {
          if (task.run !== null && task.run !== undefined && task.run.status === 'queued') total += 1
        }
        return total
      }, [tasks])

      const concurrency = runner !== null && typeof runner.concurrency === 'number' ? runner.concurrency : 0

      const tags = React.useMemo(() => {
        const seen = new Set<string>()
        for (const task of tasks) for (const name of task.tags) seen.add(name)
        return Array.from(seen).sort((a, b) => a.localeCompare(b))
      }, [tasks])

      const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return tasks.filter((task) => {
          if (tag !== '' && task.tags.indexOf(tag) === -1) return false
          if (needle === '') return true
          if (task.title.toLowerCase().indexOf(needle) !== -1) return true
          if (task.notes.toLowerCase().indexOf(needle) !== -1) return true
          return task.tags.some((name) => name.toLowerCase().indexOf(needle) !== -1)
        })
      }, [tasks, query, tag])

      const roots = React.useMemo(() => {
        const visible = new Set(filtered.map((task) => task.id))
        const list = filtered.filter((task) => task.parentId === null || !visible.has(task.parentId))
        list.sort(bySchedule)
        return list
      }, [filtered])

      const childrenOf = React.useMemo(() => {
        const map = new Map()
        for (const task of filtered) {
          if (task.parentId === null) continue
          const bucket = map.get(task.parentId)
          if (bucket) bucket.push(task)
          else map.set(task.parentId, [task])
        }
        for (const bucket of map.values()) bucket.sort(bySchedule)
        return map
      }, [filtered])

      const columnTasks = React.useMemo(() => {
        const map = { todo: [], doing: [], blocked: [], done: [] }
        for (const task of roots) map[task.status].push(task)
        return map
      }, [roots])

      const reminders = React.useMemo(() => {
        const today = todayIso()
        let late = 0
        let dueToday = 0
        for (const task of tasks) {
          if (task.due === null || task.status === 'done') continue
          if (task.due < today) late += 1
          else if (task.due === today) dueToday += 1
        }
        return { late, dueToday }
      }, [tasks])

      const openTask = openId === '' ? null : tasks.find((task) => task.id === openId) || null
      const openSubtasks = openTask === null ? [] : childrenOf.get(openTask.id) || []

      const createTask = async (title, status) => {
        const value = title.trim()
        if (value === '') return false
        if (workspaces.length > 0 && targetWs === '') {
          setNotice({ kind: 'error', text: t('needWorkspace') })
          return false
        }
        const chosen = workspaces.find((entry) => entry.id === targetWs)
        const payload: TaskCreateInput = { title: value, status }
        if (chosen !== undefined) {
          payload.workspaceId = chosen.id
          payload.workspacePath = chosen.path
        }
        const ok = await mutate('create', payload)
        if (ok) setNotice({ kind: 'ok', text: t('noticeCreated') })
        return ok
      }

      /** Register a directory as a workspace, then point the picker at it. */
      const createWorkspace = async (path) => {
        try {
          const created = await call('createWorkspace', { path })
          await refresh()
          setNotice({ kind: 'ok', text: created.title })
          return created
        } catch (error: any) {
          setNotice({ kind: 'error', text: error && error.message ? error.message : String(error) })
          return null
        }
      }

      /** Display name for a task's workspace: the live title, else the directory basename. */
      const workspaceNameOf = React.useCallback(
        (task) => {
          if (task === null || task === undefined) return ''
          const id = typeof task.workspaceId === 'string' ? task.workspaceId : ''
          if (id !== '') {
            const found = workspaces.find((entry) => entry.id === id)
            if (found !== undefined) return found.title
          }
          const raw = typeof task.workspacePath === 'string' && task.workspacePath !== '' ? task.workspacePath : typeof task.cwd === 'string' ? task.cwd : ''
          if (raw === '') return ''
          const parts = raw.split(/[\\/]+/).filter((part) => part !== '')
          return parts.length === 0 ? raw : parts[parts.length - 1]
        },
        [workspaces],
      )

      const submitDraft = async () => {
        const ok = await createTask(draft, draftStatus)
        if (ok) setDraft('')
      }

      const toggleTask = (task) => {
        void mutate('update', { id: task.id, status: task.status === 'done' ? 'todo' : 'done' })
      }

      const moveTask = (id, status) => {
        if (!id) return
        void mutate('update', { id, status })
      }

      const deleteTask = async (id) => {
        const ok = await mutate('delete', { id })
        if (ok) {
          setOpenId('')
          setNotice({ kind: 'ok', text: t('noticeDeleted') })
        }
      }

      const patchOpen = async (payload) => {
        if (openTask === null) return false
        return mutate('update', Object.assign({ id: openTask.id }, payload))
      }

      const focusAdd = (status) => {
        setDraftStatus(status)
        if (addRef.current !== null) addRef.current.focus()
      }

      /** Open the drawer instead of running a task that has neither a workspace nor a directory. */
      const startRun = async (id) => {
        const task = tasks.find((entry) => entry.id === id) || null
        const hasWorkspace = task !== null && typeof task.workspaceId === 'string' && task.workspaceId !== ''
        const hasCwd = task !== null && typeof task.cwd === 'string' && task.cwd !== ''
        if (task !== null && !hasWorkspace && !hasCwd) {
          setOpenId(id)
          setNotice({ kind: 'error', text: t('noWorkspaceRun') })
          return
        }
        const ok = await mutate('run', { id })
        if (ok) setNotice({ kind: 'ok', text: t('noticeRun') })
      }

      /** Save one settings patch and adopt whatever the host answers with. */
      const saveSetting = async (patch) => {
        try {
          const value = await call('saveSettings', patch)
          setRunner(Object.assign({}, runner === null ? {} : runner, value))
          setNotice({ kind: 'ok', text: t('noticeSettings') })
        } catch (error: any) {
          setNotice({ kind: 'error', text: error && error.message ? error.message : String(error) })
        }
      }

      const stopRun = async (id) => {
        const ok = await mutate('cancelRun', { id })
        if (ok) setNotice({ kind: 'ok', text: t('noticeCanceled') })
      }

      /** Approve or reject the document of one stage, then re-read the board. */
      const stageAction = async (id, ordinal, action) => {
        try {
          await call(action, { id, ordinal })
          await refresh()
          setNotice({
            kind: 'ok',
            text: action === 'approveStage' ? t('noticeApproved') : t('noticeRejected'),
          })
        } catch (error: any) {
          setNotice({ kind: 'error', text: error && error.message ? error.message : String(error) })
        }
      }

      const stageDoc = (id, ordinal) => call('stageDoc', { id, ordinal })

      const toggleAutoRun = async () => {
        const next = !(runner !== null && runner.autoRun === true)
        try {
          const value = await call('saveSettings', { autoRun: next })
          setRunner(Object.assign({}, runner === null ? {} : runner, value))
          setNotice({ kind: 'ok', text: t('noticeSettings') })
        } catch (error: any) {
          setNotice({ kind: 'error', text: error && error.message ? error.message : String(error) })
        }
      }

      if (phase === 'loading') {
        return h(
          'div',
          { className: 'tc-root' },
          h('div', { className: 'tc-center' }, h('p', { className: 'tc-hint' }, t('title') + '\u2026')),
        )
      }

      if (phase === 'error') {
        return h(
          'div',
          { className: 'tc-root' },
          h(
            'div',
            { className: 'tc-center' },
            h('p', { className: 'tc-error' }, t('loadError')),
            h('p', { className: 'tc-hint' }, failure),
            h('button', { type: 'button', className: 'tc-btn', onClick: () => void refresh() }, t('retry')),
          ),
        )
      }

      const banner: any[] = []
      if (reminders.late > 0) {
        banner.push(h('span', { key: 'late', className: 'tc-pill tc-pill-late' }, t('bannerOverdue', { n: reminders.late })))
      }
      if (reminders.dueToday > 0) {
        banner.push(h('span', { key: 'today', className: 'tc-pill tc-pill-today' }, t('bannerToday', { n: reminders.dueToday })))
      }

      const body =
        mode === 'trash'
          ? h(TrashView, {
              t,
              trash,
              onRestore: (id) => {
                void mutate('restore', { id }).then((ok) => {
                  if (ok) setNotice({ kind: 'ok', text: t('noticeRestored') })
                })
              },
              onPurge: (id) => {
                void mutate('purge', { id }).then((ok) => {
                  if (ok) setNotice({ kind: 'ok', text: t('noticePurged') })
                })
              },
              onClear: () => {
                void mutate('emptyTrash', {}).then((ok) => {
                  if (ok) setNotice({ kind: 'ok', text: t('noticeCleared') })
                })
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
            : h(
                'div',
                { className: 'tc-board' },
                COLUMNS.map((id) =>
                  h(BoardColumn, {
                    key: id,
                    id,
                    t,
                    tasks: columnTasks[id],
                    childrenOf,
                    workspaceNameOf,
                    dragId,
                    active: dropZone === id,
                    onAdd: focusAdd,
                    onOpen: setOpenId,
                    onToggle: toggleTask,
                    onRun: startRun,
                    onCancelRun: stopRun,
                    onDragStart: setDragId,
                    onDragEnd: () => {
                      setDragId('')
                      setDropZone('')
                    },
                    onHover: setDropZone,
                    onDrop: moveTask,
                  }),
                ),
              )

      return h(
        'div',
        { className: 'tc-root' },
        h(
          'header',
          { className: 'tc-head' },
          h(
            'div',
            { className: 'tc-head-row' },
            h('h1', { className: 'tc-heading' }, t('title')),
            h('span', { className: 'tc-count' }, t('countTasks', { n: roots.length })),
            h(
              'div',
              { className: 'tc-views' },
              ['board', 'list', 'trash'].map((id) =>
                h(
                  'button',
                  {
                    key: id,
                    type: 'button',
                    className: 'tc-view-btn' + (mode === id ? ' tc-view-on' : ''),
                    onClick: () => setMode(id),
                  },
                  t(id === 'board' ? 'viewBoard' : id === 'list' ? 'viewList' : 'viewTrash'),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'tc-head-row' },
            h(
              'div',
              { className: 'tc-addbar' },
              h('input', {
                ref: addRef,
                className: 'tc-input tc-addinput',
                value: draft,
                placeholder: t('newPlaceholder'),
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitDraft()
                  }
                },
              }),
              h(Dropdown, {
                className: 'tc-dd-sm',
                value: draftStatus,
                options: COLUMNS.map((id) => ({ value: id, label: t('column.' + id) })),
                onChange: (value) => setDraftStatus(value),
                ariaLabel: t('field.status'),
              }),
              workspaces.length === 0
                ? null
                : h(Dropdown, {
                    className: 'tc-dd-sm tc-dd-ws',
                    value: targetWs,
                    options: [{ value: '', label: t('pickWorkspace') }].concat(
                      workspaces.map((entry) => ({ value: entry.id, label: entry.title })),
                    ),
                    onChange: (value) => setTargetWs(value),
                    ariaLabel: t('targetWs'),
                    title: t('targetWs'),
                  }),
              h('button', { type: 'button', className: 'tc-btn tc-btn-primary', onClick: () => void submitDraft() }, t('create')),
            ),
            h(
              'div',
              { className: 'tc-searchwrap' },
              h(SearchIcon),
              h('input', {
                className: 'tc-input tc-search',
                value: query,
                placeholder: t('search'),
                'aria-label': t('search'),
                onChange: (event) => setQuery(event.target.value),
              }),
            ),
            tags.length === 0
              ? null
              : h(Dropdown, {
                  className: 'tc-dd-sm',
                  value: tag,
                  options: [{ value: '', label: t('allTags') }].concat(tags.map((name) => ({ value: name, label: name }))),
                  onChange: (value) => setTag(value),
                  ariaLabel: t('allTags'),
                }),
            h(
              'button',
              {
                type: 'button',
                className: 'tc-toggle' + (runner !== null && runner.autoRun === true ? ' tc-toggle-on' : ''),
                title: t('autoRunHint'),
                'aria-pressed': runner !== null && runner.autoRun === true,
                disabled: runner !== null && runner.available === false,
                onClick: () => void toggleAutoRun(),
              },
              h('span', { className: 'tc-toggle-dot', 'aria-hidden': true }),
              t(runner !== null && runner.autoRun === true ? 'autoRunOn' : 'autoRunOff'),
            ),
            runner === null || runner.available === false
              ? null
              : h(
                  'label',
                  { className: 'tc-mini', title: t('timeoutHint') },
                  h('span', { className: 'tc-mini-label' }, t('field.timeout')),
                  h('input', {
                    type: 'number',
                    className: 'tc-input tc-num',
                    min: 0,
                    max: 1440,
                    'aria-label': t('field.timeout'),
                    value: String(typeof runner.timeoutMinutes === 'number' ? runner.timeoutMinutes : 30),
                    onChange: (event) => void saveSetting({ timeoutMinutes: Number(event.target.value) }),
                  }),
                ),
            runner === null || runner.available === false
              ? null
              : h(
                  'label',
                  { className: 'tc-mini', title: t('retriesHint') },
                  h('span', { className: 'tc-mini-label' }, t('field.retries')),
                  h('input', {
                    type: 'number',
                    className: 'tc-input tc-num',
                    min: 0,
                    max: 3,
                    'aria-label': t('field.retries'),
                    value: String(typeof runner.retries === 'number' ? runner.retries : 0),
                    onChange: (event) => void saveSetting({ retries: Number(event.target.value) }),
                  }),
                ),
            queuedCount === 0
              ? null
              : h('span', { className: 'tc-queuebadge', title: t('queueHint', { n: concurrency }) }, t('queued') + ' ' + String(queuedCount)),
          ),
          banner.length === 0 ? null : h('div', { className: 'tc-banner' }, banner),
        ),
        h('div', { className: 'tc-body' }, body),
        openTask === null
          ? null
          : h('div', {
              className: 'tc-scrim',
              'aria-hidden': true,
              onClick: () => setOpenId(''),
            }),
        openTask === null
          ? null
          : h(TaskEditor, {
              key: openTask.id,
              t,
              task: openTask,
              subtasks: openSubtasks,
              tasks,
              workspaces,
              permissions,
              globalPreset: runner !== null && typeof runner.preset === 'string' ? runner.preset : defaultPreset,
              onCreateWorkspace: createWorkspace,
              onClose: () => setOpenId(''),
              onPatch: patchOpen,
              onCreateSubtask: async (title) => {
                if (openTask.parentId !== null) {
                  setNotice({ kind: 'error', text: t('subtaskOnlyOneLevel') })
                  return
                }
                const ok = await mutate('create', { title, parentId: openTask.id, status: 'todo' })
                if (ok) setNotice({ kind: 'ok', text: t('noticeCreated') })
              },
              onToggleSubtask: (child) => {
                void mutate('update', { id: child.id, status: child.status === 'done' ? 'todo' : 'done' })
              },
              onDeleteSubtask: (id) => {
                void mutate('delete', { id })
              },
              onOpenTask: (id) => setOpenId(id),
              onStageAction: stageAction,
              onStageDoc: stageDoc,
              onDelete: deleteTask,
            }),
        notice === null
          ? null
          : h('div', { className: 'tc-notice' + (notice.kind === 'error' ? ' tc-notice-error' : '') }, notice.text),
      )
    }

    /** Compare directories the way the desktop host does: case- and separator-insensitive. */
    function samePathKey(path) {
      return String(path).trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }

    function splitTags(raw) {
      return raw
        .split(/[,，、\s]+/)
        .map((value) => value.trim())
        .filter((value) => value !== '')
    }

    // ------------------------------------------------------------------ style

    const PACKAGE_ID = 'dsh-task-center'
    const STYLE_ID = PACKAGE_ID + '/client.css'

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
.tc-input{appearance:none;-webkit-appearance:none;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;height:30px;padding:0 9px;min-width:0;outline:none;transition:border-color .12s ease,background-color .12s ease,outline-color .12s ease}
.tc-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.75}
.tc-input:hover{border-color:var(--dsw-alias-border-l2)}
.tc-input:focus{border-color:var(--dsw-alias-brand-primary);outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent);outline-offset:0}
.tc-input:disabled{opacity:.55;cursor:not-allowed}

/* dropdowns: the list belongs to the panel, so it can match it */
.tc-dd{position:relative;display:inline-block;flex:0 0 auto;min-width:0;max-width:100%}
.tc-dd-block{display:block;width:100%}
.tc-dd-btn{appearance:none;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:30px;min-width:0;padding:0 9px;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;text-align:left;transition:border-color .12s ease,background-color .12s ease}
.tc-dd-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.tc-dd-open>.tc-dd-btn{border-color:var(--dsw-alias-brand-primary)}
.tc-dd-btn:disabled{opacity:.55;cursor:not-allowed}
.tc-dd-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:0}
.tc-dd-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-chevron{flex:none;color:var(--dsw-alias-label-secondary)}
.tc-dd-open .tc-chevron{color:var(--dsw-alias-label-primary)}
.tc-dd-list{z-index:60;overflow-y:auto;padding:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}
.tc-dd-list-inline{position:relative;top:4px;left:auto;width:100%;max-width:none}
.tc-dd-item{padding:6px 9px;border-radius:7px;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tc-dd-item-active{background:var(--dsw-alias-bg-layer-1)}
.tc-dd-item-on{color:var(--dsw-alias-brand-primary);font-weight:600}
.tc-dd-sm .tc-dd-btn{height:30px;padding:0 8px;font-size:12px}
.tc-dd-ws{max-width:168px}

/* numbers: no spinners, steady digits */
input.tc-input[type=number]{appearance:textfield;-moz-appearance:textfield}
input.tc-input[type=number]::-webkit-outer-spin-button,input.tc-input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}

/* dates: keep the native picker legible in both themes */
input.tc-input[type=date]{color-scheme:light dark}

textarea.tc-input{height:auto;resize:vertical;min-height:72px;padding:5px 9px;line-height:1.55}

/* native popups and pickers follow the app theme, not just the OS one */
body[data-ds-dark-theme] input.tc-input[type=date]{color-scheme:dark}
.tc-body,.tc-drawer-body,.tc-blockers{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}

.tc-searchwrap{position:relative;display:flex;align-items:center;flex:0 1 230px;min-width:150px}
.tc-search-icon{position:absolute;left:9px;width:13px;height:13px;color:var(--dsw-alias-label-secondary);pointer-events:none}
.tc-search{width:100%;padding-left:27px;font-size:12px}

/* --------------------------------------------------------------- buttons */
.tc-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;font:inherit;font-size:12px;line-height:1.4;height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease}
.tc-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.tc-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:500}
.tc-btn-primary:hover{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);opacity:.88}
.tc-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,var(--dsw-alias-border-l1))}
.tc-btn-danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);border-color:var(--dsw-alias-state-error-primary)}

.tc-toggle{display:inline-flex;align-items:center;gap:6px;appearance:none;font:inherit;font-size:12px;line-height:1.4;padding:5px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:color .12s ease,border-color .12s ease,background .12s ease}
.tc-toggle:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.tc-toggle:disabled{opacity:.5;cursor:not-allowed}
.tc-toggle-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}
.tc-toggle-on{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
.tc-toggle-on:hover{color:var(--dsw-alias-state-success-primary)}
.tc-toggle-on .tc-toggle-dot{background:var(--dsw-alias-state-success-primary)}
.tc-mini{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.tc-mini-label{color:var(--dsw-alias-label-tertiary)}
.tc-num{width:56px;height:30px;padding:0 6px;font-variant-numeric:tabular-nums;text-align:center}
.tc-queuebadge{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:1.4;padding:3px 9px;border-radius:999px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-variant-numeric:tabular-nums}
.tc-runpill-queued{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.tc-runpill-queued:hover{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 36%,transparent)}
.tc-queue-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}

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

.tc-runbtn{flex:0 0 auto;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0;transition:opacity .12s ease,color .12s ease,border-color .12s ease,background .12s ease}
.tc-card:hover .tc-runbtn,.tc-card:focus-within .tc-runbtn,.tc-runbtn:focus-visible{opacity:1}
.tc-runbtn:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-base)}
.tc-runbtn-failed{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 42%,var(--dsw-alias-border-l1));opacity:1}
.tc-runpill{flex:0 0 auto;margin-left:auto;display:inline-flex;align-items:center;gap:5px;padding:1px 6px 1px 7px;appearance:none;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 36%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:1.6;cursor:pointer;font-variant-numeric:tabular-nums;transition:background .12s ease}
.tc-runpill:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.tc-run-dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:tc-pulse 1.4s ease-in-out infinite}
.tc-run-time{min-width:17px;text-align:right}
.tc-play-icon,.tc-stop-icon{display:block}
@keyframes tc-pulse{0%,100%{opacity:1}50%{opacity:.2}}

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
.tc-crash{padding:18px;display:flex;flex-direction:column;gap:10px}
.tc-crash-title{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-state-error-primary)}
.tc-crash-detail{margin:0;padding:10px;max-height:50vh;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.tc-stagebar{display:flex;align-items:center;gap:6px;margin-top:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.tc-stagebar-dots{display:inline-flex;gap:3px}
.tc-sdot{width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-border-l2);transition:background .15s ease}
.tc-sdot-awaitingapproval{background:var(--dsw-alias-state-warn-primary)}
.tc-sdot-approved,.tc-sdot-running{background:var(--dsw-alias-brand-primary)}
.tc-sdot-done{background:var(--dsw-alias-state-success-primary)}
.tc-sdot-failed{background:var(--dsw-alias-state-error-primary)}
.tc-sdot-current{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:1px}
.tc-stagebar-await{color:var(--dsw-alias-state-warn-primary)}
.tc-stagelist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.tc-stage{display:flex;align-items:center;gap:7px;padding:5px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:12px}
.tc-stage-current{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,var(--dsw-alias-border-l1))}
.tc-stage-no{flex:0 0 auto;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.tc-stage-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.tc-stage-pill{flex:0 0 auto;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.tc-stage-pill.tc-stage-awaitingapproval{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,transparent)}
.tc-stage-pill.tc-stage-failed{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,transparent)}
.tc-stage-pill.tc-stage-done{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,transparent)}
.tc-stage-acts{flex:0 0 auto;display:inline-flex;gap:4px}
.tc-btn-quiet{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}
.tc-btn-quiet:hover{color:var(--dsw-alias-label-primary)}
.tc-doc{margin:0;max-height:260px;overflow:auto;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.tc-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.tc-field-row{display:flex;gap:10px}
.tc-field-half{flex:1 1 0;min-width:0}
.tc-label{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.tc-fieldhint{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);opacity:.8}
.tc-switch{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.tc-switch-check{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.tc-switch-track{position:relative;flex:0 0 auto;width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l2);transition:background .15s ease}
.tc-switch-dot{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:transform .15s ease}
.tc-switch-check:checked+.tc-switch-track{background:var(--dsw-alias-brand-primary)}
.tc-switch-check:checked+.tc-switch-track .tc-switch-dot{transform:translateX(14px)}
.tc-switch-check:focus-visible+.tc-switch-track{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.tc-switch-text{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.tc-switch-check:checked~.tc-switch-text{color:var(--dsw-alias-label-primary)}
.tc-blockers{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto}
.tc-blocker{display:flex;align-items:center;gap:7px;padding:5px 7px;border-radius:7px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);cursor:pointer;border:1px solid transparent}
.tc-blocker:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 7%,transparent)}
.tc-blocker-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}
.tc-blocker-check{flex:0 0 auto;accent-color:var(--dsw-alias-brand-primary);margin:0}
.tc-blocker-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-blocker-done{flex:0 0 auto;font-size:12px;color:var(--dsw-alias-state-success-primary)}
.tc-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.tc-inline{display:flex;gap:8px;align-items:center;min-width:0}
.tc-inline .tc-input{flex:1 1 auto;min-width:0}
.tc-inline .tc-btn{flex:0 0 auto;padding:5px 12px}
.tc-ws{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);padding:0 7px 0 6px;border-radius:6px;max-width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tc-folder-icon{flex:0 0 auto;opacity:.8}
.tc-ws-select{max-width:170px}
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
`


    // Static Client halves receive no `styles` builtin (that symbol belongs to
    // dynamic halves) and `styles` is absent from the module-table seed, so the
    // package ships its own tag. The module system claims it by data-plugin and
    // removes it on unload; insertion stays idempotent across HMR re-runs.
    if (typeof document !== 'undefined') {
      const selector = 'style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']'
      if (document.querySelector(selector) === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = PACKAGE_ID
        tag.dataset.pluginCss = STYLE_ID
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
    }

    // A crash outside React (an event handler, a rejected promise) never reaches
    // the boundary, so it is trapped at the window as well.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('error', (event: any) => {
        reportClientError('window', (event && event.error) || (event && event.message) || 'unknown', event && event.filename ? String(event.filename) + ':' + String(event.lineno) : '')
      })
      window.addEventListener('unhandledrejection', (event: any) => {
        reportClientError('rejection', (event && event.reason) || 'unknown', '')
      })
    }

    // -------------------------------------------------------------- lifecycle

    function apply(ctx) {
      let bound = null
      try {
        ctx.locale.register(NS, DICT)
        bound = ctx.locale.bind(NS)
      } catch (error) {
        bound = null
      }
      if (typeof bound === 'function') {
        fallbackT = bound
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => (fallbackT('nav')), locale: NS },
          PanelIcon,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, PanelShell),
      )
    }

    const name = 'task-center'

    return { inject: ['slots', 'locale'], apply, name }
  },
})
