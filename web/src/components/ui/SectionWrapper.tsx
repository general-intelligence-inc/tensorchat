import type { ReactNode } from 'react'

interface SectionWrapperProps {
  children: ReactNode
  id?: string
  className?: string
  narrow?: boolean
}

export function SectionWrapper({ children, id, className = '', narrow }: SectionWrapperProps) {
  return (
    <section id={id} className={`px-6 md:px-8 ${className}`}>
      <div className={`mx-auto ${narrow ? 'max-w-3xl' : 'max-w-[1200px]'}`}>
        {children}
      </div>
    </section>
  )
}
