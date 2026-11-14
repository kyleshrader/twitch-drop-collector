# History

The History page (`#/history`, the top bar's third link, Alt+3) shows what Drop Collector has done on this computer, newest first: what it watched, what it claimed, which campaigns turned up, and how each campaign ended. Everything comes from the local database. Nothing is fetched from Twitch for it, and nothing leaves the computer.

## What's recorded

| Record                 | Table (migration)                             | When                                                                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A claim                | `claims` (1; `image_url` and `source` from 5) | When the app claims a drop (`source` `app`, the app's own time). Also when the inventory shows a drop claimed with Twitch's award time, for drops claimed elsewhere or before the app kept claims (`source` `twitch`). The first record of a drop is kept.                                   |
| A campaign first seen  | `campaigns_seen` (3)                          | The first inventory load that lists it.                                                                                                                                                                                                                                                      |
| How a campaign stands  | `campaigns_seen` columns from 5               | Each inventory load that finds new campaigns or claims: its dates, how many drops it has and has claimed, and whether the account could earn it then (linked, or a badge or emote campaign with those on).                                                                                   |
| A campaign's full copy | `campaign_snapshots` (7)                      | Whenever campaigns or claims change, and at least every 10 minutes: the whole campaign as the app shows it (picture, dates, channels, every drop with its rewards and progress). The Library shows the last copy of a campaign Twitch no longer lists.                                       |
| Watching               | `watch_sessions` (5)                          | Every minute the miner is watching a channel (not while paused, offline or asleep). Minutes on the same channel, game and campaign join one session across a gap of up to three minutes; anything else starts a new one.                                                                     |
| Things that happened   | `events` (6)                                  | A game put on Priority or Excluded, or taken off (from the settings, so the Library, Up next and the classic UI all count); an account linked for a game (a campaign that needed linking last time no longer does); Pause and Continue; and the app version, at each start where it changed. |

## The timeline

Main builds it (`apps/desktop/src/main/history/history.ts`, unit-tested) and sends it through `history:get`. The kinds of entry:

- **Claim:** the rewards, the game and campaign, the reward's picture, and "Time from Twitch" when the time is Twitch's.
- **Watching:** "Watched for 1 h 20 m on _channel_", with the game, the campaign it progressed, and the start and end times.
- **Campaign ended**, at its end time: _Completed_ (every drop claimed), _ended partly claimed_ (some), _Missed_ (none, though the account could earn it), or _ended_ when the account couldn't earn it. It shows the drops claimed and how long the app watched for it. Claims recorded after the last look count too. Campaigns last seen before migration 5 have no standing and get no entry.
- **Campaign started:** a campaign first seen while upcoming, at its start time.
- **New in your Library:** a game whose first campaigns turned up (after the first load), with those campaigns.
- **List changes:** "_Game_ put on Priority", "excluded", or "taken off its list (Not set)".
- **Linked your account for _game_.**
- **The app:** "Paused all activity", "Resumed mining", and "Updated to version 1.2.0 (from 1.1.0)".
- **New campaigns:** one entry per game for each load that found some. The first load's campaigns were already running when the history started; they're counted ("History begins · 12 campaigns already running"), not listed.

At most 5000 entries go to the page.

## The page

- **Range:** 7 days, 30 days (the default), 90 days or All time, counted from midnight, so 7 days is today and the six days before. Each device remembers the choice. A watch session that ran into the range counts.
- **Totals** for the range: drops claimed, time watched, campaigns completed and campaigns missed, each with a line of context. Clicking a total shows only that kind of entry. Clicking it again shows everything.
- **Show:** Everything, Claims, Watching, Campaigns (new, started and ended), or Library & app (new games, list changes, links, pauses and updates).
- **Search** (Ctrl+F) by game, campaign, drop, reward or channel. Every word must match.
- **Games** beside the timeline, by time watched (or drops claimed when nothing was watched), with a bar each. Clicking one shows only that game; its chip in the toolbar undoes it. Narrower than 1000 px, the list goes under the timeline.
- **Days:** a heading per day ("Today · 10 November", "Yesterday", the weekday this week, then the full date) that stays in view while scrolling, with the day's drops and time watched. A session belongs to the day it started.
- The first 120 entries show, then "Show more". Game names open the game in the Library, and channel names open the channel on Twitch.
- The page reads the history when it opens and every 30 seconds while it's open.

The sums, filters and day groups are in `apps/desktop/src/renderer/src/next/pages/history.ts` (unit-tested). End-to-end tests count watching every half second (`TDC_E2E_WATCH_TICK_MS`, honoured only in unpackaged builds).

## Not done yet

- Clearing the history, or one part of it.
- Missed-campaign notices, and the "new games" popover in ui-design.md, which can be built on the same records.
- Sign-ins and sign-outs, and failed claims, aren't recorded.
