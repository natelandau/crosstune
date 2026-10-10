// The feature sections, in the order a player's day goes, and the platforms section after them.

/**
 * Where a section's demo panel sits: `right` and `left` bleed to that edge of the page, and
 * `tall` holds a single phone beside the text.
 */
export type FeatureLayout = 'right' | 'left' | 'tall'

/** The demo a feature section shows; `<DemoPanel>` takes these names. */
export type FeatureDemo = 'tunes' | 'tunePage' | 'record' | 'practice' | 'lists' | 'listen' | 'folk'

export type Feature = {
  id: string
  heading: string
  body: string
  points?: readonly string[]
  demo: FeatureDemo
  layout: FeatureLayout
}

export const FEATURES: readonly Feature[] = [
  {
    id: 'tunes',
    heading: 'Every tune you know, are learning, or want to learn',
    body: 'Keep your whole repertoire in one list and sort it the way you think about it: by key, by tuning, by type, or by what you can play right now. At a jam, filter to D and pick something everyone knows.',
    points: [
      'Status for every tune: known, learning, or want to learn',
      'Filter by key, mode, tuning, type, and more',
      'Fast and easy search',
    ],
    demo: 'tunes',
    layout: 'right',
  },
  {
    id: 'tune-page',
    heading: 'Open a tune and everything is there',
    body: 'Each tune holds the recordings you learned it from, your own takes, scans of your written notes or sheet music, and the lyrics. It also keeps who you learned it from, where and when, and the composer if you know one. All of it is laid out so you can find the one thing you need with an instrument in your hand.',
    points: [
      'Recordings and links from Spotify, YouTube, Apple Music, and more',
      "Scans of anything you want to keep with the tune, from your phone's camera or your photos",
      'Lyrics in a full-screen view that keeps the screen awake',
      'Who you learned it from, where, and when, as searchable fields',
      'Fields built for folk musicians: tuning, feel, time signature, genre, and more',
    ],
    demo: 'tunePage',
    layout: 'left',
  },
  {
    id: 'record',
    heading: 'One-click recording',
    body: "Record a tune at a session, or yourself working through a part. Each recording can be filed under a tune, so the B part you got from the fiddle player last night is right where you will look for it. If you don't know the tune's name yet, leave it unfiled and sort it out later.",
    points: [
      'Recordings sync between your devices and the web',
      'Notes on each recording: who played, or why this version is different',
      'Where you were when you made it',
      "Available even when you're offline",
    ],
    demo: 'record',
    layout: 'tall',
  },
  {
    id: 'practice',
    heading: 'Slow it down. Loop the hard part',
    body: 'Play any recording slower without dropping the pitch. Shift the key to match your tuning. Mark the tricky turn in the B part as a loop, give it a name, and it will be waiting next time you practice.',
    points: [
      'Change the speed without changing the key',
      'Shift the pitch to the key you play it in',
      'Named loops that you keep with the recording',
    ],
    demo: 'practice',
    layout: 'left',
  },
  {
    id: 'lists',
    heading: 'Flexible lists of tunes',
    body: "Build a set list for Saturday's gig, a practice list for this month, or a list of every tune you picked up at Clifftop. A tune can be on as many lists as you like, in whatever order you put it. Press play and listen to a list straight through, like a playlist.",
    demo: 'lists',
    layout: 'right',
  },
  {
    id: 'listen',
    heading: 'Hear any version without leaving the app',
    body: 'Quick access to recordings for every tune you have. Keep the recordings you made next to tracks from Spotify or YouTube.',
    points: [
      'Link recordings from Spotify, Apple Music, YouTube, Bandcamp, TIDAL, or Slippery-Hill and play them in Crosstune',
      'Search the services you use from inside Crosstune',
      'Where supported, download a recording to play offline, slow down, and loop like any other',
    ],
    demo: 'listen',
    layout: 'left',
  },
  {
    id: 'folk',
    heading: 'Built for folk musicians',
    body: "General music apps don't know what cross-tuning is. Crosstune tracks the details folk players care about: AEAE on fiddle, double C on banjo, crooked parts, AABB structure, modal keys, and who you learned a tune from. Your whole catalog lives on your phone, so it works at a festival campground with no signal and syncs when you're back in range.",
    demo: 'folk',
    layout: 'right',
  },
]

export const PLATFORMS_TITLE = 'On your phone, your laptop, and the web'
export const PLATFORMS_BODY =
  "Crosstune runs as an app for iPhone, iPad, and Mac, and in any browser, including Android phones, where you can install it to your home screen. Sign in once and your tunes, recordings, and lists are on every device, even when you're offline."
export const PLATFORMS = [
  { name: 'iPhone', detail: 'From the App Store' },
  { name: 'iPad', detail: 'From the App Store' },
  { name: 'Mac', detail: 'A native app, made for the keyboard' },
  { name: 'Any browser', detail: 'Install it to an Android home screen' },
] as const
