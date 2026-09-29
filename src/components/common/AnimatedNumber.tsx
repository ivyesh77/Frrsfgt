import { animate, useMotionValue } from 'framer-motion';
import { useEffect, useState } from 'react';

/** Isolated count-up number so parent HUD components don't re-render every tick. */
export function AnimatedNumber({ value, duration = 0.5 }: { value: number; duration?: number }) {
  const motionValue = useMotionValue(value);
  const [display, setDisplay] = useState(Math.round(value));

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{display.toLocaleString()}</>;
}
