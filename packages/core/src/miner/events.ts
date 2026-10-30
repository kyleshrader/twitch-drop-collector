// PubSub payloads the miner reacts to. Loose: Twitch adds fields; we only read these.
import { z } from 'zod'

/** user-drop-events.<userId> */
export const DropEvent = z.discriminatedUnion('type', [
  z.looseObject({
    type: z.literal('drop-progress'),
    data: z.looseObject({
      drop_id: z.string(),
      current_progress_min: z.number(),
      required_progress_min: z.number().optional()
    })
  }),
  z.looseObject({
    type: z.literal('drop-claim'),
    data: z.looseObject({ drop_id: z.string(), drop_instance_id: z.string() })
  })
])
export type DropEvent = z.infer<typeof DropEvent>

/** video-playback-by-id.<channelId> */
export const StreamStateEvent = z.looseObject({
  type: z.string(),
  viewers: z.number().optional()
})

/** onsite-notifications.<userId> */
export const NotificationEvent = z.looseObject({
  type: z.string(),
  data: z
    .looseObject({
      notification: z.looseObject({ id: z.string(), type: z.string() }).optional()
    })
    .optional()
})

/** Notifications that mean a reward was granted: re-fetch the inventory. */
export const REWARD_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'user_drop_reward_reminder_notification',
  'quests_viewer_reward_campaign_earned_emote'
])
