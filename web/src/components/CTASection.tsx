import { SectionWrapper } from './ui/SectionWrapper'
import { MeshGradient } from './ui/MeshGradient'
import { AnimateIn } from './ui/AnimateIn'
import { StoreBadges } from './StoreBadges'

export function CTASection() {
  return (
    <section id="download" className="relative py-32 lg:py-40 overflow-hidden">
      <MeshGradient intensity="subtle" />

      {/* Edge fades so gradient blends into surrounding sections */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-base to-transparent pointer-events-none z-[1]" />
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-base to-transparent pointer-events-none z-[1]" />

      <SectionWrapper>
        <div className="relative z-10 text-center">
          <AnimateIn>
            <h2 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] font-bold tracking-[-0.03em] mb-5">
              Own your AI.
            </h2>
          </AnimateIn>
          <AnimateIn delay={0.1}>
            <p className="text-lg text-text-secondary mb-12 max-w-sm mx-auto leading-relaxed">
              Download TensorChat and experience truly private AI.
            </p>
          </AnimateIn>
          <AnimateIn delay={0.2}>
            <StoreBadges className="justify-center" />
          </AnimateIn>
          <AnimateIn delay={0.3}>
            <p className="text-xs text-text-tertiary mt-8 tracking-wide">
              Free. No account required.
            </p>
          </AnimateIn>
        </div>
      </SectionWrapper>
    </section>
  )
}
