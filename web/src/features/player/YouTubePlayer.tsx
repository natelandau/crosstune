export function YouTubePlayer({ videoId, title }: { videoId: string; title: string }) {
  return (
    <iframe
      className="rounded-box aspect-video w-full"
      src={`https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1`}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      loading="lazy"
    />
  )
}
