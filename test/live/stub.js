// Runs before client.js so the loader contract is in place.
window.__factory = null
window.__ModuleLoader__ = {
  load: (module) => {
    window.__factory = module.factory
  },
}
