import { useEffect, useRef, useState } from 'react';
import './ProgressRing.css';

interface ProgressRingProps {
  /** performance.now() timestamp the countdown began. */
  startedAt: number;
  durationMs: number;
  size?: number;
  strokeWidth?: number;
  /** Renders a warning color once remaining fraction drops below this value. */
  warnBelow?: number;
  paused?: boolean;
}

/**
 * Purely visual radial countdown. Runs its own requestAnimationFrame loop so
 * the rest of the app never re-renders on every animation tick.
 */
export function ProgressRing({
  startedAt,
  durationMs,
  size = 96,
  strokeWidth = 6,
  warnBelow = 0.25,
  paused = false,
}: ProgressRingProps) {
  const [fraction, setFraction] = useState(1);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (paused) return;
    function tick() {
      const elapsed = performance.now() - startedAt;
      const remaining = Math.max(0, 1 - elapsed / durationMs);
      setFraction(remaining);
      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [startedAt, durationMs, paused]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - fraction);
  const isWarning = fraction <= warnBelow;

  return (
    <svg width={size} height={size} className="progress-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle
        className="progress-ring__track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        className={`progress-ring__value${isWarning ? ' progress-ring__value--warn' : ''}`}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
