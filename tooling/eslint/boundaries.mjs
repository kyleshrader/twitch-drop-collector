// Dependency rules from docs/spec.md ("Repository layout and dependency rules").
// Policies are evaluated in order and the last matching one wins, so each element
// first allows what it may use and then disallows the exceptions.
import boundaries from 'eslint-plugin-boundaries'

const ELEMENTS = [
  { type: 'kernel', pattern: 'packages/kernel' },
  { type: 'core', pattern: 'packages/core' },
  { type: 'api', pattern: 'packages/api' },
  { type: 'storage', pattern: 'packages/storage' },
  { type: 'config', pattern: 'packages/config' },
  { type: 'ipc-contract', pattern: 'packages/ipc-contract' },
  { type: 'ui', pattern: 'packages/ui' },
  { type: 'main', pattern: 'apps/desktop/src/main' },
  { type: 'preload', pattern: 'apps/desktop/src/preload' },
  { type: 'renderer', pattern: 'apps/desktop/src/renderer' }
]

const DOMAIN = ['core', 'api', 'storage', 'config']
const ELECTRON = ['electron', 'electron/**']
const REACT = ['react', 'react/**', 'react-dom', 'react-dom/**']

const from = (...types) => ({ element: { types: { anyOf: types } } })
const toElements = (...types) => ({ to: { element: { types: { anyOf: types } } } })
const toExternal = (source) => ({
  to: { module: { origin: 'external', ...(source && { source }) } }
})
const toNodeBuiltins = { to: { module: { origin: 'core' } } }

const policies = [
  // 1. Domain packages may use npm packages and Node built-ins, but never electron or react.
  { from: from(...DOMAIN), allow: [toExternal(), toNodeBuiltins] },
  {
    from: from(...DOMAIN),
    disallow: [toExternal([...ELECTRON, ...REACT])],
    message: 'Domain packages must not import electron or react; inject an interface instead.'
  },
  // 2. core may import api, storage and config. Those three import nothing from the workspace.
  { from: from('core'), allow: [toElements('api', 'storage', 'config')] },
  // 3. ui imports React and UI/styling libraries only.
  { from: from('ui'), allow: [toExternal()] },
  {
    from: from('ui'),
    disallow: [toExternal(ELECTRON), toNodeBuiltins],
    message: 'ui may import only React and UI or styling libraries.'
  },
  // 4. The renderer may import ui and ipc-contract, plus browser-safe npm packages.
  { from: from('renderer'), allow: [toElements('ui', 'ipc-contract'), toExternal()] },
  {
    from: from('renderer'),
    disallow: [toExternal(ELECTRON), toNodeBuiltins],
    message: 'The renderer must reach main through the preload API, never electron or Node.'
  },
  // 5. The preload script may import only ipc-contract and electron.
  { from: from('preload'), allow: [toElements('ipc-contract'), toExternal(ELECTRON)] },
  // 6. Main may import every package except ui.
  {
    from: from('main'),
    allow: [toElements(...DOMAIN, 'ipc-contract'), toExternal(), toNodeBuiltins]
  },
  // 7. ipc-contract depends only on the validation library.
  { from: from('ipc-contract'), allow: [toExternal(['zod', 'zod/**'])] },
  // 8. kernel imports nothing from the workspace and no runtime APIs (at most the validation
  //    library); every non-UI package and main may import it. See docs/decisions.md.
  { from: from('kernel'), allow: [toExternal(['zod', 'zod/**'])] },
  { from: from(...DOMAIN, 'main'), allow: [toElements('kernel')] },
  // Tests may use the test runner wherever they live.
  { from: { file: { categories: 'test' } }, allow: [toExternal(['vitest', 'vitest/**'])] }
]

export default [
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': ELEMENTS,
      'boundaries/files': [{ category: 'test', pattern: '**/*.test.{ts,tsx}' }],
      'import/resolver': {
        typescript: {
          project: ['packages/*/tsconfig.json', 'apps/desktop/tsconfig.*.json'],
          noWarnOnMultipleProjects: true
        }
      }
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', checkAllOrigins: true, policies }]
    }
  }
]
