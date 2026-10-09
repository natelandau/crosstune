import { SERVICES, type Service } from './events'

/** The plan's service for a link's stored provider; one this client does not know is `other`. */
export function serviceOf(provider: string): Service {
  return SERVICES.find((service) => service === provider) ?? 'other'
}
