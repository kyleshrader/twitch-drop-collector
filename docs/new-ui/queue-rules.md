# Up next: the queue and its rules

The new UI's Drops page puts every campaign the miner may mine into one queue, **Up next**. The user can sort it, reorder it and split a game's campaigns apart (for example: Rust for creator X, then a Rocket League campaign, then Rust for creator Y).

What the queue assumes about Twitch's watch time is settled by Twitch's own documentation (see "What Twitch says" below), so those **rules** are fixed in the code (`TWITCH_QUEUE_RULES` in `packages/core/src/queue/queue.ts`), not settings. Until 2026-11-10 they were settings with a recommended value; settings files that still have them are read without them. The user's own preferences about the sorts (`linkedFirst`, `newInCustom`) are settings in the `queue` section, set from Up next's sort menu. The code is in `packages/core/src/queue/`; the settings are in `packages/config/src/schema.ts` (`QueueSettings`).

## What Twitch says

From Twitch's [Drops campaign guide](https://dev.twitch.tv/docs/drops/campaign-guide/) for developers, checked 2026-11-07:

| Question                                                 | Twitch's answer                                                                                               | In the queue                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do a campaign's drops progress together?                 | Yes: "All Drops created will increase their accrued Watch Time simultaneously."                               | `dropProgress`: `together`.                                                                                                                                                                                                                 |
| Can drops in one campaign need different watch times?    | Yes: each drop has its own requirement, and campaigns can mix watch-time and subscription drops.              | Built in: each drop keeps its own minutes. Drops that need no watch time (subscription drops) don't count towards the time a campaign needs. Not a setting.                                                                                 |
| Can one drop in a campaign be progressed before another? | No: watch-time drops progress together, and the thresholds decide when each is earned.                        | Built in: the queue orders campaigns, never the drops inside one. Not a setting.                                                                                                                                                            |
| Do campaigns live on the same channel progress together? | Yes: "progress towards a campaign will be awarded to every campaign currently live on a given channel."       | `campaignProgress`: `together`.                                                                                                                                                                                                             |
| Can one campaign of a game be progressed before another? | Twitch has no campaign priority: what progresses depends on which campaigns accept the channel being watched. | So the only way to hold a campaign back is to watch channels it doesn't accept. `split`: `byChannels`, so campaigns that accept the same channels stay together, and splits go between different channel lists (such as creator campaigns). |

Twitch's viewer Help Center has said that only one campaign progresses at a time, which conflicts with the developer guide. Our own live check (ui-design.md, "Open") couldn't settle it, because the two campaigns accepted different channels. If watching ever shows the Help Center is right, change `TWITCH_QUEUE_RULES` to `campaignProgress: separate` and `split: free`; the queue still handles those values, and its tests cover them.

## The model

- The queue is a **list of campaign IDs**. A custom order is stored as exactly that (`queue.order`).
- A **piece** is a run of neighbouring campaigns that belong together under the current layout. The page draws one card per piece. Pieces are never stored: they're worked out from the order every time. So "splitting" a game is just moving a campaign away from its neighbours, and two pieces of a game merge by themselves when they end up next to each other.
- Which campaigns are in the queue: the active, unfinished campaigns of games that aren't excluded, which the account can earn (linked, or a badge or emote campaign with badges and emotes on). The campaign being mined now is shown in **Current**, not in Up next. Excluded games' campaigns are listed apart, under "Show excluded".
- When `mining.priorityMode` is "priority only", Not set games stay in the queue, marked as not mined, with a button to mine them too.

## Grouping (`queue.layout`)

How the Drops page groups the queue into cards, shown as "Group by: Game | Campaign" above Up next. Both use the same order underneath, so switching never loses a custom order.

| Group by          | A card is                          | Good for                                                                 |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `games` (default) | a run of the same game's campaigns | the mockup's design: one card per game, split by dragging a campaign out |
| `campaigns`       | one campaign                       | full control: every campaign is its own card, ordered freely             |

Every card says which channels count. When all of a card's campaigns accept the same channels, the card's header says so once ("Any channel", or "Only on a, b, c and 2 more"); otherwise each campaign says its own. A third grouping, one card per game and channel list, was dropped on 2026-11-10: with the channel lists always shown, it only repeated what the split rule already does.

## Sorting (`queue.sort`, `queue.baseSort`)

- `priority` (default): Priority games first, in the priority list's order, then by least time still needed.
- `ending`: ending soonest first.
- `spare`: least time to spare first (time until it ends, minus time still needed).
- `custom`: the stored order, exactly. Any drag or Move up / Move down switches to `custom`, starting from the order shown. `baseSort` remembers the automatic sort it came from, for "Reset to …". Custom can't be picked from the menu; picking an automatic sort replaces it.

In the automatic sorts, cards are compared by their best campaign. Inside a card, campaigns are in ending-soonest order. Grouped by campaign, campaigns are compared one by one.

The sort menu explains each sort in a line, and holds the two preferences below.

## Rules and preferences

The rules (fixed, as Twitch's guide says):

| Rule                                                                         | Value        | What it changes                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `split`: may a game's campaigns be reordered apart?                          | `byChannels` | Only campaigns with different allow-lists can be separated; campaigns that accept the same channels stay together. The order is normalised on every read: campaigns that must stay together are pulled up to the first one's position. |
| `dropProgress`: do a campaign's drops progress together?                     | `together`   | One watch advances every unfinished drop, so a campaign needs as long as its longest drop chain: the estimates, the miss warnings, and the "least time needed" and "time to spare" sorts.                                              |
| `campaignProgress`: do campaigns of one game progress together on a channel? | `together`   | Time spent on a campaign also counts for later campaigns of the same game that accept a shared channel, and their cards say "Progresses with …". It can't change what Twitch does, only what we predict.                               |

The preferences (settings, in the sort menu):

| Setting                                          | Options                                                                                                                                                | What it changes                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `linkedFirst`: "Linked games first"              | `true` (default) / `false`                                                                                                                             | In the automatic sorts, games with a linked account come before games that need linking (when such campaigns are mined at all). |
| `newInCustom`: "New campaigns in a custom order" | `byTimeRemaining` (default): right after the last campaign in the order that ends sooner, so the user's top choices stay on top. `end`: at the bottom. | New campaigns get a "New" tag in a custom order until the order is changed again.                                               |

## Collect now, pause

- **Collect now** (`queue.focus`): in a custom order the campaign moves to the top of the order. In an automatic sort it's kept as the focus, ranked first until it finishes or ends, so the sort stays as it was.
- **Pause** (`queue.paused`): the miner stops watching and keeps everything else. It survives a restart (the suggested answer to the open point in ui-design.md), and the tray and header show it.

## How the miner follows the queue

While the new UI is on (`general.ui` is `next`), the miner ranks channels by the queue: a channel's rank is the best queue position among the campaigns watching it would progress. The campaign shown as progressing is likewise the earnable one ranked highest. With the classic UI the miner keeps the classic rules (priority list and `priorityMode`), so nothing changes for it. At the switch-over the classic path goes.

## Miss warnings (an estimate)

The queue is played forward in order: first the time the current campaign still needs, then each campaign's needed time in turn. A campaign whose start plus needed time lands after it ends gets "Won't finish in time", and the warning says whether moving it to the top would save it. The estimate assumes a watchable channel is always there, and ignores drop windows that close before their campaign ends. The warning says that.

## Not done yet

- "Bump to Up next" for a single excluded campaign. The miner skips excluded games outright, so this needs the miner to mine one campaign of an otherwise excluded game. Excluded campaigns offer "Remove from excluded" and "Priority" instead.
- New-game notices. The History page and the records it needs are built (history.md); the notices can use the same records.
- The visual "picks up neighbouring pieces while dragging". Pieces merge when dropped next to each other, which is the behaviour; only the in-flight animation is missing.
