// Remote images reach the renderer through main's image cache: its CSP allows no remote hosts.
export const IMAGE_SCHEME = 'tdc-image'
export const IMAGE_ORIGIN = `${IMAGE_SCHEME}://cache`

/** The cached-image URL for a remote image, for an <img src>. Main decides what it serves. */
export const imageSrc = (url: string): string => `${IMAGE_ORIGIN}/?url=${encodeURIComponent(url)}`
