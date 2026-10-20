/**
 * Ambient declarations for the browser half only.
 *
 * The client module loader evaluates this file as a script and hands the
 * factory a single `require`, so `require` and the loader entry point are
 * declared here rather than imported.
 */

/** Resolves a module from the host's static client module table. */
declare function require(id: string): any

/** The panel context slice the browser half is handed by the UI runtime. */
interface ClientContext {
  slots: {
    inject(name: string, register: () => unknown): void
    register(definition: Record<string, unknown>, component: unknown): unknown
  }
  locale?: {
    register(namespace: string, dictionary: Record<string, Record<string, string>>): void
    bind(namespace: string): (key: string) => string
  }
}

interface Window {
  __ModuleLoader__: {
    load(registration: { id: string; factory: (require: (id: string) => any) => unknown }): void
  }
}
