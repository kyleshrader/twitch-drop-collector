// Auth flow, drop collection and domain rules. May import kernel, api, storage and config only.
import { GQL_BATCH_SIZE } from '@tdc/api'
import { SETTINGS_VERSION } from '@tdc/config'
import { MIGRATIONS } from '@tdc/storage'

export const SUPPORTED_GQL_BATCH_SIZE = GQL_BATCH_SIZE
export const SUPPORTED_SETTINGS_VERSION = SETTINGS_VERSION
export const SUPPORTED_DATABASE_VERSION = MIGRATIONS.length
