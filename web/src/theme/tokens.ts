// Twin of tokens.css: the same values, here so tests can measure contrast.

export type Scheme = 'light' | 'dark'

export interface Palette {
  accent: string
  accentFill: string
  onAccentFill: string
  ground: string
  surface: string
  field: string
  raised: string
  ink: string
  ink2: string
  markInk: string
  onTone: string
  coral: string
  onCoral: string
  jet: string
  onJet: string
  record: string
  onRecord: string
  recordHover: string
  known: string
  tuneClose: string
  learning: string
  unknown: string
  unknownOnSurface: string
  silver: string
  danger: string
  warning: string
  hairline: string
  switchOff: string
  switchOn: string
  knob: string
  glyphFaint: string
  glyphOff: string
  disabledFill: string
  disabledInk: string
  chosenLabel: string
}

export const PALETTE: Record<Scheme, Palette> = {
  light: {
    accent: '#1F5F9E',
    accentFill: '#1F5F9E',
    onAccentFill: '#FFFFFF',
    ground: '#FFFEFC',
    surface: '#F3F1ED',
    field: '#E8E5E0',
    raised: '#FFFEFC',
    ink: '#1C2026',
    ink2: '#61676F',
    markInk: '#4F5D75',
    onTone: '#FFFFFF',
    coral: '#EF8354',
    onCoral: '#1D2230',
    jet: '#2D3142',
    onJet: '#FFFFFF',
    record: '#FF383C',
    onRecord: '#16181D',
    recordHover: '#FF564D',
    known: '#248A3D',
    tuneClose: '#F6BBA1',
    learning: '#FF8D28',
    unknown: '#8A909A',
    unknownOnSurface: '#737983',
    silver: '#BFC0C0',
    danger: '#B3261E',
    warning: '#8A4B00',
    hairline: 'rgba(30,40,55,0.12)',
    switchOff: '#8A857C',
    switchOn: '#1F5F9E',
    knob: '#FFFFFF',
    glyphFaint: '#8A857C',
    glyphOff: '#8A857C',
    disabledFill: '#DDD9D3',
    disabledInk: '#5F5B54',
    chosenLabel: '#1F5F9E',
  },
  dark: {
    accent: '#6AA6E6',
    accentFill: '#2B609A',
    onAccentFill: '#FFFFFF',
    ground: '#16181B',
    surface: '#1E2024',
    field: '#292C31',
    raised: '#34373D',
    ink: '#ECEDF0',
    ink2: '#9CA2AB',
    markInk: '#FFFFFF',
    onTone: '#16181D',
    coral: '#EF8354',
    onCoral: '#1D2230',
    jet: '#1E212C',
    onJet: '#FFFFFF',
    record: '#FF4245',
    onRecord: '#16181D',
    recordHover: '#FF5F56',
    known: '#30D158',
    tuneClose: '#F6BBA1',
    learning: '#FF9230',
    unknown: '#8A909A',
    unknownOnSurface: '#8A909A',
    silver: '#BFC0C0',
    danger: '#FF8A80',
    warning: '#FFB35C',
    hairline: 'rgba(230,240,255,0.10)',
    switchOff: '#8A847B',
    switchOn: '#4A86C4',
    knob: '#FFFFFF',
    glyphFaint: '#706B63',
    glyphOff: '#8A847B',
    disabledFill: '#3E3C37',
    disabledInk: '#ABA69E',
    chosenLabel: '#ECEDF0',
  },
}

/** A key's pill: its resting fill and ink, then its chosen fill and ink. */
export interface KeyColors {
  bg: string
  ink: string
  onBg: string
  onInk: string
}

/** The twelve pitch classes' key colors, from C. */
export const KEY_COLORS: Record<Scheme, readonly KeyColors[]> = {
  light: [
    { bg: '#FACAC8', ink: '#5F3434', onBg: '#804949', onInk: '#FFFFFF' },
    { bg: '#B3DFF6', ink: '#18485D', onBg: '#24627D', onInk: '#FFFFFF' },
    { bg: '#EBD4AF', ink: '#543E17', onBg: '#715623', onInk: '#FFFFFF' },
    { bg: '#D6D2FB', ink: '#423C61', onBg: '#5A5383', onInk: '#FFFFFF' },
    { bg: '#C5E1BE', ink: '#304A2A', onBg: '#43653C', onInk: '#FFFFFF' },
    { bg: '#F5C9DD', ink: '#5B3447', onBg: '#7B4861', onInk: '#FFFFFF' },
    { bg: '#ADE3E6', ink: '#074C4F', onBg: '#0E676C', onInk: '#FFFFFF' },
    { bg: '#F7CEB7', ink: '#5D3823', onBg: '#7D4D32', onInk: '#FFFFFF' },
    { bg: '#C2D9FD', ink: '#2F4363', onBg: '#415B86', onInk: '#FFFFFF' },
    { bg: '#D9DBB1', ink: '#44451B', onBg: '#5D5E28', onInk: '#FFFFFF' },
    { bg: '#E8CCEF', ink: '#513757', onBg: '#6E4C75', onInk: '#FFFFFF' },
    { bg: '#B4E4D2', ink: '#184D3D', onBg: '#246954', onInk: '#FFFFFF' },
  ],
  dark: [
    { bg: '#5C3232', ink: '#F9C1BF', onBg: '#E48686', onInk: '#2A1313' },
    { bg: '#174559', ink: '#A5DAF4', onBg: '#48B2DF', onInk: '#051E29' },
    { bg: '#503C16', ink: '#E8CDA1', onBg: '#CB9C47', onInk: '#241805' },
    { bg: '#3F3A5D', ink: '#D0CAFA', onBg: '#A498E8', onInk: '#1A172B' },
    { bg: '#2E4828', ink: '#BBDCB3', onBg: '#7CB66F', onInk: '#111F0E' },
    { bg: '#583244', ink: '#F3C0D7', onBg: '#DB85AF', onInk: '#27131D' },
    { bg: '#06494C', ink: '#9EDFE2', onBg: '#23BAC1', onInk: '#002021' },
    { bg: '#593621', ink: '#F5C5AB', onBg: '#DF8E5F', onInk: '#28150A' },
    { bg: '#2D4060', ink: '#B8D2FD', onBg: '#79A5ED', onInk: '#101B2C' },
    { bg: '#424219', ink: '#D3D5A4', onBg: '#A9AB4E', onInk: '#1C1C06' },
    { bg: '#4E3554', ink: '#E5C4EC', onBg: '#C58CD2', onInk: '#221525' },
    { bg: '#174A3B', ink: '#A6E0CA', onBg: '#48BC99', onInk: '#052018' },
  ],
}

/** The six loop colors. Practice draws the dark set in either appearance. */
export const LOOP_COLORS: Record<Scheme, readonly string[]> = {
  light: ['#1F5FD6', '#B34700', '#1E7A34', '#B0247A', '#00727A', '#6B3FC4'],
  dark: ['#3570DC', '#C0560A', '#26853C', '#C8368C', '#0F808A', '#7D56D8'],
}

/** The stats heatmap's four steps, from the lightest active day to the busiest. */
export const HEAT_STEPS: Record<Scheme, readonly string[]> = {
  light: ['#707C93', '#56627A', '#3B465B', '#1F2634'],
  dark: ['#7F8BA2', '#A0ABBF', '#C2C9D7', '#E4E8EF'],
}
