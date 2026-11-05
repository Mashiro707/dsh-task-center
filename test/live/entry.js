/**
 * Browser-side harness: mounts the real `client.js` panel with the real React
 * and answers its HTTP calls from `window.__FIXTURE__`. Bundled by
 * `test/live-browser.test.mjs`, never shipped.
 */
import './stub.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import * as dom from 'react-dom'
import '../../client.js'

const fixture = window.__FIXTURE__ === undefined ? {} : window.__FIXTURE__

window.fetch = async (url, init = {}) => {
  const route = String(url).split('/task-center/api/')[1] ?? ''
  const body = init.body === undefined ? null : JSON.parse(init.body)
  const value = typeof fixture === 'function' ? fixture(route, body) : fixture[route]
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, value: value === undefined ? null : value }),
  }
}

// The panel reaches for react-dom to portal its dropdown out of the scroll box.
const plugin = window.__factory((id) => {
  if (id === 'react') return React
  if (id === 'react-dom') return dom
  if (id === 'react-dom/client') return ReactDOM
  return null
})
const registered = []
const ctx = {
  slots: {
    inject: (_name, run) => run(),
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
  },
  locale: { register: () => {}, bind: () => (key) => key },
  get: () => undefined,
}
plugin.apply(ctx)

const shell = registered.find(entry => entry.options.name === 'main')
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(shell.component))
