/**
 * Ambient declarations for the host half only.
 *
 * The Cordis host injects its services at runtime and this package deliberately
 * carries no `@deepseek-ai/*` dependency, so only the surface this plugin
 * actually touches is declared here.
 */

/** Disposer returned by every host registration. */
type HostDisposer = () => void

/** Minimal logger surface; every method is optional on the real service. */
interface HostLogger {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
  debug?(message: string): void
}

/** HTTP route registration. */
interface HostWebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void | Promise<void>
  }): HostDisposer
}

/** One rendered, model-facing tool result. */
interface HostToolOutput {
  schema: Record<string, unknown>
  render(args: unknown, value: unknown): { type: string; text: string }[]
}

/** One agent tool definition, in the shape this plugin registers. */
interface HostToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: HostToolOutput
  execute(input: Record<string, unknown>): unknown | Promise<unknown>
}

/** Agent tool registration. */
interface HostTools {
  register(definition: HostToolDefinition): HostDisposer
}

/** One live session identity, as the session services expose it. */
interface HostSession {
  id: string
}

/** One live agent driving a session. */
interface HostAgent {
  id: string
  readonly session: HostSession
  readonly status: string
  /** Queue one user message for the next turn and wake the loop. */
  followup(input: HostUserMessage): void
}

/** The hand-built user message the runner admits into a fresh session. */
interface HostUserMessage {
  id: string
  role: 'user'
  content: { type: 'text'; text: string }[]
  source: { kind: 'user' }
}

/** `{ agent }` when the session is live, `{ error }` when it is not. */
type HostResolvedAgent = { agent: HostAgent; error?: undefined } | { agent?: undefined; error: unknown }

/** Session lifecycle, as far as the runner needs it. */
interface HostSessionController {
  create(request: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }): Promise<{ sessionId: string }>
  resolveAgent(sessionId: string): Promise<HostResolvedAgent>
  cancel?(request: { sessionId: string }): unknown
}

/** One durable DSH workspace: a title plus the directory it owns. */
interface HostWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
}

/** Workspace registry (`ctx.workspaceRegistry`). */
interface HostWorkspaceRegistry {
  list(): HostWorkspace[]
  get(id: string): HostWorkspace | undefined
  create(path: string, title?: string): Promise<HostWorkspace>
}

/** One permission preset the Host can install on a session. */
interface HostPresetOption {
  value: string
  name: string
  description?: string
}

/** Pick-and-apply surface for permission presets. */
interface HostPermissionPresets {
  catalog(): { options: HostPresetOption[]; defaultPreset?: string }
  set(session: HostSession, name: string): void
  resolve(name: string): { sandbox?: string; approval?: string } | undefined
}

/** One `tool/call` entry as the session log records it. */
interface HostToolCallEvent {
  type: 'tool/call'
  data?: {
    turn?: number
    step?: number
    callId?: string
    name?: string
    arguments?: unknown
  }
}

/** Any other session-log entry; only `type` is read. */
interface HostSessionEvent {
  type: string
  data?: unknown
}

/** One approval the tool pipeline wants answered. */
interface HostApprovalRequest {
  agent: HostAgent
  toolName: string
  callId?: string
  reason?: string
  displayReason?: unknown
  signal?: AbortSignal
}

/** What an approval answerer may return. */
type HostApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** The Cordis context handed to `apply`. */
interface HostContext {
  webServer: HostWebServer
  tools: HostTools
  logger?: HostLogger
  effect<T>(run: () => T, label?: string): T
  /** Resolve one optional host service by name; undefined when not composed. */
  get?<T = unknown>(service: string): T | undefined
  /** Subscribe to one host event; the subscription dies with the context. */
  on(event: string, listener: (...args: any[]) => unknown): HostDisposer | void
}
