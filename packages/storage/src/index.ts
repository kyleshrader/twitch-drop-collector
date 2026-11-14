// Local database: schema, migrations, cache and claim history. Must not import electron or react.
export { createCache, type Cache } from './cache'
export { createClaimHistory, type ClaimHistory, type ClaimRecord } from './claims'
export { createImageIndex, type ImageEntry, type ImageIndex } from './images'
export { openSqlite, type Database, type Row, type SqlValue } from './database'
export { MIGRATIONS, NewerDatabaseError, runMigrations, schemaVersion } from './migrations'
export { createGames, type GameInfo, type Games } from './games'
export {
  createSeenCampaigns,
  type CampaignStanding,
  type SeenCampaign,
  type SeenCampaigns,
  type SeenRecord
} from './seen'
export { createCampaignSnapshots, type CampaignSnapshot, type CampaignSnapshots } from './snapshots'
export { createEventLog, type AppEvent, type EventLog } from './events'
export { createWatchLog, type WatchLog, type WatchSession, type WatchedChannel } from './watch-log'
export { openStorage, type Storage } from './storage'
