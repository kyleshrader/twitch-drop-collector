// Yarn constraints: package-level rules that ESLint can't see. Run with `yarn constraints`.
/** @typedef {import('@yarnpkg/types').Yarn.Constraints.Context} Context */
const { defineConfig } = require('@yarnpkg/types')
const fs = require('node:fs')
const path = require('node:path')

// Packages with an entry under `catalog:` in .yarnrc.yml must reference it.
const CATALOG = (() => {
  const yaml = fs.readFileSync(path.join(__dirname, '.yarnrc.yml'), 'utf8')
  const block = yaml.split(/^catalog:\s*$/m)[1]?.split(/^\S/m)[0] ?? ''
  return new Set([...block.matchAll(/^ {2}"?([^":\s]+)"?:/gm)].map((m) => m[1]))
})()

// Mirrors dependency rules 1, 2, 7 and 8 (docs/spec.md, docs/decisions.md) at the manifest level.
const DOMAIN = [
  '@tdc/kernel',
  '@tdc/core',
  '@tdc/api',
  '@tdc/storage',
  '@tdc/config',
  '@tdc/ipc-contract'
]
const FORBIDDEN_IN_DOMAIN = ['electron', 'react', 'react-dom']
const ALLOWED_WORKSPACE_DEPS = {
  '@tdc/kernel': [],
  '@tdc/core': ['@tdc/kernel', '@tdc/api', '@tdc/storage', '@tdc/config'],
  '@tdc/api': ['@tdc/kernel'],
  '@tdc/storage': ['@tdc/kernel'],
  '@tdc/config': ['@tdc/kernel'],
  '@tdc/ipc-contract': [],
  '@tdc/ui': []
}
const RUNTIME_DEPS_ALLOWLIST = {
  '@tdc/ipc-contract': ['zod'],
  '@tdc/kernel': ['zod']
}

/** @param {Context} ctx */
function enforcePrivateWorkspaces({ Yarn }) {
  for (const workspace of Yarn.workspaces()) workspace.set('private', true)
}

/** @param {Context} ctx */
function enforceCatalogAndConsistentRanges({ Yarn }) {
  for (const dependency of Yarn.dependencies()) {
    if (dependency.type === 'peerDependencies') continue
    if (CATALOG.has(dependency.ident)) {
      dependency.update('catalog:')
      continue
    }
    for (const other of Yarn.dependencies({ ident: dependency.ident })) {
      if (other.type === 'peerDependencies') continue
      dependency.update(other.range)
    }
  }
}

/** @param {Context} ctx */
function enforceDependencyRules({ Yarn }) {
  for (const dependency of Yarn.dependencies()) {
    const owner = dependency.workspace.ident
    if (owner === null) continue

    if (DOMAIN.includes(owner) && FORBIDDEN_IN_DOMAIN.includes(dependency.ident)) {
      dependency.error(`${owner} must not depend on ${dependency.ident} (spec dependency rule 1)`)
    }

    const allowedWorkspaceDeps = ALLOWED_WORKSPACE_DEPS[owner]
    if (
      allowedWorkspaceDeps &&
      dependency.ident.startsWith('@tdc/') &&
      !allowedWorkspaceDeps.includes(dependency.ident)
    ) {
      dependency.error(`${owner} must not depend on ${dependency.ident} (spec dependency rules)`)
    }

    const runtimeAllowlist = RUNTIME_DEPS_ALLOWLIST[owner]
    if (
      runtimeAllowlist &&
      dependency.type === 'dependencies' &&
      !runtimeAllowlist.includes(dependency.ident)
    ) {
      dependency.error(`${owner} may depend only on ${runtimeAllowlist} (rules 7 and 8)`)
    }
  }
}

/** @param {Context} ctx */
function enforceDesktopPackaging({ Yarn }) {
  const desktop = Yarn.workspace({ ident: '@tdc/desktop' })
  if (!desktop) return

  // electron-builder needs electron as an exact devDependency.
  const electron = Yarn.dependencies({ workspace: desktop, ident: 'electron' })
  if (electron.length === 0) desktop.error('electron must be a devDependency of @tdc/desktop')
  for (const dependency of electron) {
    if (dependency.type !== 'devDependencies') desktop.error('electron must be in devDependencies')
    if (!/^\d+\.\d+\.\d+$/.test(dependency.range)) {
      dependency.error('electron must be pinned to an exact version for electron-builder')
    }
  }

  // Workspace packages are bundled by electron-vite, so they must not be runtime dependencies.
  for (const dependency of Yarn.dependencies({ workspace: desktop, type: 'dependencies' })) {
    if (dependency.ident.startsWith('@tdc/')) {
      dependency.error(`${dependency.ident} is bundled; move it to devDependencies`)
    }
  }
}

module.exports = defineConfig({
  async constraints(ctx) {
    enforcePrivateWorkspaces(ctx)
    enforceCatalogAndConsistentRanges(ctx)
    enforceDependencyRules(ctx)
    enforceDesktopPackaging(ctx)
  }
})
