// /llms.txt: the home page's facts as plain Markdown for AI assistants and agents, built from the
// same copy the page shows so the two never disagree.
import { APP_URL, NATE_EMAIL, SUPPORT_EMAIL } from '../components/actions'
import { FAQ } from '../components/faq'
import { FEATURES, PLATFORMS, PLATFORMS_BODY } from '../components/features'
import { HERO_LEDE, HERO_LEDE_LEAD, HERO_TITLE } from '../components/hero'
import { MAKER_BAND } from '../components/maker'
import { BILLING, PLAN_FREE, PLAN_PREMIUM, PRICING_LEDE } from '../components/pricing'
import { PROBLEM_BODY } from '../components/problem'
import { HOME_DESCRIPTION } from '../components/seo'

const SITE = 'https://crosstune.app'
const list = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n')

export function llmsText(): string {
  return (
    [
      '# Crosstune',
      `> ${HERO_TITLE}. ${HERO_LEDE_LEAD} ${HERO_LEDE}`,
      HOME_DESCRIPTION,
      PROBLEM_BODY,
      '## Features',
      ...FEATURES.map((feature) =>
        [`### ${feature.heading}`, feature.body, feature.points ? list(feature.points) : '']
          .filter(Boolean)
          .join('\n\n'),
      ),
      '## Platforms',
      PLATFORMS_BODY,
      list(PLATFORMS.map(({ name, detail }) => `${name}: ${detail}`)),
      '## Pricing',
      PRICING_LEDE,
      `### ${PLAN_FREE.name}: ${PLAN_FREE.price}, ${PLAN_FREE.per}`,
      list(PLAN_FREE.bullets),
      `### ${PLAN_PREMIUM.name}: ${BILLING.yearly.price} ${BILLING.yearly.per}, or ${BILLING.monthly.price} ${BILLING.monthly.per}`,
      list(PLAN_PREMIUM.bullets),
      '## Questions',
      ...FAQ.map(({ question, answer }) => `### ${question}\n\n${answer}`),
      '## Who built it',
      `Nate, a fiddle player in New York's old-time scene and a member of the ${MAKER_BAND.name} (${MAKER_BAND.url}). Feedback: ${NATE_EMAIL}.`,
      '## Links',
      list([
        `[Home](${SITE}/): features, pricing, and the waitlist`,
        `[Sign in](${APP_URL}): the web app`,
        `[Import your tunes](${SITE}/help/import): bring a tune list from Notes, a document, or a file`,
        `[Support](${SITE}/support): help and contact, ${SUPPORT_EMAIL}`,
        `[Privacy policy](${SITE}/privacy)`,
        `[Terms of use](${SITE}/terms)`,
      ]),
    ].join('\n\n') + '\n'
  )
}

export const GET = () =>
  new Response(llmsText(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
