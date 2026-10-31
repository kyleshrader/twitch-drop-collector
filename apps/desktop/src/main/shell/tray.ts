// The tray icon: status badge, tooltip and menu, refreshed from the miner view.
import type { Menu as MenuType, NativeImage, nativeImage as NativeImageModule } from 'electron'
import type { Tray as TrayType } from 'electron'
import type { MinerView } from '@tdc/ipc-contract'
import { paintBadge, trayContent, type TrayAction, type TrayContent } from './tray-model'

export interface AppTray {
  update(view: MinerView): void
  /** Re-renders the last view, e.g. after the window was shown or hidden. */
  refresh(): void
  destroy(): void
}

/** Tray icon size in DIPs; drawn at twice that for high-DPI screens. */
const ICON_SIZE: Partial<Record<NodeJS.Platform, number>> = { win32: 16, darwin: 18 }

export function createAppTray(deps: {
  Tray: typeof TrayType
  Menu: typeof MenuType
  nativeImage: typeof NativeImageModule
  icon: NativeImage
  platform: NodeJS.Platform
  windowVisible: () => boolean
  onAction: (action: TrayAction) => void
}): AppTray {
  const { Tray, Menu, nativeImage, platform } = deps
  const px = (ICON_SIZE[platform] ?? 22) * 2
  const base = deps.icon.resize({ width: px, height: px, quality: 'best' })

  const icons = new Map<string, NativeImage>()
  const iconFor = (badge: TrayContent['badge']): NativeImage => {
    if (!badge) return base
    const key = badge.join(',')
    let image = icons.get(key)
    if (!image) {
      const bitmap = new Uint8Array(base.toBitmap())
      paintBadge(bitmap, px, badge)
      image = nativeImage.createFromBitmap(Buffer.from(bitmap), {
        width: px,
        height: px,
        scaleFactor: 2
      })
      icons.set(key, image)
    }
    return image
  }

  const tray = new Tray(base)
  let last: MinerView | undefined
  let lastKey = ''

  const render = (view: MinerView): void => {
    const content = trayContent(view, deps.windowVisible())
    const key = JSON.stringify(content)
    if (key === lastKey) return
    lastKey = key
    tray.setImage(iconFor(content.badge))
    tray.setToolTip(content.tooltip)
    // Linux needs the menu set again after any change; doing it every time is simplest.
    tray.setContextMenu(
      Menu.buildFromTemplate(
        content.menu.map((item) =>
          item.kind === 'separator'
            ? { type: 'separator' as const }
            : item.kind === 'status'
              ? { label: item.label, enabled: false }
              : {
                  label: item.label,
                  enabled: item.enabled,
                  click: () => deps.onAction(item.action)
                }
        )
      )
    )
  }

  // Windows and macOS: a click shows or hides the window; the menu is on right-click. Linux
  // desktops differ, so there the menu is the way in.
  if (platform !== 'linux') tray.on('click', () => deps.onAction('toggleWindow'))

  return {
    update(view) {
      last = view
      render(view)
    },
    refresh() {
      if (last) render(last)
    },
    destroy: () => tray.destroy()
  }
}
