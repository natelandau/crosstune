// The home page's search title, description, and schema.org description of the site, its
// plans, and its questions.
// Search copy says fiddle, the word players type.
import { APP_URL, NATE_EMAIL, SUPPORT_EMAIL } from './actions'
import { FAQ } from './faq'
import { MAKER_BAND } from './maker'
import { PLAN_FREE, PLAN_PREMIUM, PRICES } from './pricing'

export const HOME_TITLE = 'Crosstune: your tune list, recordings, and practice tools'
export const HOME_DESCRIPTION =
  'Tunes with the recordings you learn from. Slow them down, loop, record your own. Free tune list for fiddle and banjo: old-time, bluegrass, Irish, folk, by ear.'

/** Describes `public/og.png`, which `just site::og` takes from the hero. */
export const OG_IMAGE_ALT =
  'The Crosstune headline, "The app for musicians who learn by ear," above the tune catalog in a web browser and Soldier\'s Joy on an iPhone.'

const SITE = 'https://crosstune.app/'

const amount = (price: string) => price.replace(/^\$/, '')
const premium = (price: string, unitCode: 'MON' | 'ANN') => ({
  '@type': 'Offer',
  name: PLAN_PREMIUM.name,
  price: amount(price),
  priceCurrency: 'USD',
  priceSpecification: {
    '@type': 'UnitPriceSpecification',
    price: amount(price),
    priceCurrency: 'USD',
    referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode },
  },
})

export const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': `${SITE}#website`, name: 'Crosstune', url: SITE },
    {
      '@type': 'Organization',
      '@id': `${SITE}#organization`,
      name: 'Crosstune',
      url: SITE,
      logo: `${SITE}apple-touch-icon-180x180.png`,
      email: SUPPORT_EMAIL,
      founder: { '@id': `${SITE}#nate` },
    },
    {
      '@type': 'Person',
      '@id': `${SITE}#nate`,
      name: 'Nate',
      email: NATE_EMAIL,
      knowsAbout: ['Old-time music', 'Fiddle'],
      memberOf: { '@type': 'MusicGroup', name: MAKER_BAND.name, url: MAKER_BAND.url },
    },
    {
      '@type': 'WebApplication',
      name: 'Crosstune',
      url: APP_URL,
      applicationCategory: 'MusicApplication',
      operatingSystem: 'iOS, iPadOS, macOS, Android, any web browser',
      description: HOME_DESCRIPTION,
      offers: [
        { '@type': 'Offer', name: PLAN_FREE.name, price: '0', priceCurrency: 'USD' },
        premium(PRICES.monthly, 'MON'),
        premium(PRICES.yearly, 'ANN'),
      ],
      publisher: { '@id': `${SITE}#organization` },
      audience: {
        '@type': 'Audience',
        audienceType: 'Old-time, bluegrass, Irish, and folk musicians who learn by ear',
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: { '@type': 'Answer', text: answer },
      })),
    },
  ],
}
