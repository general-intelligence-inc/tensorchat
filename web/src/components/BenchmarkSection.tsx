import { motion, useReducedMotion } from 'framer-motion'
import { SectionWrapper } from './ui/SectionWrapper'
import { AnimateIn, StaggerContainer, StaggerItem } from './ui/AnimateIn'

interface BenchmarkEntry {
  model: string
  score: number
  isOnDevice: boolean
  logo?: string
  /** SVGs using fill="currentColor" render black in <img> — need invert filter */
  invertLogo?: boolean
}

interface BenchmarkChart {
  name: string
  subtitle: string
  entries: BenchmarkEntry[]
}

const charts: BenchmarkChart[] = [
  {
    name: 'GPQA Diamond',
    subtitle: 'Graduate-level reasoning',
    entries: [
      { model: 'Qwen3.5-4B', score: 76.2, isOnDevice: true, logo: '/qwen.svg' },
      { model: 'Grok 3', score: 75.4, isOnDevice: false, logo: '/grok.svg', invertLogo: true },
      { model: 'GPT-5 nano', score: 71.5, isOnDevice: false, logo: '/openai.svg', invertLogo: true },
      { model: 'Claude 3.5 Sonnet', score: 59.4, isOnDevice: false, logo: '/claude.svg' },
    ],
  },
  {
    name: 'Video-MME',
    subtitle: 'Video reasoning',
    entries: [
      { model: 'Qwen3.5-4B', score: 83.5, isOnDevice: true, logo: '/qwen.svg' },
      { model: 'Gemini 2.5 Flash-Lite', score: 74.6, isOnDevice: false, logo: '/gemini.svg' },
    ],
  },
  {
    name: 'OmniDocBench v1.5',
    subtitle: 'Document understanding',
    entries: [
      { model: 'Qwen3.5-4B', score: 86.2, isOnDevice: true, logo: '/qwen.svg' },
      { model: 'Gemini 2.5 Flash-Lite', score: 79.4, isOnDevice: false, logo: '/gemini.svg' },
    ],
  },
]

/** Per-chart scale: the highest score fills ~95% of the track */
function getScaleMax(entries: BenchmarkEntry[]) {
  const max = Math.max(...entries.map((e) => e.score))
  return max / 0.95
}

const quint = [0.22, 1, 0.36, 1] as const

function BenchmarkBar({
  entry,
  index,
  scaleMax,
}: {
  entry: BenchmarkEntry
  index: number
  scaleMax: number
}) {
  const reduce = useReducedMotion()
  const widthPercent = (entry.score / scaleMax) * 100

  return (
    <div className="flex items-center gap-3">
      {/* Model info */}
      <div className="w-[140px] sm:w-[170px] shrink-0 flex items-center gap-2">
        {entry.logo ? (
          <img
            src={entry.logo}
            alt=""
            className="w-5 h-5 shrink-0"
            style={entry.invertLogo ? { filter: 'brightness(0) invert(1) opacity(0.85)' } : undefined}
          />
        ) : (
          <div className="w-5 h-5 shrink-0 rounded-full bg-border" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{entry.model}</p>
        </div>
      </div>

      {/* Bar track — fills remaining space */}
      <div className="flex-1 relative h-7 lg:h-8 rounded-md bg-surface/40 overflow-hidden">
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-md ${
            entry.isOnDevice ? 'bg-accent' : 'bg-text-tertiary/40'
          }`}
          initial={reduce ? { width: `${widthPercent}%` } : { width: 0 }}
          whileInView={{ width: `${widthPercent}%` }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{
            duration: 1,
            delay: index * 0.12,
            ease: quint,
          }}
        />
      </div>

      {/* Score — fixed width so bars stay aligned */}
      <motion.span
        className="w-10 shrink-0 text-xs font-semibold text-text-primary tabular-nums text-right"
        initial={reduce ? { opacity: 1 } : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.4, delay: 0.6 + index * 0.12, ease: quint }}
      >
        {entry.score}
      </motion.span>

      {/* Badge — fixed width so all bar tracks are identical */}
      <span
        className={`hidden sm:inline-flex shrink-0 w-[90px] justify-center text-[10px] font-medium py-0.5 rounded-md ${
          entry.isOnDevice
            ? 'bg-accent-tint text-accent'
            : 'bg-surface text-text-tertiary border border-border-subtle'
        }`}
      >
        {entry.isOnDevice ? 'On your phone' : 'Cloud'}
      </span>
    </div>
  )
}

function ChartCard({ chart }: { chart: BenchmarkChart }) {
  const scaleMax = getScaleMax(chart.entries)
  return (
    <div className="rounded-xl p-5 sm:p-6 bg-surface/40 border border-border">
      <div className="mb-5">
        <h3 className="font-display text-base font-semibold text-text-primary">
          {chart.name}
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">{chart.subtitle}</p>
      </div>
      <div className="flex flex-col gap-2.5">
        {chart.entries.map((entry, i) => (
          <BenchmarkBar key={entry.model} entry={entry} index={i} scaleMax={scaleMax} />
        ))}
      </div>
    </div>
  )
}

export function BenchmarkSection() {
  return (
    <SectionWrapper id="benchmarks" className="py-24 lg:py-32">
      <AnimateIn>
        <span className="block text-xs font-medium tracking-[3px] uppercase text-accent/70 mb-4 text-center font-sans">
          Benchmarks
        </span>
        <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold tracking-[-0.02em] text-center mb-4">
          Yesterday's frontier,
          <br className="hidden sm:block" />
          today in your pocket
        </h2>
        <p className="text-text-secondary text-center max-w-md mx-auto mb-14 leading-relaxed">
          Qwen3.5-4B runs entirely on your phone — no cloud needed. Here's how it stacks up.
        </p>
      </AnimateIn>

      {/* Hero chart — GPQA Diamond (full width) */}
      <StaggerContainer className="mb-4">
        <StaggerItem>
          <ChartCard chart={charts[0]} />
        </StaggerItem>
      </StaggerContainer>

      {/* Secondary charts — side by side */}
      <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {charts.slice(1).map((chart) => (
          <StaggerItem key={chart.name}>
            <ChartCard chart={chart} />
          </StaggerItem>
        ))}
      </StaggerContainer>

      {/* Legend + source */}
      <AnimateIn delay={0.3}>
        <div className="flex flex-col sm:flex-row items-center justify-between mt-6 gap-3">
          <div className="flex items-center gap-4 text-xs text-text-tertiary">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-accent" />
              Runs on your phone
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-border" />
              Requires cloud
            </span>
          </div>
          <p className="text-[10px] text-text-tertiary/60">
            Scores from public benchmarks. Sources: Qwen, xAI, OpenAI, Anthropic, Google.
          </p>
        </div>
      </AnimateIn>
    </SectionWrapper>
  )
}
