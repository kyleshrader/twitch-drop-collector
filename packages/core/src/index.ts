// Auth flow, drop collection and domain rules. May import api, storage and config only.
import { API_PACKAGE } from '@tdc/api'
import { CONFIG_PACKAGE } from '@tdc/config'
import { STORAGE_PACKAGE } from '@tdc/storage'

export const CORE_DEPENDENCIES = [API_PACKAGE, CONFIG_PACKAGE, STORAGE_PACKAGE] as const
