interface RadialGlowProps {
  color?: string
  size?: number
  opacity?: number
  className?: string
}

export function RadialGlow({
  color = '#10A37F',
  size = 600,
  opacity = 0.15,
  className = '',
}: RadialGlowProps) {
  return (
    <div
      className={`absolute pointer-events-none ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        opacity,
        transform: 'translate(-50%, -50%)',
        filter: 'blur(40px)',
      }}
    />
  )
}
