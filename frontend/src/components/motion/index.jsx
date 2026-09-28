import React, { useEffect, useRef, useState } from 'react';
import { motion, useInView, useMotionValue, useReducedMotion, animate } from 'framer-motion';

// Shared easing — a soft "expo out" used across the app.
export const EASE = [0.22, 1, 0.36, 1];

export function FadeIn({ children, delay = 0, y = 14, className, as = 'div', ...rest }) {
  const Comp = motion[as] || motion.div;
  return (
    <Comp
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE, delay }}
      className={className}
      {...rest}
    >
      {children}
    </Comp>
  );
}

const staggerParent = (stagger, delay) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

export const staggerChild = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};

// Children wrapped in <StaggerItem> animate in one after another.
export function Stagger({ children, className, stagger = 0.07, delay = 0.05, ...rest }) {
  return (
    <motion.div
      variants={staggerParent(stagger, delay)}
      initial="hidden"
      animate="show"
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, ...rest }) {
  return (
    <motion.div variants={staggerChild} className={className} {...rest}>
      {children}
    </motion.div>
  );
}

// Word-by-word masked reveal for headlines.
export function RevealText({ text, className, delay = 0 }) {
  const words = String(text ?? '').split(' ');
  return (
    <span className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom pb-[0.08em] -mb-[0.08em]" aria-hidden>
          <motion.span
            className="inline-block"
            initial={{ y: '110%' }}
            animate={{ y: '0%' }}
            transition={{ duration: 0.8, ease: EASE, delay: delay + i * 0.06 }}
          >
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/**
 * Animates numbers inside a display value (e.g. "$12,340.50", "42", "85%").
 * Non-numeric values are rendered as-is.
 */
export function CountUp({ value, duration = 1.1 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const str = String(value ?? '');
  const match = str.match(/-?[\d,]*\.?\d+/);
  const [display, setDisplay] = useState(match && !reduce ? str.replace(match[0], '0') : str);
  const mv = useMotionValue(0);

  useEffect(() => {
    if (!match || reduce) { setDisplay(str); return; }
    if (!inView) return;
    const raw = match[0];
    const target = parseFloat(raw.replace(/,/g, ''));
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    const useGrouping = raw.includes(',') || Math.abs(target) >= 1000;
    const controls = animate(mv, target, {
      duration,
      ease: EASE,
      onUpdate: (v) => {
        const formatted = v.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping,
        });
        setDisplay(str.replace(raw, formatted));
      },
    });
    return () => controls.stop();
  }, [str, inView, reduce]);

  return <span ref={ref} className="tabular">{display}</span>;
}
