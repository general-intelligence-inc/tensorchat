import { MeshGradient } from './ui/MeshGradient'
import { SectionWrapper } from './ui/SectionWrapper'
import { AnimateIn, StaggerContainer, StaggerItem } from './ui/AnimateIn'

const privacyPoints = [
  'No cloud servers',
  'No data collection',
  'No user accounts',
  'No telemetry',
]

export function PrivacySection() {
  return (
    <section className="relative py-32 lg:py-40 overflow-hidden">
      {/* Subtle mesh gradient background */}
      <MeshGradient intensity="subtle" />

      {/* Edge fades so gradient blends into surrounding sections */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-base to-transparent pointer-events-none z-[1]" />
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-base to-transparent pointer-events-none z-[1]" />

      <SectionWrapper>
        <AnimateIn>
          <h2 className="font-display text-[clamp(2rem,5vw,3.25rem)] font-bold tracking-[-0.03em] text-center leading-[1.1] max-w-2xl mx-auto mb-14">
            Your conversations never leave your device.
          </h2>
        </AnimateIn>

        <StaggerContainer className="flex flex-wrap justify-center gap-4 mb-12" stagger={0.06}>
          {privacyPoints.map((point) => (
            <StaggerItem key={point}>
              <span className="inline-flex items-center gap-2 px-4 py-2 text-sm text-text-secondary font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                {point}
              </span>
            </StaggerItem>
          ))}
        </StaggerContainer>

        <AnimateIn delay={0.3}>
          <div className="mx-auto w-32 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
        </AnimateIn>
      </SectionWrapper>
    </section>
  )
}
