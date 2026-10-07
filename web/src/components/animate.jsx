import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

export const EASE_OUT = [0.22, 1, 0.36, 1];

export const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
};

export const stagger = (delay = 0.07) => ({
  hidden: {},
  show: { transition: { staggerChildren: delay } },
});

// Angka uang count-up halus; langsung set bila reduced-motion.
export function useCountUp(target, duration = 0.7) {
  const reduce = useReducedMotion();
  const [val, setVal] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (reduce) {
      setVal(target);
      prev.current = target;
      return;
    }
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    const controls = animate(from, target, {
      duration,
      ease: 'easeOut',
      onUpdate: (v) => setVal(v),
    });
    return () => controls.stop();
  }, [target, duration, reduce]);
  return val;
}
