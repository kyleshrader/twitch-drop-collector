// IPC channel definitions and schemas, shared by main, preload and renderer. Filled in at M3.
import { z } from 'zod'

export const AppInfo = z.object({ name: z.string(), version: z.string() })
export type AppInfo = z.infer<typeof AppInfo>
