// Checks for the Settings page's fields, apart from the page so they can be tested.

/** A proxy address the settings accept: empty, or http(s) or socks(5) with a host. */
export function validProxy(value: string): boolean {
  if (value === '') return true
  try {
    const url = new URL(value)
    return /^(https?|socks5?):$/.test(url.protocol) && url.hostname !== ''
  } catch {
    return false
  }
}
