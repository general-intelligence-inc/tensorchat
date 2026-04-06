import { Shield, Mic, Languages, FileText, Eye, Globe, Code2 } from 'lucide-react'
import { SectionWrapper } from './ui/SectionWrapper'
import { AnimateIn } from './ui/AnimateIn'

const featuresWithScreenshots = [
  {
    icon: Mic,
    title: 'Voice Input & Output',
    description:
      'Speak your messages with on-device Whisper transcription. Listen to responses with Piper and Kokoro text-to-speech.',
    screenshot: '/screen-voice.png',
  },
  {
    icon: Languages,
    title: 'Translation',
    description:
      'Translate between languages with dedicated on-device models. Works fully offline.',
    screenshot: '/screen-translate.png',
  },
  {
    icon: FileText,
    title: 'File Vault & RAG',
    description:
      'Import PDFs, text files, and Markdown. Ask questions about your documents with on-device vector search.',
    screenshot: '/screen-vault.png',
  },
]

const featuresWithoutScreenshots = [
  {
    icon: Shield,
    title: 'Complete Privacy',
    description:
      'All inference happens on your device. No data leaves your phone. No accounts, no telemetry.',
  },
  {
    icon: Eye,
    title: 'Image Understanding',
    description:
      'Share photos for multimodal understanding. Describe, analyze, and discuss images on-device.',
  },
  {
    icon: Globe,
    title: 'Web Search',
    description:
      'Enable DuckDuckGo integration when you need it. Completely optional, disabled by default.',
  },
  {
    icon: Code2,
    title: 'Open Source',
    description:
      'TensorChat is Apache-2.0. Inspect the code, audit the privacy claims, and build it yourself.',
    href: 'https://github.com/general-intelligence-inc/tensorchat',
  },
]

export function FeatureGrid() {
  return (
    <SectionWrapper id="features" className="py-24 lg:py-32">
      <AnimateIn>
        <span className="block text-xs font-medium tracking-[3px] uppercase text-accent/70 mb-4 text-center font-sans">
          Features
        </span>
        <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold tracking-[-0.02em] text-center mb-4">
          Everything you need,
          <br className="hidden sm:block" />
          nothing you don't
        </h2>
        <p className="text-text-secondary text-center max-w-md mx-auto mb-20 leading-relaxed">
          A complete AI assistant that respects your privacy.
        </p>
      </AnimateIn>

      {/* Features with device screenshots — alternating layout */}
      <div className="flex flex-col gap-24 lg:gap-32 mb-24">
        {featuresWithScreenshots.map((feature, i) => (
          <AnimateIn key={feature.title} delay={0.05}>
            <div className={`flex flex-col ${i % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} items-center gap-10 lg:gap-16`}>
              {/* Text — same width as screenshot side */}
              <div className="flex-1 flex justify-center lg:justify-end">
                <div className="text-center lg:text-left max-w-md">
                  <div className="w-10 h-10 rounded-lg bg-accent-tint flex items-center justify-center mb-5 mx-auto lg:mx-0">
                    <feature.icon className="w-5 h-5 text-accent" strokeWidth={1.5} />
                  </div>
                  <h3 className="font-display text-2xl font-semibold text-text-primary mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-base text-text-secondary leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
              {/* Full device screenshot — equal width */}
              <div className="flex-1 flex justify-center">
                <div className="w-[200px] lg:w-[240px]">
                  <img
                    src={feature.screenshot}
                    alt={`${feature.title} screen`}
                    className="w-full h-auto block drop-shadow-2xl"
                  />
                </div>
              </div>
            </div>
          </AnimateIn>
        ))}
      </div>

      {/* Features without screenshots — compact grid */}
      <AnimateIn>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border/30 rounded-xl overflow-hidden">
          {featuresWithoutScreenshots.map((feature) => {
            const content = (
              <>
                <feature.icon
                  className="w-5 h-5 text-accent mb-5 transition-transform duration-300 group-hover:scale-110"
                  strokeWidth={1.5}
                />
                <h3 className="font-display text-base font-semibold text-text-primary mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {feature.description}
                </p>
              </>
            )
            if ('href' in feature && feature.href) {
              return (
                <a
                  key={feature.title}
                  href={feature.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-base p-7 lg:p-8 group h-full block hover:bg-surface-hover/30 transition-colors"
                >
                  {content}
                </a>
              )
            }
            return (
              <div key={feature.title} className="bg-base p-7 lg:p-8 group h-full">
                {content}
              </div>
            )
          })}
        </div>
      </AnimateIn>
    </SectionWrapper>
  )
}
