import { motion } from 'framer-motion';
import { useMemo } from 'react';
import './ParticleBurst.css';

interface ParticleBurstProps {
  variant?: 'success' | 'streak';
  count?: number;
  reducedMotion?: boolean;
}

const SUCCESS_COLORS = ['#3fe08a', '#35e6c8', '#8b6bff', '#ffe08a'];
const STREAK_COLORS = ['#ffb648', '#ff8f5c', '#ffe08a', '#ff5c78'];

/**
 * A small, controlled pool of DOM particles (never hundreds) that burst
 * outward once and unmount. Intended to be re-mounted via a `key` change on
 * the parent so it can replay per round without persisting animation state.
 */
export function ParticleBurst({ variant = 'success', count = 12, reducedMotion = false }: ParticleBurstProps) {
  const colors = variant === 'success' ? SUCCESS_COLORS : STREAK_COLORS;

  const particles = useMemo(
    () =>
      Array.from({ length: reducedMotion ? 0 : count }, (_, i) => {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const distance = 46 + Math.random() * 38;
        return {
          id: i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          color: colors[i % colors.length],
          size: 5 + Math.random() * 5,
          delay: Math.random() * 0.06,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (reducedMotion) return null;

  return (
    <div className="particle-burst" aria-hidden="true">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="particle-burst__dot"
          style={{ background: p.color, width: p.size, height: p.size }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 1 }}
          transition={{ duration: 0.62, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
