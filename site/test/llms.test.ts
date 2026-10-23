import { describe, expect, it } from 'vitest'
import { FAQ } from '../src/components/faq'
import { FEATURES } from '../src/components/features'
import { BILLING, PLAN_FREE, PLAN_PREMIUM } from '../src/components/pricing'
import { readDist } from './dist'

const text = readDist('/llms.txt')

describe('/llms.txt', () => {
  it('opens with the product name and a one-line summary', () => {
    expect(text).toMatch(/^# Crosstune\n\n> .+\n/)
  })

  it('carries every feature heading, plan price, plan bullet, and question the page shows', () => {
    for (const feature of FEATURES) expect(text).toContain(`### ${feature.heading}`)
    for (const { price } of Object.values(BILLING)) expect(text).toContain(price)
    for (const bullet of [...PLAN_FREE.bullets, ...PLAN_PREMIUM.bullets]) {
      expect(text).toContain(`- ${bullet}`)
    }
    for (const { question, answer } of FAQ) expect(text).toContain(`### ${question}\n\n${answer}`)
  })

  it('links home for features, pricing, and sign-up', () => {
    expect(text).toContain('[Home](https://crosstune.app/): features, pricing, and sign-up')
  })

  it('lists the tuner feature and its help page', () => {
    const tuner = FEATURES.find((feature) => feature.id === 'tuner')
    expect(tuner).toBeDefined()
    expect(text).toContain(`### ${tuner?.heading}`)
    expect(text).toContain('https://crosstune.app/help/tuner')
  })

  it('never says notation or song', () => {
    expect(text).not.toMatch(/\bnotation\b|\bsong\b/i)
  })
})
