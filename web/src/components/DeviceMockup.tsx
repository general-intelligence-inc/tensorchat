export function DeviceMockup({ className = '' }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {/* Focused glow behind device */}
      <div
        className="absolute -inset-20 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, rgba(16, 163, 127, 0.18) 0%, transparent 65%)',
          filter: 'blur(50px)',
        }}
      />

      <div className="relative w-[252px] lg:w-[306px]">
        <img
          src="/screen-chat.png"
          alt="TensorChat — AI conversation running on-device"
          className="w-full h-auto block"
          style={{
            filter: 'drop-shadow(0 30px 60px rgba(0,0,0,0.5))',
          }}
        />
      </div>
    </div>
  )
}
