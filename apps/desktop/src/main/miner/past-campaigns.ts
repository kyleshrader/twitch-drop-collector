// Campaigns Twitch no longer lists, from the app's saved copies (storage's campaign snapshots):
// what the Library shows for a game's earlier campaigns. A copy that no longer matches the view's
// shape (saved by an older app) is left out rather than shown wrong.
import { CampaignView } from '@tdc/ipc-contract'
import type { CampaignSnapshot } from '@tdc/storage'

export function pastCampaigns(
  snapshots: readonly CampaignSnapshot[],
  listed: ReadonlySet<string>
): CampaignView[] {
  const past: CampaignView[] = []
  for (const s of snapshots) {
    if (listed.has(s.id)) continue
    let json: unknown
    try {
      json = JSON.parse(s.data)
    } catch {
      continue
    }
    const parsed = CampaignView.safeParse(json)
    if (!parsed.success) continue
    // Not listed any more: it's over as far as the app can tell, whatever its end date said.
    past.push({
      ...parsed.data,
      state: 'expired',
      archived: true,
      lastSeenAt: s.savedAt.toISOString()
    })
  }
  return past
}

/** The copy to save: the view as shown now, without what only describes it as past. */
export function snapshotOf(view: CampaignView): Omit<CampaignSnapshot, 'savedAt'> {
  const { archived, lastSeenAt, ...campaign } = view
  void archived
  void lastSeenAt
  return { id: view.id, gameId: view.gameId, data: JSON.stringify(campaign) }
}
