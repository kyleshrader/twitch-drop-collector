// Which channels the Current card's "Change" menu offers for a campaign.
import type { CampaignView, ChannelView } from '@tdc/ipc-contract'

/**
 * The channels that count for `campaign`: the ones it allows, when it has a list; otherwise the
 * ones streaming its game (but not channels another campaign's list brought in, which may be
 * streaming something else). The channel being watched always stays, so it shows as checked.
 * Watchable ones first, then by viewers.
 */
export function channelsFor(
  campaign: Pick<CampaignView, 'game' | 'allowedLogins'>,
  channels: readonly ChannelView[],
  watchingId: string | undefined
): ChannelView[] {
  const allowed = new Set((campaign.allowedLogins ?? []).map((l) => l.toLowerCase()))
  const counts = (c: ChannelView): boolean =>
    allowed.size > 0 ? allowed.has(c.login.toLowerCase()) : !c.aclBased && c.game === campaign.game
  return channels
    .filter((c) => counts(c) || c.id === watchingId)
    .sort(
      (a, b) =>
        Number(a.unwatchable !== undefined) - Number(b.unwatchable !== undefined) ||
        (b.viewers ?? -1) - (a.viewers ?? -1)
    )
}
