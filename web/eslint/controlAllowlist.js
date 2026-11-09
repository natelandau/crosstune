// Files that may build their own control instead of using the one in src/ui. Each entry is a
// path (or glob) from web/ and the reason the library cannot draw it. The lint gate stays on in
// these files: each allowed element carries its own
// `eslint-disable-next-line no-restricted-... -- <reason>` comment with the entry's reason, and
// src/lint/controlGate.test.ts holds every such comment to this list. A new entry needs the
// owner's approval.
export const controlAllowlist = [
  {
    file: 'src/fixture/clerkStub.tsx',
    reason: 'Test fixture standing in for the sign-in provider UI',
  },
  { file: 'src/app/RecordControl.tsx', reason: 'Record control, in the record color' },
  { file: 'src/features/capture/RecordSheet.tsx', reason: 'Record control, in the record color' },
  { file: 'src/app/Sidebar.tsx', reason: 'Navigation rows' },
  { file: 'src/features/player/Scrubber.tsx', reason: 'Media timeline' },
  {
    file: 'src/features/practice/PracticeWaveform.tsx',
    reason: 'Loop name tab drawn on the waveform at the loop position, part of the media timeline',
  },
  {
    file: 'src/features/player/PhoneBar.tsx',
    reason: 'Two-line pressable body that opens the playing recording, a row and not a button',
  },
  { file: 'src/features/plan/PeriodTiles.tsx', reason: 'Priced plan tiles' },
  { file: 'src/features/stats/blocks/*.tsx', reason: 'Chart blocks' },
  { file: 'src/app/welcome/WelcomeCarousel.tsx', reason: 'Carousel slide dots' },
  { file: 'src/features/tune/TuneHeader.tsx', reason: 'Key tile drawn in the key colors' },
  {
    file: 'src/features/selection/SelectionBar.tsx',
    reason: 'Phone bar cell with an icon over a caption, like a tab',
  },
  {
    file: 'src/features/tune/TuneFormSheet.tsx',
    reason: 'Hidden submit button so Enter submits the form; never seen or focused',
  },
  {
    file: 'src/features/tune/RecordingsLine.tsx',
    reason: 'Disclosure heading that shows or hides the list',
  },
]
