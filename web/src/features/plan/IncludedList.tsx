import { FeatureIcon } from './FeatureIcon'
import { INCLUDED_FEATURES } from './included'
import { INCLUDED } from './planCopy'
import { GROUP_CARD } from '../../ui/form/Group'

/** What Premium includes, under its heading, a row per feature with its icon and one line. */
export function IncludedList() {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="t-heading">{INCLUDED}</h4>
      <ul className={GROUP_CARD}>
        {INCLUDED_FEATURES.map(({ title, detail, icon }) => (
          <li key={title} className="flex items-center gap-3 px-4 py-2.5">
            <FeatureIcon icon={icon} size="large" />
            <div className="min-w-0">
              <p className="t-body">{title}</p>
              <p className="t-secondary text-secondary">{detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
