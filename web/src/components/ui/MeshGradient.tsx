interface MeshGradientProps {
  className?: string
  intensity?: 'subtle' | 'medium' | 'vivid'
}

export function MeshGradient({ className = '', intensity = 'medium' }: MeshGradientProps) {
  const opacityMap = { subtle: 0.25, medium: 0.4, vivid: 0.55 }
  const opacity = opacityMap[intensity]

  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      style={{ opacity }}
    >
      {/* Primary teal blob — large, slow */}
      <div
        className="absolute rounded-full"
        style={{
          width: '60%',
          height: '60%',
          top: '-5%',
          left: '50%',
          background: 'radial-gradient(circle, rgba(16, 163, 127, 0.35) 0%, transparent 70%)',
          filter: 'blur(80px)',
          animation: 'mesh-drift-1 25s ease-in-out infinite',
        }}
      />

      {/* Deep teal-blue blob */}
      <div
        className="absolute rounded-full"
        style={{
          width: '50%',
          height: '50%',
          top: '30%',
          left: '10%',
          background: 'radial-gradient(circle, rgba(8, 80, 72, 0.5) 0%, transparent 70%)',
          filter: 'blur(90px)',
          animation: 'mesh-drift-2 30s ease-in-out infinite',
        }}
      />

      {/* Warm accent — subtle emerald */}
      <div
        className="absolute rounded-full"
        style={{
          width: '45%',
          height: '45%',
          top: '-15%',
          right: '5%',
          background: 'radial-gradient(circle, rgba(16, 120, 90, 0.3) 0%, transparent 65%)',
          filter: 'blur(100px)',
          animation: 'mesh-drift-3 35s ease-in-out infinite',
        }}
      />

      {/* Dark anchor — prevents washed-out look */}
      <div
        className="absolute rounded-full"
        style={{
          width: '40%',
          height: '40%',
          bottom: '5%',
          left: '30%',
          background: 'radial-gradient(circle, rgba(6, 40, 35, 0.6) 0%, transparent 70%)',
          filter: 'blur(70px)',
          animation: 'mesh-drift-4 20s ease-in-out infinite',
        }}
      />

      {/* Subtle pulse overlay for depth */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 70% 40%, rgba(16, 163, 127, 0.06) 0%, transparent 60%)',
          animation: 'subtle-pulse 8s ease-in-out infinite',
        }}
      />
    </div>
  )
}
