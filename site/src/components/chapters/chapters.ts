// The home page's chapters, in order. The nav links to each by its id and short name.
export const CHAPTERS = [
  {
    id: 'tunes',
    nav: 'Your tunes',
    title: 'Your tunes, sorted the way you play.',
    sentence:
      "One catalog for the tunes you know, the ones you're learning, and the ones you want to learn.",
  },
  {
    id: 'record',
    nav: 'Record',
    title: 'Record it, or link it.',
    sentence:
      'Every tune on your list keeps its recordings one tap away. Hear how it goes before a jam, dig in when you sit down to learn it, or just collect the versions you love.',
  },
  {
    id: 'practice',
    nav: 'Practice',
    title: 'Everything you need to learn it by ear.',
    sentence: 'Slow it down, shift the pitch, and loop the hard part.',
  },
  {
    id: 'anywhere',
    nav: 'Anywhere',
    title: 'No signal needed.',
    sentence:
      "Your catalog and recordings live on your phone, and sync to your other devices when you're back in range.",
  },
] as const
