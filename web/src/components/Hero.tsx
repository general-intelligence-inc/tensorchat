import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import { MeshGradient } from './ui/MeshGradient'
import { DeviceMockup } from './DeviceMockup'
import { StoreBadges } from './StoreBadges'

const expo = [0.16, 1, 0.3, 1] as const
const quint = [0.22, 1, 0.36, 1] as const

export function Hero() {
  const reduce = useReducedMotion()

  return (
    <section className="relative min-h-screen overflow-hidden -mt-16 pt-16" style={{ perspective: '1200px' }}>
      {/* Background */}
      <MeshGradient intensity="medium" />

      {/* Concentric rings — expand on load */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center lg:justify-end lg:pr-[18%]">
        {[480, 640, 820].map((size, i) => (
          <motion.div
            key={size}
            className="absolute rounded-full border border-accent/[0.04]"
            style={{ width: size, height: size }}
            initial={reduce ? false : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 - i * 0.15 }}
            transition={{ duration: 1.2, delay: 0.3 + i * 0.12, ease: quint }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-[1200px] mx-auto px-6 md:px-8 pt-24 lg:pt-0 min-h-screen flex flex-col justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-0 items-center">

          {/* Left: Copy — spans 7 cols */}
          <div className="lg:col-span-7 text-center lg:text-left">

            {/* Headline — clip-path reveal */}
            <Reveal delay={0.05} duration={0.9} reduce={reduce}>
              <h1 className="font-display font-bold tracking-[-0.04em] leading-[0.95]">
                <span className="block text-[clamp(3rem,8vw,6rem)] text-text-primary">
                  Private AI.
                </span>
              </h1>
            </Reveal>

            {/* Subtitle — fade up after headline */}
            <Fade delay={0.35} y={20} reduce={reduce}>
              <p className="font-display text-[clamp(1.5rem,3.5vw,2.75rem)] text-text-secondary mt-2 lg:mt-3 tracking-[-0.02em] font-medium leading-[0.95]">
                Intelligence on your terms.
              </p>
            </Fade>

            {/* Accent divider — width reveal */}
            <motion.div
              className="h-px bg-accent/40 mt-8 mb-8 mx-auto lg:mx-0 origin-left"
              initial={reduce ? false : { scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.55, ease: expo }}
              style={{ width: 64 }}
            />

            {/* Description */}
            <Fade delay={0.6} y={16} reduce={reduce}>
              <p className="text-[clamp(0.95rem,1.5vw,1.1rem)] text-text-secondary max-w-[380px] mx-auto lg:mx-0 leading-[1.7]">
                Run powerful language models entirely on your phone.
                No cloud. No telemetry. No accounts.
              </p>
            </Fade>

            {/* CTA */}
            <Fade delay={0.75} y={16} reduce={reduce} className="mt-10">
              <StoreBadges />
            </Fade>
          </div>

          {/* Right: Phone — 3D perspective entrance */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <motion.div
              initial={reduce ? false : {
                opacity: 0,
                scale: 0.88,
                rotateY: -10,
                y: 50,
              }}
              animate={{
                opacity: 1,
                scale: 1,
                rotateY: 0,
                y: 0,
              }}
              transition={{
                duration: 1.1,
                delay: 0.2,
                ease: quint,
              }}
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="animate-float">
                <DeviceMockup />
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-base to-transparent pointer-events-none z-20" />
    </section>
  )
}

/* ── Clip-path vertical reveal ── */
function Reveal({
  children,
  delay = 0,
  duration = 0.8,
  reduce,
}: {
  children: ReactNode
  delay?: number
  duration?: number
  reduce: boolean | null
}) {
  if (reduce) return <>{children}</>
  return (
    <div className="overflow-hidden">
      <motion.div
        initial={{ y: '110%' }}
        animate={{ y: '0%' }}
        transition={{ duration, delay, ease: expo }}
      >
        {children}
      </motion.div>
    </div>
  )
}

/* ── Simple fade + translate ── */
function Fade({
  children,
  delay = 0,
  y = 24,
  className = '',
  reduce,
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
  reduce: boolean | null
}) {
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease: quint }}
    >
      {children}
    </motion.div>
  )
}
