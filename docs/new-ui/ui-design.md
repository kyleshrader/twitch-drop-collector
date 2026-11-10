# New UI design

Agreed with the user, 2026-11-04. The new UI is built in `apps/desktop/src/renderer/src/next/`, beside the classic UI, which stays until the switch-over (see docs/decisions.md, 2026-11-01). Open points are listed at the end. The clickable mockup is [sample-ui-mockup.html](sample-ui-mockup.html); how Up next works, and the rules it can be set to while Twitch's behaviour is unconfirmed, are in [queue-rules.md](queue-rules.md). What is built so far, and what isn't yet, is in docs/decisions.md (2026-11-07).

## Look

- Steam's current client design is the model: its dark palette, spacing, type scale and layout. Not its assets: no Steam logos or brand marks, and Inter instead of Steam's proprietary font. Inter is bundled with the app (the CSP blocks font CDNs, and the app must work offline).
- Steam-style dark is the primary theme. Light mode is a plain standard light theme, with little design work.
- Icons come from lucide-react, through one mapping module (`next/icons`), so any icon can be swapped without touching the screens.
- Twitch campaign art is portrait box art (285×380); there's no wide header art like Steam's. The Current banner uses the box art enlarged, blurred and darkened as its background, with the sharp cover and our own title for the game name over it.
- Minimum window width as now. Layouts for smaller windows come later.

## Structure

- Top navigation, like Steam's Store / Library / Community: **Library**, **Drops** (home) and **History** (history.md). More may come.
- Top right: the account menu, a notifications bell, an app-updates icon, and a "new games" icon.
- Routing with a small hash-based router: back/forward (mouse back button, Alt+←), deep links from notifications, the tray and popovers, the same page after a window crash reloads it, and pages tests can open directly.

## Drops page (home)

Laid out like Steam's Downloads page, with four sections. Excluded campaigns are hidden in every section until that section's "Show excluded (n)" button is pressed.

### Current

- The game's cover over the blurred banner, the campaign's drops as a row of reward images with the current one glowing, the drop and reward names between the images and the progress bar, and "time remaining" beside the progress bar.
- Hovering another drop's image shows its names in place of the current one's.
- A secondary background colour marks the section: a little lighter than the page in dark mode, darker in light mode.
- "Watching _channel_ · viewers", with a change icon that opens a popover listing only channels that can be watched (each other channel says why not).
- A **Pause / Continue** button for mining. Paused shows across the app too, such as a paused icon by the page's entry in the top navigation. (Whether a pause survives a restart is open.)
- Twitch gives only drop names, reward names and images, and required minutes: there is no prose description. A fuller design for this text comes later.

### Up next

- A queue of **game cards**, each holding its campaigns ordered by time remaining.
- **Splitting:** dragging a campaign out of a game splits the game there. Dragging up takes that campaign and the ones above it in the game; dragging down takes it and the ones below. While dragging, a piece visually picks up other pieces of the same game it passes, and they only merge when dropped. Every piece also has Move up / Move down in a menu, so the queue works from the keyboard.
- **Sorting:** a sort menu (each sort explained in a line): _Priority_, then time remaining (default), _Ending soonest_, _Least time to spare_. Priority comes first, and linked games are favoured. A manual drag switches the menu to **Custom** and keeps that order exactly, with a "Reset to …" button. In Custom order, newly appearing campaigns slot in by time remaining and get a "New" tag, so the user's order is never reshuffled.
- **Not set** games are mined too, after priority ones. Each card can be set to Priority, Not set or Excluded.
- **Miss warnings:** the queue is simulated in order, and a campaign that won't finish before it ends gets a warning ("Won't finish in time: needs 3 h, ends in 2 h"), saying so when moving it up would save it. It's an estimate that assumes a watchable channel is always available, and it says that.
- **Collect now** jumps a campaign straight to Current. In Custom order it moves to the top.

### Upcoming

- Campaigns that haven't started, with how long until they start (d/h/m). Hovering shows the full date and time.
- Each can be set to Priority, Not set or Excluded.

### Completed

- Newest completion first, a **Clear all** button, and **×** on each entry. Both hide entries locally; nothing is deleted.
- On the right, like Steam's Play button: **Claimed** (grey) normally, since claims are automatic; **Claim** where auto-claim failed; **Link account to claim** for unlinked games, which opens Twitch's link page.

### Excluded (in every section)

- Shown only with that section's "Show excluded (n)" toggle. Each shows when the campaign was first seen, and can be bumped to Up next or taken off the excluded list.

## Library page

- Every game, like Steam's library view. A left sidebar has: Home, a dropdown (Games for now), grouping and sorting by Recent, by Priority / Not set / Excluded, and by Linked / Not linked / Not needed. There's a search box with a filter dropdown beside it for more filters.
- Clicking a game shows every campaign ever recorded for it: active, unclaimed, completed and missed.

## Header menus

- **Account menu:** settings, sign out, Twitch's inventory and drops pages. Non-menu lines show the last sync time and session details.
- **Notifications (bell):** new games, warnings ("won't finish in time"), and errors.
- **App updates:** a separate icon from notifications, opening its own page.
- **New games:** a popover listing games seen for the first time. Each can be set to Priority or Excluded, opened to see its campaigns, or dismissed with ×.

## Settings

Most settings live on the pages they affect: sorting on Up next, list membership on cards, and so on. Anything left goes on a temporary settings page reached from the account menu.

## Signed out

For now, a compact box with a large green Sign in button in Steam style. While waiting for the login window it turns into a greyed, still-stylish loading state. The full design comes later.

## Data this needs (new)

The app only knows what Twitch reports right now, so a local history is added to the database:

- each campaign's first-seen time, and whether it was completed or missed when it ended
- each claim's time (recorded when the app claims, or taken from Twitch's award time where it's available)
- the games seen before, with a seen/dismissed flag for the "new games" popover
- Completed entries the user has cleared
- the time of the last sync (the miner's last campaign load)
- the queue's Custom order, and the pause state

## Miner changes this needs

- **Pause / Continue.**
- **Collect now:** start a given campaign immediately.
- **Campaign-level queue order:** today the miner ranks channels by game priority. With Custom order it ranks them by the best queue position among the campaigns a channel can progress.
- The miss estimate, run in core so the UI and the miner agree.

## Open

- **Do two campaigns of the same game progress at once while one stream is watched?** A maintained TwitchDropsMiner fork's docs say Twitch may progress several rewards at the same time, and captured data shows all unfinished drops of one campaign moving together. Across campaigns of one game is unconfirmed. If they do progress together, splitting a game can't hold one campaign back while the game is watched; it still matters when the pieces need different channels (allow-lists). To check live before building the split behaviour. Built meanwhile as the `campaignProgress` rule (queue-rules.md), so the estimates follow whichever answer is set. Answered 2026-11-07 by Twitch's developer guide: every campaign live on a channel gets the watch time, so `together` is the recommended default (queue-rules.md, "What Twitch says"); the viewer Help Center disagrees, so the other choice stays.
  - Live check, 2026-11-05: 15 minutes on an Overwatch channel open to any channel moved Reign of Talon S5 Mid from 565 to 578 minutes. OWCS Stage 3 Playoffs stayed at 296, but its allow-list is a single channel (ow_esports_th), so that stream didn't count for it. Inconclusive. To settle it, watch a channel two campaigns both accept; ow_esports_th is the only one that works for those two. What the check does show: allow-lists split same-game campaigns in practice, so the queue has to treat them as separate pieces whatever the answer.
- Does pause survive a restart? (Suggested: yes.)
- Completed: one entry per drop (reward), or per campaign?
- What else goes in the top navigation besides Drops, Library and maybe History / log.
- Layouts for windows narrower than the minimum.
