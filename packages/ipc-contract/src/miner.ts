// What the renderer sees of the miner: plain, serialisable views built in main.
import { z } from 'zod'

export const ChannelView = z.object({
  id: z.string(),
  login: z.string(),
  displayName: z.string().optional(),
  aclBased: z.boolean(),
  online: z.boolean(),
  game: z.string().optional(),
  viewers: z.number().optional(),
  dropsEnabled: z.boolean().optional()
})
export type ChannelView = z.infer<typeof ChannelView>

export const DropView = z.object({
  id: z.string(),
  name: z.string(),
  minutes: z.number(),
  requiredMinutes: z.number(),
  claimed: z.boolean(),
  /** Finished, but only claimable once the game account is connected. */
  awaitsConnection: z.boolean(),
  rewards: z.array(z.string()),
  imageUrl: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string()
})
export type DropView = z.infer<typeof DropView>

export const CampaignView = z.object({
  id: z.string(),
  name: z.string(),
  game: z.string(),
  imageUrl: z.string().optional(),
  state: z.enum(['active', 'upcoming', 'expired']),
  linked: z.boolean(),
  linkUrl: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  allowListed: z.boolean(),
  drops: z.array(DropView)
})
export type CampaignView = z.infer<typeof CampaignView>

export const MinerView = z.object({
  /** `paused`: offline or the computer is asleep; mining resumes by itself. */
  status: z.enum(['stopped', 'loading', 'idle', 'watching', 'error', 'paused']),
  message: z.string().optional(),
  watching: ChannelView.optional(),
  active: z
    .object({
      campaignId: z.string(),
      campaign: z.string(),
      game: z.string(),
      drop: DropView.optional()
    })
    .optional(),
  wanted: z.array(z.string()),
  channels: z.array(ChannelView),
  campaigns: z.array(CampaignView)
})
export type MinerView = z.infer<typeof MinerView>

export const SelectChannelInput = z.object({ channelId: z.string().optional() })
