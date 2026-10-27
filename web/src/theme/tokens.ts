// Twin of tokens.css: the same values, here so tests can measure contrast.

export type Scheme = 'light' | 'dark'

export interface Palette {
  pageBackground: string
  surface: string
  field: string
  surfaceRaised: string
  border: string
  handle: string
  textPrimary: string
  textSecondary: string
  textTertiary: string
  glyphFaint: string
  disabledFill: string
  disabledInk: string
  accent: string
  accentFill: string
  onAccentFill: string
  accentTrack: string
  onTint: string
  brand: string
  onBrand: string
  brandSecondary: string
  jet: string
  onJet: string
  danger: string
  warning: string
  warningFill: string
  onWarningFill: string
  onStatus: string
  statusKnown: string
  statusLearning: string
  statusUnknown: string
  statusUnknownOnFill: string
  record: string
  onRecord: string
  recordHover: string
  practiceBackground: string
  onPractice: string
  onPracticeSecondary: string
  tunerClose: string
  tunerInTune: string
}

export const PALETTE: Record<Scheme, Palette> = {
  light: {
    pageBackground: '#FFFEFC',
    surface: '#F3F1ED',
    field: '#E8E5E0',
    surfaceRaised: '#FFFEFC',
    border: 'rgba(30,40,55,0.12)',
    handle: '#BFC0C0',
    textPrimary: '#1C2026',
    textSecondary: '#61676F',
    textTertiary: '#8A857C',
    glyphFaint: '#8A857C',
    disabledFill: '#DDD9D3',
    disabledInk: '#5F5B54',
    accent: '#1F5F9E',
    accentFill: '#1F5F9E',
    onAccentFill: '#FFFFFF',
    accentTrack: '#1F5F9E',
    onTint: '#1F5F9E',
    brand: '#EF8354',
    onBrand: '#1D2230',
    brandSecondary: '#4F5D75',
    jet: '#2D3142',
    onJet: '#FFFFFF',
    danger: '#B3261E',
    warning: '#8A4B00',
    warningFill: '#8A4B00',
    onWarningFill: '#FFFFFF',
    onStatus: '#FFFFFF',
    statusKnown: '#248A3D',
    statusLearning: '#FF8D28',
    statusUnknown: '#8A909A',
    statusUnknownOnFill: '#737983',
    record: '#FF383C',
    onRecord: '#16181D',
    recordHover: '#FF564D',
    practiceBackground: '#1E212C',
    onPractice: '#FFFFFF',
    onPracticeSecondary: '#BFC0C0',
    tunerClose: '#F6BBA1',
    tunerInTune: '#30D158',
  },
  dark: {
    pageBackground: '#16181B',
    surface: '#1E2024',
    field: '#292C31',
    surfaceRaised: '#34373D',
    border: 'rgba(230,240,255,0.10)',
    handle: '#BFC0C0',
    textPrimary: '#ECEDF0',
    textSecondary: '#9CA2AB',
    textTertiary: '#8A847B',
    glyphFaint: '#706B63',
    disabledFill: '#3E3C37',
    disabledInk: '#ABA69E',
    accent: '#6AA6E6',
    accentFill: '#2B609A',
    onAccentFill: '#FFFFFF',
    accentTrack: '#4A86C4',
    onTint: '#ECEDF0',
    brand: '#EF8354',
    onBrand: '#1D2230',
    brandSecondary: '#FFFFFF',
    jet: '#1E212C',
    onJet: '#FFFFFF',
    danger: '#FF8A80',
    warning: '#FFB35C',
    warningFill: '#FFB35C',
    onWarningFill: '#16181D',
    onStatus: '#16181D',
    statusKnown: '#30D158',
    statusLearning: '#FF9230',
    statusUnknown: '#8A909A',
    statusUnknownOnFill: '#8A909A',
    record: '#FF4245',
    onRecord: '#16181D',
    recordHover: '#FF5F56',
    practiceBackground: '#1E212C',
    onPractice: '#FFFFFF',
    onPracticeSecondary: '#BFC0C0',
    tunerClose: '#F6BBA1',
    tunerInTune: '#30D158',
  },
}

/** A key's pill: its resting background and text, then its selected background and text. */
export interface KeyColors {
  background: string
  text: string
  selectedBackground: string
  selectedText: string
}

/** The twelve pitch classes' key colors, from C. */
export const KEY_COLORS: Record<Scheme, readonly KeyColors[]> = {
  light: [
    {
      background: '#FACAC8',
      text: '#5F3434',
      selectedBackground: '#804949',
      selectedText: '#FFFFFF',
    },
    {
      background: '#B3DFF6',
      text: '#18485D',
      selectedBackground: '#24627D',
      selectedText: '#FFFFFF',
    },
    {
      background: '#EBD4AF',
      text: '#543E17',
      selectedBackground: '#715623',
      selectedText: '#FFFFFF',
    },
    {
      background: '#D6D2FB',
      text: '#423C61',
      selectedBackground: '#5A5383',
      selectedText: '#FFFFFF',
    },
    {
      background: '#C5E1BE',
      text: '#304A2A',
      selectedBackground: '#43653C',
      selectedText: '#FFFFFF',
    },
    {
      background: '#F5C9DD',
      text: '#5B3447',
      selectedBackground: '#7B4861',
      selectedText: '#FFFFFF',
    },
    {
      background: '#ADE3E6',
      text: '#074C4F',
      selectedBackground: '#0E676C',
      selectedText: '#FFFFFF',
    },
    {
      background: '#F7CEB7',
      text: '#5D3823',
      selectedBackground: '#7D4D32',
      selectedText: '#FFFFFF',
    },
    {
      background: '#C2D9FD',
      text: '#2F4363',
      selectedBackground: '#415B86',
      selectedText: '#FFFFFF',
    },
    {
      background: '#D9DBB1',
      text: '#44451B',
      selectedBackground: '#5D5E28',
      selectedText: '#FFFFFF',
    },
    {
      background: '#E8CCEF',
      text: '#513757',
      selectedBackground: '#6E4C75',
      selectedText: '#FFFFFF',
    },
    {
      background: '#B4E4D2',
      text: '#184D3D',
      selectedBackground: '#246954',
      selectedText: '#FFFFFF',
    },
  ],
  dark: [
    {
      background: '#5C3232',
      text: '#F9C1BF',
      selectedBackground: '#E48686',
      selectedText: '#2A1313',
    },
    {
      background: '#174559',
      text: '#A5DAF4',
      selectedBackground: '#48B2DF',
      selectedText: '#051E29',
    },
    {
      background: '#503C16',
      text: '#E8CDA1',
      selectedBackground: '#CB9C47',
      selectedText: '#241805',
    },
    {
      background: '#3F3A5D',
      text: '#D0CAFA',
      selectedBackground: '#A498E8',
      selectedText: '#1A172B',
    },
    {
      background: '#2E4828',
      text: '#BBDCB3',
      selectedBackground: '#7CB66F',
      selectedText: '#111F0E',
    },
    {
      background: '#583244',
      text: '#F3C0D7',
      selectedBackground: '#DB85AF',
      selectedText: '#27131D',
    },
    {
      background: '#06494C',
      text: '#9EDFE2',
      selectedBackground: '#23BAC1',
      selectedText: '#002021',
    },
    {
      background: '#593621',
      text: '#F5C5AB',
      selectedBackground: '#DF8E5F',
      selectedText: '#28150A',
    },
    {
      background: '#2D4060',
      text: '#B8D2FD',
      selectedBackground: '#79A5ED',
      selectedText: '#101B2C',
    },
    {
      background: '#424219',
      text: '#D3D5A4',
      selectedBackground: '#A9AB4E',
      selectedText: '#1C1C06',
    },
    {
      background: '#4E3554',
      text: '#E5C4EC',
      selectedBackground: '#C58CD2',
      selectedText: '#221525',
    },
    {
      background: '#174A3B',
      text: '#A6E0CA',
      selectedBackground: '#48BC99',
      selectedText: '#052018',
    },
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
