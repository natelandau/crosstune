// The eight feature sections, in the order a player's day goes.

/** One point in a section's list, shown as a short capture of that one action. */
export type Bullet = {
  text: string
  capture: string
  /** Describes the one action the capture shows. */
  alt: string
}

type Section = {
  id: string
  /** The section's short name. */
  nav: string
  heading: string
  body: string[]
  /** One quiet line about the plan, after everything the feature does. */
  plan?: string
}

/** A section with bullets shows each bullet's capture; one without shows its own. */
export type Feature = Section &
  (
    | { bullets: Bullet[]; capture?: undefined; alt?: undefined }
    | {
        bullets?: undefined
        /** A capture name, or `family` for the five-device shot. */
        capture: string
        /** Describes the capture; absent for the family shot, whose devices describe themselves. */
        alt?: string
      }
  )

export const FEATURES_TITLE = 'Built for the way you learn tunes'
export const FEATURES_LINE = 'Hear it, slow it down, play along, and keep it.'

export const FEATURES: readonly Feature[] = [
  {
    id: 'tunes',
    nav: 'Your tunes',
    heading: 'Every tune you know, learning, or want to learn.',
    body: [
      'Keep your whole repertoire in one list and sort it the way you think about it: by key, by tuning, by type, or by what you can play right now. At a jam, filter to D and pick something everyone knows. Your filters stay where you left them.',
    ],
    bullets: [
      {
        text: 'Status for every tune: known, learning, or want to learn',
        capture: 'tunes-status',
        alt: 'In the Crosstune tune list on iPhone, tapping Learning narrows the list to the tunes being learned.',
      },
      {
        text: 'Filter by key, mode, tuning, type, and more',
        capture: 'tunes-filter',
        alt: 'Tapping the A key chip in Crosstune narrows the tune list to tunes in A.',
      },
      {
        text: 'Search by name',
        capture: 'tunes-search',
        alt: 'Typing "west" in Search tunes in Crosstune leaves only Westphalia Waltz in the list.',
      },
    ],
    plan: 'Free, with as many tunes as you play.',
  },
  {
    id: 'tune',
    nav: 'Each tune',
    heading: 'Open a tune and everything is there.',
    body: [
      'Each tune holds the recordings you learned it from, your own takes, scans of your written notes or sheet music, and the lyrics. It also keeps who you learned it from, where and when, and the composer if you know one. All of it is laid out so you can find the one thing you need with an instrument in your hand.',
    ],
    bullets: [
      {
        text: 'Recordings and links from Spotify, YouTube, Apple Music, and more',
        capture: 'tune-links',
        alt: "A tune's recordings and music service links in Crosstune; tapping the Saturday session recording plays it in the player bar.",
      },
      {
        text: "Pages of notation, scanned with your phone's camera",
        capture: 'tune-scans',
        alt: 'Tapping a scanned page of notation in Crosstune opens it in the full-page viewer.',
      },
      {
        text: 'Lyrics in a full-screen view that keeps the screen awake',
        capture: 'tune-lyrics',
        alt: "Tapping Open lyrics in Crosstune shows the tune's lyrics in the full-screen reader.",
      },
      {
        text: 'Who you learned it from, where, and when',
        capture: 'tune-learned',
        alt: 'Scrolling a tune in Crosstune down to its notes shows it was learned from Joe at Clifftop on Aug 6, 2026.',
      },
    ],
  },
  {
    id: 'record',
    nav: 'Record',
    heading: 'Tap record. File it under the tune.',
    body: [
      "Record the whole jam, a tune at a session, or yourself working through a part. Each recording goes under its tune, so the B part you got from the guitar player last night is right where you will look for it. If you don't know the tune's name yet, leave it unfiled and sort it out later.",
    ],
    plan: 'Free accounts keep 5 recordings. Premium records as many as you want.',
    capture: 'record',
    alt: 'The Recordings tab in Crosstune, with takes filed under their tunes and one take not filed yet.',
  },
  {
    id: 'practice',
    nav: 'Practice',
    heading: 'Slow it down. Loop the hard part.',
    body: [
      'Play any recording slower without dropping the pitch. Shift the key to match your tuning. Mark the tricky turn in the B part as a loop, give it a name, and it will be waiting next time you practice. These tools work on your own recordings and on audio you save from music services.',
    ],
    bullets: [
      {
        text: 'Change the speed without changing the key',
        capture: 'practice-speed',
        alt: 'In practice mode in Crosstune, tapping 75% slows the recording without changing its key.',
      },
      {
        text: 'Shift the pitch to the key you play it in',
        capture: 'practice-pitch',
        alt: 'In practice mode in Crosstune, the pitch goes up one semitone, then two.',
      },
      {
        text: 'Named loops that you keep with the recording',
        capture: 'practice-loops',
        alt: 'In practice mode in Crosstune, the arrows step between the saved Turnaround and A part loops.',
      },
    ],
    plan: 'Practice tools are part of Premium.',
  },
  {
    id: 'lists',
    nav: 'Lists',
    heading: 'A list for every reason.',
    body: [
      "Build a set list for Saturday's gig, a practice list for this month, or a list of every tune you picked up at Clifftop. A tune can be on as many lists as you like, in whatever order you put it. Press play and listen to a list straight through, like a playlist.",
    ],
    plan: 'Free accounts get one list. Premium makes as many as you need.',
    capture: 'lists',
    alt: 'The Saturday session list opens in Crosstune and starts playing, and the player moves on to the next tune.',
  },
  {
    id: 'services',
    nav: 'Services',
    heading: 'Hear any version without leaving the tune.',
    body: [
      'Link a tune to recordings on Spotify, Apple Music, YouTube, Bandcamp, TIDAL, the Internet Archive, or Slippery-Hill, and play them inside Crosstune. Save a Slippery-Hill tune as a Crosstune recording, and you can play it offline, slow it down, and loop it like any other recording. More services are on the way.',
    ],
    plan: 'Linking and playing are free. Saving audio is part of Premium.',
    capture: 'services',
    alt: "A tune's links in Crosstune, with Add to recordings offered on its Slippery-Hill recording.",
  },
  {
    id: 'folk',
    nav: 'Folk details',
    heading: 'It knows what a crooked tune is.',
    body: [
      "General music apps don't know what cross-tuning is. Crosstune tracks the details folk players care about: AEAE on fiddle, double C on banjo, crooked parts, AABB structure, modal keys, and who you learned a tune from. Your whole catalog lives on your phone, so it works at a festival campground with no signal and syncs when you're back in range.",
    ],
    capture: 'folk',
    alt: "A tune's details in Crosstune: Cross A (AEAE), double C on banjo, crooked, AABB, and A dorian, with no signal in the status bar.",
  },
  {
    id: 'anywhere',
    nav: 'Anywhere',
    heading: 'On your phone, your laptop, and the web.',
    body: [
      'Crosstune runs as an app for iPhone, iPad, and Mac, and in any browser, including Android phones, where you can install it to your home screen. Sign in once and your tunes, recordings, and lists are on every device.',
      'Your catalog is private to you. Crosstune will never show ads or sell your data. You can download your tunes, lists, and recordings in one file at any time.',
    ],
    capture: 'family',
  },
]

/**
 * The family shot's devices, back to front. A device whose capture is not in the manifest is left
 * out.
 */
export const FAMILY = [
  { name: 'family-mac', alt: 'The Crosstune app for Mac, showing the tune list.' },
  { name: 'family-web', alt: 'Crosstune in a desktop web browser, showing the tune list.' },
  {
    name: 'family-ipad',
    alt: "Crosstune on iPad, with the tune list beside Backstep Cindy's recordings.",
  },
  {
    name: 'family-android',
    alt: 'Crosstune installed from the browser on an Android phone, showing the tune list.',
  },
  { name: 'family-iphone', alt: 'Crosstune on iPhone, showing the tune list.' },
] as const
