import { SectionWrapper } from './ui/SectionWrapper'
import { AnimateIn, StaggerContainer, StaggerItem } from './ui/AnimateIn'

const models = [
  {
    name: 'LFM2.5-350M',
    tag: 'Ultra-lightweight',
    features: [],
  },
  {
    name: 'Qwen3.5-0.8B',
    tag: 'Fast & lightweight',
    features: ['Thinking Mode'],
  },
  {
    name: 'LFM2.5-1.2B',
    tag: 'Instruct model',
    features: [],
  },
  {
    name: 'Qwen3.5-2B',
    tag: 'Balanced performance',
    features: ['Vision', 'Thinking Mode'],
  },
  {
    name: 'Qwen3.5-4B',
    tag: 'Most capable',
    features: ['Thinking Mode'],
  },
  {
    name: 'Gemma 4 E2B',
    tag: 'Google multimodal',
    features: ['Vision', 'Thinking Mode'],
  },
]

const addons = [
  { name: 'EuroLLM 1.7B', type: 'Translation' },
  { name: 'TranslateGemma 4B', type: 'Translation' },
  { name: 'Whisper Tiny', type: 'Speech-to-Text' },
  { name: 'Piper / Kokoro', type: 'Text-to-Speech' },
  { name: 'EmbeddingGemma', type: 'File Vault RAG' },
]

export function ModelShowcase() {
  return (
    <SectionWrapper id="models" className="py-24 lg:py-32">
      <AnimateIn>
        <span className="block text-xs font-medium tracking-[3px] uppercase text-accent/70 mb-4 text-center font-sans">
          Models
        </span>
        <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold tracking-[-0.02em] text-center mb-4">
          Powerful models that fit
          <br className="hidden sm:block" />
          in your pocket
        </h2>
        <p className="text-text-secondary text-center max-w-md mx-auto mb-14 leading-relaxed">
          Choose the model that matches your device. Download once, run forever.
        </p>
      </AnimateIn>

      {/* Main model cards */}
      <StaggerContainer className="flex flex-wrap justify-center gap-4 mb-6">
        {models.map((model) => (
          <StaggerItem key={model.name} className="w-full sm:w-[calc(50%-0.5rem)] md:w-[calc(33.333%-0.6875rem)]">
            <div className="rounded-xl p-6 bg-surface/40 border border-border hover:border-border/80 transition-all duration-200 h-full flex flex-col">
              <h3 className="font-display text-lg font-semibold text-text-primary mb-0.5">
                {model.name}
              </h3>
              <p className="text-sm text-text-secondary mb-4">{model.tag}</p>
              <div className="flex flex-wrap gap-1.5 mt-auto">
                {model.features.map((f) => (
                  <span
                    key={f}
                    className="px-2 py-0.5 text-[11px] font-medium bg-accent-tint text-accent rounded-md"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </StaggerItem>
        ))}
      </StaggerContainer>

      {/* Addon model cards — smaller */}
      <StaggerContainer className="flex flex-wrap justify-center gap-3">
        {addons.map((addon) => (
          <StaggerItem key={addon.name} className="w-[calc(50%-0.375rem)] sm:w-[calc(33.333%-0.5rem)] md:w-[calc(20%-0.6rem)]">
            <div className="rounded-lg px-4 py-3 bg-surface/25 border border-border-subtle hover:border-border/60 transition-all duration-200">
              <p className="text-sm font-medium text-text-secondary">{addon.name}</p>
              <p className="text-xs text-text-tertiary mt-0.5">{addon.type}</p>
            </div>
          </StaggerItem>
        ))}
      </StaggerContainer>
    </SectionWrapper>
  )
}
