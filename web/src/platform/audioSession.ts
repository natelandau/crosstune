/** Safari-only WICG proposal, absent from lib.dom.d.ts; unimplemented elsewhere, where this is a no-op. */
interface AudioSessionNavigator extends Navigator {
  audioSession?: { type: string }
}

export type AudioSessionType = 'auto' | 'playback' | 'play-and-record'

/**
 * Tells Safari what kind of audio session this tab needs. Recording and pitch-shifted playback
 * each claim it for as long as they need it, then hand it back to 'auto', so a session left
 * claiming one no longer blocks the other from opening (the microphone after 'playback', or
 * resumed pitch-shifted playback after 'play-and-record').
 */
export function setAudioSessionType(type: AudioSessionType): void {
  const session = (navigator as AudioSessionNavigator).audioSession
  if (session) session.type = type
}
