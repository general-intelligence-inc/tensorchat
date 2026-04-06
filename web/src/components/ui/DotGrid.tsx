interface DotGridProps {
  className?: string
  opacity?: number
  spacing?: number
  dotSize?: number
}

export function DotGrid({
  className = '',
  opacity = 0.4,
  spacing = 24,
  dotSize = 1.5,
}: DotGridProps) {
  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`} style={{ opacity }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="dot-grid" x="0" y="0" width={spacing} height={spacing} patternUnits="userSpaceOnUse">
            <circle cx={spacing / 2} cy={spacing / 2} r={dotSize} fill="#2A2A2A" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />
      </svg>
    </div>
  )
}
