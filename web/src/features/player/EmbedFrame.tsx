import type { Embed } from './embed'
import { VIDEO_HEIGHT_PX } from './playerHeight'

/** A provider's own player for one link, sized to the height its embed asks for. */
export function EmbedFrame({ embed, title }: { embed: Embed; title: string }) {
  return (
    // A new src navigates the frame anyway; a fresh element also makes the frame take its
    // sandbox and allow flags before that navigation starts.
    <iframe
      key={embed.src}
      src={embed.src}
      title={title}
      allow={embed.allow}
      sandbox={embed.sandbox}
      height={embed.height === 'video' ? VIDEO_HEIGHT_PX : embed.height}
      className={embed.height === 'video' ? 'mx-auto block w-full max-w-[356px]' : 'block w-full'}
    />
  )
}
