import type { ReactNode } from 'react'

interface GlassCardProps {
  children: ReactNode
  className?: string
  hover?: boolean
}

export function GlassCard({ children, className = '', hover = false }: GlassCardProps) {
  return (
    <div
      className={`
        rounded-2xl border border-border/50 bg-surface/50 backdrop-blur-xl
        ${hover ? 'transition-all duration-300 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  )
}
