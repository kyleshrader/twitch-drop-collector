# Up next: the queue and its rules

The new UI's Drops page puts every campaign the miner may mine into one queue, **Up next**. The user can sort it, reorder it and split a game's campaigns apart (for example: Rust for creator X, then a Rocket League campaign, then Rust for creator Y).

Every assumption the queue makes about Twitch is a **rule**: a setting in the `queue` section, shown on the new UI's Settings page under "Queue rules". The rules about what Twitch does have a **recommended** value, taken from Twitch's own documentation (see "What Twitch says" below). The recommended values are the defaults, and Settings has "Reset to recommended" for them. The other choices stay, in case Twitch behaves differently from its docs. The code is in `packages/core/src/queue/`; the settings are in `packages/config/src/schema.ts` (`QueueSettings`, `RECOMMENDED_QUEUE_RULES`).

## What Twitch says

From Twitch's [Drops campaign guide](https://dev.twitch.tv/docs/drops/campaign-guide/) for developers, checked 2026-11-07:

| Question                                                 | Twitch's answer                                                                                               | In the queue                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do a campaign's drops progress together?                 | Yes: "All Drops created will increase their accrued Watch Time simultaneously."                               | `dropProgress`, recommended `together`.                                                                                                                                                                                                              |
| Can drops in one campaign need different watch times?    | Yes: each drop has its own requirement, and campaigns can mix watch-time and subscription drops.              | Built in: each drop keeps its own minutes. Drops that need no watch time (subscription drops) don't count towards the time a campaign needs. Not a setting.                                                                                          |
| Can one drop in a campaign be progressed before another? | No: watch-time drops progress together, and the thresholds decide when each is earned.                        | Built in: the queue orders campaigns, never the drops inside one. Not a setting.                                                                                                                                                                     |
| Do campaigns live on the same channel progress together? | Yes: "progress towards a campaign will be awarded to every campaign currently live on a given channel."       | `campaignProgress`, recommended `together`.                                                                                                                                                                                                          |
| Can one campaign of a game be progressed before another? | Twitch has no campaign priority: what progresses depends on which campaigns accept the channel being watched. | So the only way to hold a campaign back is to watch channels it doesn't accept. `split`, recommended `byChannels`: campaigns that accept the same channels stay together, and splits go between different channel lists (such as creator campaigns). |

Twitch's viewer Help Center has said that only one campaign progresses at a time, which conflicts with the developer guide. Our own live check (ui-design.md, "Open") couldn't settle it, because the two campaigns accepted different channels. If watching shows the Help Center is right, set `campaignProgress` to `separate` and `split` to `free`.

## The model

- The queue is a **list of campaign IDs**. A custom order is stored as exactly that (`queue.order`).
- A **piece** is a run of neighbouring campaigns that belong together under the current layout. The page draws one card per piece. Pieces are never stored: they're worked out from the order every time. So "splitting" a game is just moving a campaign away from its neighbours, and two pieces of a game merge by themselves when they end up next to each other.
- Which campaigns are in the queue: the active, unfinished campaigns of games that aren't excluded, which the account can earn (linked, or a badge or emote campaign with badges and emotes on). The campaign being mined now is shown in **Current**, not in Up next. Excluded games' campaigns are listed apart, under "Show excluded".
- When `mining.priorityMode` is "priority only", Not set games stay in the queue, marked as not mined, with a button to mine them too.

## Layouts (`queue.layout`)

How the Drops page groups the queue into cards. All three use the same order underneath, so switching layouts never loses a custom order.

| Layout            | A card is                                                        | Good for                                                                                   |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `games` (default) | a run of the same game's campaigns                               | the mockup's design: one card per game, split by dragging a campaign out                   |
| `channels`        | a run of the same game's campaigns that accept the same channels | creator campaigns: each creator's allow-list gets its own card, labelled with its channels |
| `campaigns`       | one campaign                                                     | full control: every campaign is its own row, ordered freely                                |

## Sorting (`queue.sort`, `queue.baseSort`)

- `priority` (default): Priority games first, in the priority list's order, then by least time still needed.
- `ending`: ending soonest first.
- `spare`: least time to spare first (time until it ends, minus time still needed).
- `custom`: the stored order, exactly. Any drag or Move up / Move down switches to `custom`, starting from the order shown. `baseSort` remembers the automatic sort it came from, for "Reset to …".

In the automatic sorts, cards are compared by their best campaign. Inside a card, campaigns are in ending-soonest order. In the `campaigns` layout, campaigns are compared one by one.

## Rules (fields of `queue`)

Each rule is its own field (`queue.split`, `queue.dropProgress`, and so on), so one bad value in the settings file resets only that rule.

| Rule                                                                                     | Options                                                                                                                                                                                                                                           | What it changes                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `split`: may a game's campaigns be reordered apart?                                      | `byChannels` (recommended, default): only campaigns with different allow-lists can be separated; campaigns that accept the same channels stay together. `free`: any campaign can move anywhere. `never`: a game's campaigns always stay together. | The order is normalised on every read: under `byChannels` or `never`, campaigns that must stay together are pulled up to the first one's position. The Move menus only offer what the rule allows.                                        |
| `dropProgress`: do a campaign's drops progress together?                                 | `together` (recommended, default; Twitch's docs and captured data agree): one watch advances every unfinished drop, so a campaign needs as long as its longest drop chain. `oneAtATime`: drops progress one after another, so it needs the sum.   | The time a campaign still needs: the estimates, the miss warnings, and the "least time needed" and "time to spare" sorts.                                                                                                                 |
| `campaignProgress`: do campaigns of one game progress together on a channel both accept? | `together` (recommended, default): every campaign of the game that accepts the watched channel progresses too. `separate`: only the campaign being mined progresses (what the viewer Help Center says).                                           | The estimates: under `together`, time spent on a campaign also counts for later campaigns of the same game that accept a shared channel, and their cards say "Progresses with …". It can't change what Twitch does, only what we predict. |
| `linkedFirst`                                                                            | `true` (default) / `false`                                                                                                                                                                                                                        | In the automatic sorts, games with a linked account come before games that need linking (when such campaigns are mined at all).                                                                                                           |
| `newInCustom`: where do new campaigns go in a custom order?                              | `byTimeRemaining` (default): right after the last campaign in the order that ends sooner, so the user's top choices stay on top. `end`: at the bottom.                                                                                            | New campaigns get a "New" tag in a custom order until the order is changed again.                                                                                                                                                         |

## Collect now, pause

- **Collect now** (`queue.focus`): in a custom order the campaign moves to the top of the order. In an automatic sort it's kept as the focus, ranked first until it finishes or ends, so the sort stays as it was.
- **Pause** (`queue.paused`): the miner stops watching and keeps everything else. It survives a restart (the suggested answer to the open point in ui-design.md), and the tray and header show it.

## How the miner follows the queue

While the new UI is on (`general.ui` is `next`), the miner ranks channels by the queue: a channel's rank is the best queue position among the campaigns watching it would progress. The campaign shown as progressing is likewise the earnable one ranked highest. With the classic UI the miner keeps the classic rules (priority list and `priorityMode`), so nothing changes for it. At the switch-over the classic path goes.

## Miss warnings (an estimate)

The queue is played forward in order: first the time the current campaign still needs, then each campaign's needed time in turn. A campaign whose start plus needed time lands after it ends gets "Won't finish in time", and the warning says whether moving it to the top would save it. The estimate assumes a watchable channel is always there, and ignores drop windows that close before their campaign ends. The warning says that.

## Not done yet

- "Bump to Up next" for a single excluded campaign. The miner skips excluded games outright, so this needs the miner to mine one campaign of an otherwise excluded game. Excluded campaigns offer "Remove from excluded" and "Priority" instead.
- New-game notices, missed-campaign records and the History page. First-seen times and claim times are recorded now (docs/decisions.md, 2026-11-07); the rest of the history data in ui-design.md ("Data this needs") is still to come.
- The visual "picks up neighbouring pieces while dragging". Pieces merge when dropped next to each other, which is the behaviour; only the in-flight animation is missing.
