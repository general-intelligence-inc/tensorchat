import { Download, Layers, MessageCircle } from 'lucide-react'
import { SectionWrapper } from './ui/SectionWrapper'
import { AnimateIn, StaggerContainer, StaggerItem } from './ui/AnimateIn'

const steps = [
  {
    icon: Download,
    number: '01',
    title: 'Download the app',
    description: 'Get TensorChat free from the App Store or Google Play.',
  },
  {
    icon: Layers,
    number: '02',
    title: 'Pick your model',
    description: 'Choose from 0.8B to 4B parameter models. Download runs once.',
  },
  {
    icon: MessageCircle,
    number: '03',
    title: 'Chat privately',
    description: 'Everything runs on your device. No internet needed.',
  },
]

export function GettingStarted() {
  return (
    <SectionWrapper className="py-24 lg:py-32">
      <AnimateIn>
        <span className="block text-xs font-medium tracking-[3px] uppercase text-accent/70 mb-4 text-center font-sans">
          Get Started
        </span>
        <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold tracking-[-0.02em] text-center mb-16">
          Up and running in three steps
        </h2>
      </AnimateIn>

      <StaggerContainer className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border/40 rounded-xl overflow-hidden" stagger={0.12}>
        {steps.map((step) => (
          <StaggerItem key={step.number}>
            <div className="bg-base p-8 lg:p-10 group">
              {/* Step number + icon */}
              <div className="flex items-center gap-4 mb-6">
                <span className="font-display text-3xl font-bold text-border tracking-tight">
                  {step.number}
                </span>
                <div className="w-10 h-10 rounded-lg bg-accent-tint flex items-center justify-center">
                  <step.icon className="w-5 h-5 text-accent" strokeWidth={1.5} />
                </div>
              </div>
              <h3 className="font-display text-lg font-semibold text-text-primary mb-2">
                {step.title}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {step.description}
              </p>
            </div>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </SectionWrapper>
  )
}
