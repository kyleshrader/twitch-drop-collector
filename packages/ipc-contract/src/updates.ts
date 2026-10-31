// App updates: what main's updater is doing, and what the renderer may ask of it.
import { z } from 'zod'

export const UpdateStatus = z.enum([
  /** Updates don't work in this build (a dev build, or a format with no updater). */
  'unsupported',
  /** Not checked yet. */
  'idle',
  'checking',
  'upToDate',
  /** A newer version is out and not downloaded yet. */
  'available',
  'downloading',
  /** Downloaded: installs on Restart now, or when the app quits. */
  'ready',
  'error'
])
export type UpdateStatus = z.infer<typeof UpdateStatus>

export const UpdateView = z.object({
  status: UpdateStatus,
  currentVersion: z.string(),
  /** The newer version, while one is available, downloading or ready. */
  version: z.string().optional(),
  /** Download progress, 0 to 100. */
  percent: z.number().min(0).max(100).optional(),
  /** When the last check finished (ms since the epoch). */
  lastChecked: z.number().optional(),
  /** A short reason, when status is error. */
  error: z.string().optional(),
  /** The user chose Later for this version; the banner stays hidden until the next version. */
  dismissed: z.boolean(),
  /** The offered version is the one the user chose to skip. */
  skipped: z.boolean()
})
export type UpdateView = z.infer<typeof UpdateView>
