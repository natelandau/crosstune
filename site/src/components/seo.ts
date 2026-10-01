// The home page's search title, description, and schema.org description of the site.
// Search copy may say fiddle: it is the word players type, even where the page says violin.
import { APP_URL, SUPPORT_EMAIL } from './actions'

export const HOME_TITLE = 'Crosstune: tune lists and practice for learning music by ear'
export const HOME_DESCRIPTION =
  'Tune lists, recordings, and practice tools for fiddle, banjo, and every musician who learns by ear: old-time, bluegrass, Irish, and folk.'

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
