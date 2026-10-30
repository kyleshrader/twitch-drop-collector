// Dev-only: runs the read-only GQL queries the miner needs against the signed-in session, saves
// the raw responses under userData/gql-probe/, and checks each against our response schemas.
// Used to verify the M6 schemas on live data. Never runs in packaged builds (see index.ts).
import { gql, type GqlOperation, type HttpClient } from '@tdc/api'
import type { AuthService } from '@tdc/core'
import type { Logger } from '@tdc/kernel'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface ProbeResult {
  operation: string
  status: number
  schemaOk: boolean
  issues: string[]
  gqlErrors: unknown
}

function signedIn(auth: AuthService): Promise<string> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const state = auth.state()
      if (state.status === 'signedIn') {
        resolve(state.user.id)
        return true
      }
      if (state.status === 'signedOut') {
        reject(new Error('Not signed in; sign in first, then run the probe again'))
        return true
      }
      return false
    }
    if (check()) return
    const off = auth.onChange(() => {
      if (check()) off()
    })
  })
}

export async function runGqlProbe(deps: {
  auth: AuthService
  http: HttpClient
  gqlUrl: string
  outDir: string
  logger: Logger
}): Promise<void> {
  const { auth, http, gqlUrl, outDir, logger } = deps
  const userId = await signedIn(auth)
  await mkdir(outDir, { recursive: true })
  const results: ProbeResult[] = []

  const run = async <V, D>(
    operation: GqlOperation<V, D>,
    inputs: V[],
    file: string
  ): Promise<unknown[]> => {
    const payload = inputs.map((input) => ({
      operationName: operation.name,
      extensions: { persistedQuery: { version: 1, sha256Hash: operation.sha256 } },
      variables: operation.variables(input)
    }))
    const response = await http.request({
      method: 'POST',
      url: gqlUrl,
      json: payload,
      maxAttempts: 3,
      headers: { Accept: '*/*', ...(await auth.gqlAuth.headers()) }
    })
    await writeFile(join(outDir, file), response.text, 'utf8')
    let items: { data?: unknown; errors?: unknown }[] = []
    try {
      items = JSON.parse(response.text) as typeof items
    } catch {
      // Recorded below as a failed check.
    }
    items.forEach((item, index) => {
      const parsed = operation.data.safeParse(item?.data)
      results.push({
        operation: `${operation.name}[${index}]`,
        status: response.status,
        schemaOk: parsed.success,
        issues: parsed.success
          ? []
          : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        gqlErrors: item?.errors ?? null
      })
    })
    if (items.length === 0) {
      results.push({
        operation: operation.name,
        status: response.status,
        schemaOk: false,
        issues: ['response is not a JSON array'],
        gqlErrors: null
      })
    }
    return items.map((item) => item?.data)
  }

  const [inventoryData] = await run(gql.Inventory, [undefined], 'inventory.json')
  const [campaignsData] = await run(gql.Campaigns, [undefined], 'campaigns.json')
  await run(
    { ...gql.Campaigns, variables: () => ({ fetchRewardCampaigns: true }) },
    [undefined],
    'campaigns-with-rewards.json'
  )

  // Campaign IDs: the dashboard's active ones, else the inventory's not-yet-expired ones.
  const dashboard = gql.Campaigns.data.safeParse(campaignsData)
  const inventory = gql.Inventory.data.safeParse(inventoryData)
  const fromDashboard = dashboard.success
    ? (dashboard.data.currentUser.dropCampaigns ?? []).filter((c) => c.status === 'ACTIVE')
    : []
  const fromInventory = inventory.success
    ? (inventory.data.currentUser.inventory.dropCampaignsInProgress ?? []).filter(
        (c) => (c as { status?: string }).status !== 'EXPIRED'
      )
    : []
  const campaignIds = [...fromDashboard, ...fromInventory].map((c) => c.id).slice(0, 3)
  if (campaignIds.length > 0) {
    await run(
      gql.CampaignDetailsQuery,
      campaignIds.map((campaignId) => ({ campaignId, userId })),
      'campaign-details.json'
    )
  }

  // Channels: the miner's per-channel queries, on live Rust channels with drops enabled.
  const [directoryData] = await run(
    gql.GameDirectory,
    [{ slug: 'rust', limit: 5, dropsEnabledOnly: true }],
    'game-directory.json'
  )
  const directory = gql.GameDirectory.data.safeParse(directoryData)
  const live = directory.success
    ? (directory.data.game?.streams?.edges ?? [])
        .map((e) => e.node.broadcaster)
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .slice(0, 2)
    : []
  if (live.length > 0) {
    await run(
      gql.StreamInfo,
      live.map((b) => ({ login: b.login })),
      'stream-info.json'
    )
    await run(
      gql.AvailableDrops,
      live.map((b) => ({ channelId: b.id })),
      'available-drops.json'
    )
    await run(gql.CurrentDrop, [{ channelId: live[0]!.id }], 'current-drop.json')
    await run(gql.PlaybackAccessToken, [{ login: live[0]!.login }], 'playback-token.json')
  }

  await writeFile(join(outDir, 'summary.json'), JSON.stringify(results, null, 2), 'utf8')
  logger.info('GQL probe finished', {
    outDir,
    checks: results.length,
    passed: results.filter((r) => r.schemaOk).length
  })
}
