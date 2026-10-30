# Live Twitch fixtures

Real GQL responses captured on 2026-10-30 by the dev-only probe (`apps/desktop/src/main/dev/gql-probe.ts`) on an **Android app** session, then anonymised: the user ID is replaced with `10000001` (including inside `dropInstanceID`s), the login with `test_user`, request IDs with `REQUEST`. Long lists are trimmed: 3 in-progress campaigns, the claimed rewards they reference plus 3 others, 7 campaign-list entries, allow-lists of 3 channels, and 3 directory streams. The playback token response isn't included; it's a signed credential and contains an IP address.

Each file is the raw HTTP body: a JSON array with one item per batched operation.

| File                    | Operation                                           |
| ----------------------- | --------------------------------------------------- |
| `inventory.json`        | `Inventory`                                         |
| `campaigns.json`        | `ViewerDropsDashboard`                              |
| `campaign-details.json` | `DropCampaignDetails` × 3 (keyed by user ID)        |
| `game-directory.json`   | `DirectoryPage_Game` (Rust, drops enabled)          |
| `stream-info.json`      | `VideoPlayerStreamInfoOverlayChannel` × 2           |
| `available-drops.json`  | `DropsHighlightService_AvailableDrops` × 2          |
| `current-drop.json`     | `DropCurrentSessionContext` (not watching anything) |

To refresh them, run the probe with `TDC_DEV_GQL_PROBE=1` on a signed-in dev build, then anonymise the same way before committing.
