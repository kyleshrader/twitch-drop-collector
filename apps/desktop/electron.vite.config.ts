import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// The renderer talks to nothing but its own origin; network calls go through main.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-src 'none'"
]

// Dev only: Vite injects the React Refresh preamble and CSS as inline tags.
const DEV_CSP = CSP.map((directive) =>
  /^(script|style)-src /.test(directive) ? `${directive} 'unsafe-inline'` : directive
)

function contentSecurityPolicy(): Plugin {
  return {
    name: 'tdc:content-security-policy',
    transformIndexHtml: (html, ctx) =>
      html.replace('__CONTENT_SECURITY_POLICY__', (ctx.server ? DEV_CSP : CSP).join('; '))
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), contentSecurityPolicy()]
  }
})
