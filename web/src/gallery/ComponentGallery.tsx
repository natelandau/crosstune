import { useStampedDensity } from '../platform/density'
import { CONTROLS } from '../ui'
import { Capsule } from '../ui/Capsule'
import {
  ActionsSection,
  ChoicesSection,
  FormsSection,
  FoundationsSection,
  MotionSection,
  NavigationSection,
  SheetSection,
  ValuesSection,
} from './gallerySections'

export const GALLERY_TITLE = 'Component library'

const DENSITIES = [
  ['touch', 'Touch'],
  ['pointer', 'Pointer'],
] as const

const TYPE_ROLES = [
  ['t-page-title', 'Page title'],
  ['t-screen-title', 'Screen title'],
  ['t-heading', 'Heading'],
  ['t-body', 'Body'],
  ['t-secondary', 'Secondary'],
  ['t-caption', 'Caption'],
] as const

const BY_NAME = Object.fromEntries(CONTROLS.map((control) => [control.name, control]))

export function ComponentGallery() {
  const density = useStampedDensity()
  return (
    <div className="px-4 pb-16">
      <h1 className="t-page-title pt-6 pb-4">{GALLERY_TITLE}</h1>
      <main className="flex flex-col gap-8">
        <section aria-labelledby="gallery-density" className="flex flex-col gap-3">
          <h2 id="gallery-density" className="t-heading">
            Density
          </h2>
          <p className="t-secondary text-secondary">
            Every control is drawn at one of two sizes, chosen by input: Pointer for a mouse or
            trackpad, Touch for a finger. This switch sets the whole page.
          </p>
          <div role="group" aria-label="Density" className="flex items-center gap-2">
            {DENSITIES.map(([value, name]) => (
              <Capsule
                key={value}
                label={name}
                set={density === value}
                onPress={() => {
                  document.documentElement.dataset.density = value
                }}
              />
            ))}
          </div>
          {TYPE_ROLES.map(([className, name]) => (
            <p key={className} className={className}>
              {name}
            </p>
          ))}
        </section>
        <FoundationsSection />
        <MotionSection />
        <ActionsSection components={BY_NAME} />
        <NavigationSection components={BY_NAME} />
        <ChoicesSection components={BY_NAME} />
        <ValuesSection components={BY_NAME} />
        <FormsSection components={BY_NAME} />
        <SheetSection />
      </main>
    </div>
  )
}
