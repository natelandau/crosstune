// The home page's search title, description, and schema.org description of the site.
// Search copy says fiddle, the word players type.
import { APP_URL, SUPPORT_EMAIL } from './actions'

export const HOME_TITLE = 'Crosstune: your tune list, recordings, and practice tools'
export const HOME_DESCRIPTION =
  'Tunes with the recordings you learn from. Slow them down, loop, record your own. Free tune list for fiddle and banjo: old-time, bluegrass, Irish, folk, by ear.'

const SITE = 'https://crosstune.app/'

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
    },
    {
      '@type': 'WebApplication',
      name: 'Crosstune',
      url: APP_URL,
      applicationCategory: 'MusicApplication',
      operatingSystem: 'Any web browser',
      description: HOME_DESCRIPTION,
      publisher: { '@id': `${SITE}#organization` },
      audience: {
        '@type': 'Audience',
        audienceType: 'Old-time, bluegrass, Irish, and folk musicians who learn by ear',
      },
    },
  ],
}
