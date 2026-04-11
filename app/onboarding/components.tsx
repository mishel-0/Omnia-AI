'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// ─── Seeded deterministic PRNG ───
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

// ─── Pre-computed particle data ───
function generateParticleData(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const s = (seed: number) => seededRandom(i * 7 + seed);
    return {
      width:       s(1) * 3 + 1,
      height:      s(2) * 3 + 1,
      left:        s(3) * 100,
      top:         s(4) * 100,
      opacity:     s(5) * 0.3 + 0.05,
      animY:      -(s(6) * 80 + 20),
      animX:       (s(7) - 0.5) * 40,
      animOpacity: s(8) * 0.4 + 0.1,
      duration:    s(9) * 6 + 4,
      delay:       s(10) * 3,
    };
  });
}

const CACHE: Record<number, ReturnType<typeof generateParticleData>> = {
  40: generateParticleData(40),
  20: generateParticleData(20),
  15: generateParticleData(15),
  12: generateParticleData(12),
};

export function FloatingParticles({
  count = 30,
  color = '#60A5FA',
}: {
  count?: number;
  color?: string;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const particles = CACHE[count] ?? generateParticleData(count);

  if (!mounted) return <div className="absolute inset-0 overflow-hidden pointer-events-none" />;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: p.width,
            height: p.height,
            backgroundColor: color,
            left: `${p.left}%`,
            top: `${p.top}%`,
            opacity: p.opacity,
          }}
          animate={{
            y: [0, p.animY, 0],
            x: [0, p.animX, 0],
            opacity: [0.05, p.animOpacity, 0.05],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

// ─── Pre-computed waveform data ───
function generateWaveData(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    peakHeight: seededRandom(i * 3 + 100) * 32 + 8,
    duration:   1.2 + seededRandom(i * 3 + 200) * 0.6,
  }));
}

const WAVE_CACHE: Record<number, ReturnType<typeof generateWaveData>> = {
  28: generateWaveData(28),
  24: generateWaveData(24),
  20: generateWaveData(20),
};

export function NeuralWaveform({
  barCount = 24,
  className = '',
}: {
  barCount?: number;
  className?: string;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const bars = WAVE_CACHE[barCount] ?? generateWaveData(barCount);

  if (!mounted) return <div className={cn('flex items-end justify-center gap-[3px]', className)} style={{ height: 40 }} />;

  return (
    <div className={cn('flex items-end justify-center gap-[3px]', className)}>
      {bars.map((bar, i) => (
        <motion.div
          key={i}
          animate={{ height: [6, bar.peakHeight, 6] }}
          transition={{ duration: bar.duration, repeat: Infinity, delay: i * 0.04 }}
          className="w-[2px] bg-accent/50 rounded-full"
        />
      ))}
    </div>
  );
}

