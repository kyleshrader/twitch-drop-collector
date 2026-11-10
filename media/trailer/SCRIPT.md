# Trailer script

About a minute, over a lofi hip-hop track. The scenes are timed on a 170 BPM bar grid (one bar is 1.41 s), and every cut lands on a bar line. 1920 × 1080, 30 fps.

## Frame

```
┌──────────────────────────────────────────────────────────────┐  1920 × 1080
│  ▌ HEADER (big, fades and slides in)            01 / 06      │  top band, 150 px
│  ▌ sub line                                                  │
│      ┌──────────────────────────────────────────────────┐    │
│      │                                                  │    │
│      │            the app, 1440 × 810 (16:9)            │    │  centred, 240 px each side
│      │                                                  │    │
│      └──────────────────────────────────────────────────┘    │
│  ━━━━ caption bar: one line of what you're seeing ━━━━       │  bottom band, 120 px
└──────────────────────────────────────────────────────────────┘
```

- Background: deep blue-black with a soft accent glow behind the window, and thin accent bars that sweep in at each scene.
- The window has rounded corners and a shadow, so it reads as an app on a desk, not a screenshot.
- The header slides up 24 px and fades in over 0.4 s, a beat after the cut. The caption bar wipes in from the left. Both fade out before the next cut.
- Scene numbers (01 / 06) sit top right in the faint text colour.
- Type: Inter (the app's own font). Headers 64 px bold, sub lines 28 px, captions 26 px.

## Data

The scenes use the real history from the maintainer's own database (claims, campaigns seen, games and their box art, Priority and Excluded lists), with the account replaced by a demo account. The live parts, like the campaign being watched, Up next and the channels, come from the mock Twitch the end-to-end tests use. They're anonymised captures of real Twitch responses, with dates moved to now. Nothing in the video talks to Twitch.

## Scenes

| #   | Bars  | Time        | Header / sub line                                                                                | On screen                                                                                                                              | Caption                                                          | Into next  |
| --- | ----- | ----------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| 0   | 0–4   | 0:00–0:05.6 | Logo, **Twitch Drop Collector** / "Your Twitch drops, collected while you get on with your day." | Title card: the pickaxe mark, the name, the sub line. The drums come in on bar 2.                                                      | none                                                             | fade       |
| 1   | 4–10  | 0:05.6–0:14 | **It watches for you** / "Picks a stream, earns the drops, claims them."                         | Drops page: Current watching a channel, the progress bar moving, drop list expanding. The mouse opens the channel menu.                | Watches the right stream in the background and claims as it goes | slide left |
| 2   | 10–16 | 0:14–0:22.6 | **Your queue, your order** / "Drag, sort, collect now."                                          | Up next: open the sort menu, pick Ending soonest, drag a card up, Collect now on a campaign. The "won't finish in time" warning shows. | Every campaign it can earn, in the order you want                | wipe up    |
| 3   | 16–22 | 0:22.6–0:31 | **Every game in one library** / "Box art, campaigns, linked accounts."                           | Library: scroll the games, open one, its campaigns and drops, set it to Priority.                                                      | Prioritise or exclude any game, even ones with no drops yet      | slide left |
| 4   | 22–30 | 0:31–0:42.4 | **See everything it did** / "Claims, watching, and how each campaign ended."                     | History: the totals, the timeline by day, click "Drops claimed", pick a game in the side list, search for a reward.                    | A full history, kept on your computer and nowhere else           | circle     |
| 5   | 30–34 | 0:42.4–0:48 | **Ready when Twitch changes** / "Every response is checked."                                     | Twitch API page: Simulate a change, the expected vs actual view, Report on GitHub.                                                     | Spots API changes early and helps you report them                | fade       |
| 6   | 34–37 | 0:48–0:52.2 | **Dark, light, or your system's** / no sub line                                                  | Settings: the theme switches from dark to light and back.                                                                              | none                                                             | fade       |
| 7   | 37–42 | 0:52.2–0:59 | Logo, **Twitch Drop Collector** / "Free and open source · Windows, macOS and Linux"              | End card with the GitHub address. The music fades out over it.                                                                         | none                                                             | end        |

Transitions are 0.35 s (a quarter bar), except the fades into and out of the title cards, which take half a bar.

## Music

[April Showers](https://freemusicarchive.org/music/holiznacc0/spring-at-last-lofi-tape/april-showers/) by HoliznaCC0, from the album _Spring at last (LOFI TAPE)_ on Free Music Archive. It's CC0 1.0 (public domain), so it needs no permission or credit, but the trailer credits it anyway.

- It plays from the start, levelled to −16 LUFS, fading in over 0.8 s and out over the last 5 s.
- The credit (a music note, "April Showers · HoliznaCC0", "CC0 · Free Music Archive") sits bottom right, level with the caption bar. It fades in just before the first scene and out as the music fades.
- An earlier version used a beat synthesised in code. It was replaced on 2026-11-10.

## Build

1. `node media/trailer/demo-data.mjs <your tdc.db> <your settings.json>` makes the demo's user data folder: a copy of the database (no session, cache or image index) with a demo account's lists, watch sessions and events added from the real claims.
2. `yarn workspace @tdc/e2e playwright test --config media.config.ts` records each scene into `media/trailer/out/scenes/` as JPEG frames, with timings, from the invisible window.
3. `node media/trailer/music.mjs` downloads the music into `out/music/` (once).
4. `node media/trailer/overlays.mjs` renders the headers, captions, the music credit and the title cards to transparent PNGs from HTML.
5. `node media/trailer/compose.mjs` puts it together with ffmpeg: `site/media/trailer.mp4`, plus a short GIF and a poster frame.
