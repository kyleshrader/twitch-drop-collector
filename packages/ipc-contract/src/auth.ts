// What the renderer may know about the Twitch session: who is signed in, never the token.
// apps/desktop/src/main/ipc/auth-contract.test.ts keeps this equal to @tdc/core's AuthState.
import { z } from 'zod'

export const SignInMethod = z.enum(['loginWindow', 'deviceCode'])

export const AuthStateView = z.discriminatedUnion('status', [
  z.object({ status: z.literal('restoring') }),
  z.object({ status: z.literal('signedOut'), message: z.string().optional() }),
  z.object({
    status: z.literal('signingIn'),
    method: SignInMethod,
    deviceCode: z
      .object({ userCode: z.string(), verificationUri: z.string(), expiresAt: z.string() })
      .optional()
  }),
  z.object({
    status: z.literal('signedIn'),
    user: z.object({ id: z.string(), login: z.string() }),
    verified: z.boolean()
  })
])
export type AuthStateView = z.infer<typeof AuthStateView>
