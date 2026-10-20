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
  create(request: { cwd?: string; sessionId?: string; agentPreset?: string }): Promise<{ sessionId: string }>
  resolveAgent(sessionId: string): Promise<HostResolvedAgent>
  cancel?(request: { sessionId: string }): unknown
}

/** One permission preset the Host can install on a session. */
interface HostPresetOption {
  value: string
  name: string
  description?: string
}

/** Pick-and-apply surface for permission presets. */
interface HostPermissionPresets {
  catalog(): { options: HostPresetOption[] }
  set(session: HostSession, name: string): void
  resolve(name: string): { sandbox?: string; approval?: string } | undefined
}

/** The Cordis context handed to `apply`. */
interface HostContext {
  webServer: HostWebServer
  tools: HostTools
  logger?: HostLogger
  effect<T>(run: () => T, label?: string): T
  /** Resolve one optional host service by name; undefined when not composed. */
  get<T = unknown>(service: string): T | undefined
  /** Subscribe to one host event; the subscription dies with the context. */
  on(event: string, listener: (...args: never[]) => void): HostDisposer | void
}
