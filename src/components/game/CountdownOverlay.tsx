import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import './CountdownOverlay.css';

interface CountdownOverlayProps {
  onComplete: () => void;
}

const STEPS = ['GET READY', '3', '2', '1', 'MEMORIZE!'];
const STEP_MS = 480;

export function CountdownOverlay({ onComplete }: CountdownOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (stepIndex >= STEPS.length - 1) {
      const finalTimer = window.setTimeout(onComplete, STEP_MS);
      return () => window.clearTimeout(finalTimer);
    }
    const timer = window.setTimeout(() => setStepIndex((i) => i + 1), STEP_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  return (
    <div className="countdown-overlay">
      <AnimatePresence mode="wait">
        <motion.span
          key={stepIndex}
          className="countdown-overlay__text"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.3 }}
          transition={{ duration: 0.28, ease: [0.2, 0.9, 0.32, 1] }}
        >
          {STEPS[stepIndex]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
