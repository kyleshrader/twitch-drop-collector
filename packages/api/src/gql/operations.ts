// The GQL operations the miner uses. Hashes and variables are what Twitch's own clients send;
// response schemas cover only the fields we read and allow anything else Twitch adds.
// Schemas are derived from how TwitchDropsMiner reads these responses and are checked against
// captured live responses in M7.
import { z } from 'zod'
import { defineOperation } from './operation'

// ---- shared shapes -------------------------------------------------------------------------

export const Game = z.looseObject({
  id: z.string(),
  name: z.string().nullish(),
  displayName: z.string().nullish(),
  slug: z.string().nullish(),
  boxArtURL: z.string().nullish()
})

export const Benefit = z.looseObject({
  id: z.string(),
  name: z.string(),
  distributionType: z.string(),
  imageAssetURL: z.string()
})

export const DropProgress = z.looseObject({
  dropInstanceID: z.string().nullish(),
  isClaimed: z.boolean(),
  currentMinutesWatched: z.number()
})

export const TimeBasedDrop = z.looseObject({
  id: z.string(),
  name: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  requiredMinutesWatched: z.number(),
  preconditionDrops: z.array(z.looseObject({ id: z.string() })).nullish(),
  benefitEdges: z.array(z.looseObject({ benefit: Benefit })).nullish(),
  self: DropProgress.nullish()
})

export const AclChannel = z.looseObject({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullish()
})

export const CampaignDetails = z.looseObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  accountLinkURL: z.string().nullish(),
  game: Game.nullable(),
  self: z.looseObject({ isAccountConnected: z.boolean() }),
  allow: z
    .looseObject({ channels: z.array(AclChannel).nullish(), isEnabled: z.boolean().nullish() })
    .nullish(),
  timeBasedDrops: z.array(TimeBasedDrop)
})

/** Inventory entries carry progress ("self") and get merged with CampaignDetails in core. */
export const InventoryCampaign = z.looseObject({
  id: z.string(),
  timeBasedDrops: z.array(z.looseObject({ id: z.string(), self: DropProgress.nullish() })).nullish()
})

// ---- operations ----------------------------------------------------------------------------

/** In-progress campaigns and already-claimed rewards. */
export const Inventory = defineOperation({
  name: 'Inventory',
  sha256: '8337eb8541b314040b0edde0c09c5c7a2783ba1960aa9edfbf3bac16d0fec404',
  variables: () => ({ fetchRewardCampaigns: false }),
  data: z.looseObject({
    currentUser: z.looseObject({
      inventory: z.looseObject({
        dropCampaignsInProgress: z.array(InventoryCampaign).nullish(),
        gameEventDrops: z
          .array(z.looseObject({ id: z.string(), lastAwardedAt: z.string() }))
          .nullish()
      })
    })
  })
})

/** Every campaign the user can see (active, upcoming, expired). */
export const Campaigns = defineOperation({
  name: 'ViewerDropsDashboard',
  sha256: 'c16bb890cc8ce7647a96ee69cd313d423a378a3dedadf630a1017cde18975feb',
  variables: () => ({ fetchRewardCampaigns: false }),
  data: z.looseObject({
    currentUser: z.looseObject({
      dropCampaigns: z.array(z.looseObject({ id: z.string(), status: z.string() })).nullish()
    })
  })
})

/**
 * Full detail for one campaign. Despite the variable's name, channelLogin must be the user's ID:
 * with the login Twitch returns user: null (checked live, matches upstream).
 */
export const CampaignDetailsQuery = defineOperation({
  name: 'DropCampaignDetails',
  sha256: '039277bf98f3130929262cc7c6efd9c141ca3749cb6dca442fc8ead9a53f77c1',
  variables: (input: { campaignId: string; userId: string }) => ({
    dropID: input.campaignId,
    channelLogin: input.userId
  }),
  data: z.looseObject({
    user: z.looseObject({ dropCampaign: CampaignDetails.nullable() }).nullable()
  })
})

/** Live state of one channel. */
export const StreamInfo = defineOperation({
  name: 'VideoPlayerStreamInfoOverlayChannel',
  sha256: '198492e0857f6aedead9665c81c5a06d67b25b58034649687124083ff288597d',
  variables: (input: { login: string }) => ({ channel: input.login }),
  data: z.looseObject({
    user: z
      .looseObject({
        id: z.string(),
        login: z.string().nullish(),
        displayName: z.string().nullish(),
        stream: z.looseObject({ id: z.string(), viewersCount: z.number() }).nullable(),
        broadcastSettings: z
          .looseObject({ title: z.string().nullish(), game: Game.nullable() })
          .nullish()
      })
      .nullable()
  })
})

/** Which campaigns a channel is currently giving drops for. */
export const AvailableDrops = defineOperation({
  name: 'DropsHighlightService_AvailableDrops',
  sha256: '782dad0f032942260171d2d80a654f88bdd0c5a9dddc392e9bc92218a0f42d20',
  variables: (input: { channelId: string }) => ({ channelID: input.channelId }),
  data: z.looseObject({
    channel: z
      .looseObject({
        id: z.string(),
        viewerDropCampaigns: z.array(z.looseObject({ id: z.string() })).nullish()
      })
      .nullable()
  })
})

/** Live channels for a game, optionally only those with drops enabled. */
export const GameDirectory = defineOperation({
  name: 'DirectoryPage_Game',
  sha256: '86bcceb4e8b1a51256ff8eed8bd8aae4acacf80d737efe904f84f3aeadf8cafd',
  variables: (input: { slug: string; limit: number; dropsEnabledOnly: boolean }) => ({
    limit: input.limit,
    slug: input.slug,
    imageWidth: 50,
    includeCostreaming: false,
    options: {
      broadcasterLanguages: [],
      freeformTags: null,
      includeRestricted: ['SUB_ONLY_LIVE'],
      recommendationsContext: { platform: 'web' },
      sort: 'RELEVANCE',
      systemFilters: input.dropsEnabledOnly ? ['DROPS_ENABLED'] : [],
      tags: [],
      requestID: 'JIRA-VXP-2397'
    },
    sortTypeIsRecency: false
  }),
  data: z.looseObject({
    game: z
      .looseObject({
        streams: z
          .looseObject({
            edges: z.array(
              z.looseObject({
                node: z.looseObject({
                  id: z.string(),
                  title: z.string().nullish(),
                  viewersCount: z.number(),
                  game: Game.nullish(),
                  broadcaster: z
                    .looseObject({
                      id: z.string(),
                      login: z.string(),
                      displayName: z.string().nullish()
                    })
                    .nullable()
                })
              })
            )
          })
          .nullable()
      })
      .nullish()
  })
})

/** The drop the current watch session is progressing. */
export const CurrentDrop = defineOperation({
  name: 'DropCurrentSessionContext',
  sha256: '4d06b702d25d652afb9ef835d2a550031f1cf762b193523a92166f40ea3d142b',
  variables: (input: { channelId: string }) => ({ channelID: input.channelId, channelLogin: '' }),
  data: z.looseObject({
    currentUser: z.looseObject({
      dropCurrentSession: z
        .looseObject({ dropID: z.string(), currentMinutesWatched: z.number() })
        .nullable()
    })
  })
})

export const ClaimDrop = defineOperation({
  name: 'DropsPage_ClaimDropRewards',
  // The twitch.tv version: unlike upstream's older one it reports account-link failures, which
  // still come with status ELIGIBLE_FOR_ALL.
  sha256: '3b8a08f5a35dc95d7de229dea731a106a9aa9fa2e84c8f693fd159943f273e4f',
  variables: (input: { dropInstanceId: string }) => ({
    input: { dropInstanceID: input.dropInstanceId }
  }),
  data: z.looseObject({
    claimDropRewards: z
      .looseObject({
        status: z.string(),
        isUserAccountConnected: z.boolean().nullish(),
        error: z.looseObject({ code: z.string(), message: z.string().nullish() }).nullish()
      })
      .nullable()
  })
})

/** Signed token for the HLS playlist of a live channel. */
export const PlaybackAccessToken = defineOperation({
  name: 'PlaybackAccessToken',
  sha256: 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9',
  variables: (input: { login: string }) => ({
    isLive: true,
    isVod: false,
    login: input.login,
    platform: 'web',
    playerType: 'site',
    vodID: ''
  }),
  data: z.looseObject({
    streamPlaybackAccessToken: z
      .looseObject({ value: z.string(), signature: z.string() })
      .nullable()
  })
})

export const DeleteNotification = defineOperation({
  name: 'OnsiteNotifications_DeleteNotification',
  sha256: '13d463c831f28ffe17dccf55b3148ed8b3edbbd0ebadd56352f1ff0160616816',
  variables: (input: { notificationId: string }) => ({ input: { id: input.notificationId } }),
  data: z.looseObject({})
})
