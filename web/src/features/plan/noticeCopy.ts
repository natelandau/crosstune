export const FIRST_RECORDING_TITLE = 'Recordings are part of your trial'
export const TRIAL_REMINDER_BODY =
  'Premium keeps recordings playing, practice mode, and scans on every tune.'
export const TRIAL_REMINDER_RECORDINGS =
  'Your recordings stay and export after that, but stop playing in the app until you subscribe.'
export const TRIAL_ENDED_TITLE = 'Your trial has ended'
export const TRIAL_ENDED_BODY =
  'Every recording you made is kept. Export includes them, and they play again the moment you subscribe. Scans stay open on one tune.'
export const NOTICE_OK = 'OK'

export function firstRecordingBody(endsAt: string): string {
  return `Your Premium trial ends ${endsAt}. After that, every recording stays and exports, but it won't play in the app until you subscribe.`
}

export function trialReminderTitle(endsAt: string): string {
  return `Your trial ends ${endsAt}`
}
