// A Twitch image, served by main's image cache. Hidden if main can't get it.
import { imageSrc } from '@tdc/ipc-contract'
import type { ReactNode } from 'react'

export function RemoteImage(props: {
  url: string | undefined
  width: number
  height: number
}): ReactNode {
  const { url, width, height } = props
  if (!url) return null
  return (
    <img
      src={imageSrc(url)}
      width={width}
      height={height}
      alt=""
      loading="lazy"
      className="remote-image"
      onError={(event) => {
        event.currentTarget.hidden = true
      }}
    />
  )
}
