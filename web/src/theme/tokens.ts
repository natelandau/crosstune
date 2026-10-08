// Twin of tokens.css: the same values, here so tests can measure contrast.

export type Scheme = 'light' | 'dark'

export interface Palette {
  ground: string
  ink: string
  ink2: string
  slate: string
  onSlate: string
  coral: string
  jet: string
  record: string
  known: string
  learning: string
  unknown: string
  silver: string
  danger: string
  warning: string
  fill: string
  hairline: string
}

export const PALETTE: Record<Scheme, Palette> = {
  light: {
    ground: '#FFFFFF',
    ink: '#1D2230',
    ink2: '#6B7280',
    slate: '#4F5D75',
    onSlate: '#FFFFFF',
    coral: '#EF8354',
    jet: '#2D3142',
    record: '#FF3B30',
    known: '#248A3D',
    learning: '#C93400',
    unknown: '#8A909A',
    silver: '#BFC0C0',
    danger: '#D92D20',
    warning: '#C93400',
    fill: '#F1F2F5',
    hairline: 'rgba(45,49,66,0.10)',
  },
  dark: {
    ground: '#16181D',
    ink: '#ECEEF2',
    ink2: '#9AA0AB',
    slate: '#8E9BB3',
    onSlate: '#16181D',
    coral: '#EF8354',
    jet: '#1E212C',
    record: '#FF453A',
    known: '#30D158',
    learning: '#FF9F0A',
    unknown: '#8A909A',
    silver: '#BFC0C0',
    danger: '#FF6B5E',
    warning: '#FF9F0A',
    fill: '#25272D',
    hairline: 'rgba(255,255,255,0.10)',
  },
}
