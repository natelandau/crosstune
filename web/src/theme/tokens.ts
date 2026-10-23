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
  record: string
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
    record: '#FF3B30',
    known: '#248A3D',
    tuneClose: '#F6BBA1',
    learning: '#FF8D28',
    unknown: '#8A909A',
    unknownOnSurface: '#737983',
    silver: '#BFC0C0',
    danger: '#B42318',
    warning: '#B02E00',
    hairline: 'rgba(30,40,55,0.12)',
    switchOff: '#8A857C',
    switchOn: '#1F5F9E',
    knob: '#FFFFFF',
    glyphFaint: '#8A857C',
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
    record: '#FF453A',
    known: '#30D158',
    tuneClose: '#F6BBA1',
    learning: '#FF9230',
    unknown: '#8A909A',
    unknownOnSurface: '#8A909A',
    silver: '#BFC0C0',
    danger: '#FF8A80',
    warning: '#FF9F0A',
    hairline: 'rgba(230,240,255,0.10)',
    switchOff: '#8A847B',
    switchOn: '#4A86C4',
    knob: '#FFFFFF',
    glyphFaint: '#706B63',
    disabledFill: '#3E3C37',
    disabledInk: '#ABA69E',
    chosenLabel: '#ECEDF0',
  },
}
