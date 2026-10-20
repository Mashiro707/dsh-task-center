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

/** The Cordis context handed to `apply`. */
interface HostContext {
  webServer: HostWebServer
  tools: HostTools
  logger?: HostLogger
  effect<T>(run: () => T, label?: string): T
}
