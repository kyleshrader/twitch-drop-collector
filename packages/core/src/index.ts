// Auth flow, drop collection and domain rules. May import kernel, api, storage and config only.
import { API_PACKAGE } from '@tdc/api'
import { SETTINGS_VERSION } from '@tdc/config'
import { STORAGE_PACKAGE } from '@tdc/storage'

export const CORE_DEPENDENCIES = [API_PACKAGE, STORAGE_PACKAGE] as const
export const SUPPORTED_SETTINGS_VERSION = SETTINGS_VERSION
