// The renderer's view of auth state mirrors @tdc/core's AuthState, which holds no token.
import type { AuthState, SignInMethod } from '@tdc/core'
import { AuthStateView, SignInMethod as SignInMethodSchema } from '@tdc/ipc-contract'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'

describe('auth transport schema', () => {
  it('has the same type as the core auth state', () => {
    expectTypeOf<AuthStateView>().toEqualTypeOf<AuthState>()
    expectTypeOf<z.infer<typeof SignInMethodSchema>>().toEqualTypeOf<SignInMethod>()
  })

  it('strips anything that is not declared, such as a token', () => {
    const leaked = {
      status: 'signedIn',
      user: { id: '1', login: 'kyle', accessToken: 'secret' },
      verified: true,
      accessToken: 'secret'
    }
    const parsed = AuthStateView.parse(leaked)
    expect(JSON.stringify(parsed)).not.toContain('secret')
  })
})
