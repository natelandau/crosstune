import { TRIAL_ENDS_TODAY } from './planCopy'

export const FIRST_RECORDING_TITLE = 'Recordings are part of your trial'
export const TRIAL_ENDED_TITLE = 'Your trial has ended'
export const NOTICE_OK = 'OK'
export const LOSE_PLAYBACK = "Recordings don't play in the app"
export const LOSE_RECORDING = 'No new recordings or practice mode'
export const LOSE_SCANS = 'Scans open on one tune only'
export const NOTICE_KEEPS =
  'Every recording and scan stays, and export always includes them. Subscribe and they play again at once.'

/** What is left of the trial, from whole local calendar days: 0 or fewer is its last day. */
export function daysLeft(days: number): string {
  if (days <= 0) return TRIAL_ENDS_TODAY
  return days === 1 ? '1 day left of Premium' : `${days} days left of Premium`
}

export function subscribeAnnual(price: string): string {
  return `Subscribe for ${price} a year`
}

export function firstRecordingBody(endsAt: string): string {
  return `Your Premium trial ends ${endsAt}. After that, every recording stays and exports, but it won't play in the app until you subscribe.`
}

export function trialReminderTitle(endsAt: string): string {
  return `Your trial ends ${endsAt}`
}
