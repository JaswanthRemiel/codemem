'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const reduceMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Runs `onEnter` once, when the element scrolls into view. */
function useInView<T extends Element>(onEnter: () => void, rootMargin = '0px 0px -10% 0px') {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          onEnter();
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/**
 * Fades its children up when they scroll into view. Rendered visible on the server, and
 * only hidden on the client for elements that start below the fold, so the page reads the
 * same without JavaScript.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [state, setState] = useState<'static' | 'hidden' | 'shown'>('static');
  const ref = useInView<HTMLDivElement>(() => setState((s) => (s === 'hidden' ? 'shown' : s)));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduceMotion()) return;
    if (el.getBoundingClientRect().top > window.innerHeight * 0.9) setState('hidden');
  }, [ref]);

  return (
    <div
      ref={ref}
      className={`${state === 'static' ? '' : 'reveal'} ${state === 'shown' ? 'reveal-in' : ''} ${className}`}
      style={state === 'static' ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Splits "86%" into 86 and "%", "0.93" into 0.93 with two decimals, "35 ms" into 35 and " ms". */
function parse(value: string): { number: number; decimals: number; suffix: string } | null {
  const match = /^(\d+(?:\.(\d+))?)(.*)$/.exec(value);
  if (!match) return null;
  return { number: Number(match[1]), decimals: match[2]?.length ?? 0, suffix: match[3] ?? '' };
}

/** Counts a figure up from zero the first time it scrolls into view. */
export function CountUp({ value, duration = 1200 }: { value: string; duration?: number }) {
  const parsed = parse(value);
  const [shown, setShown] = useState(value);
  const ref = useInView<HTMLSpanElement>(() => {
    if (!parsed || reduceMotion()) return setShown(value);
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(`${(parsed.number * eased).toFixed(parsed.decimals)}${parsed.suffix}`);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // Start as soon as any part is on screen: a number showing 0 must not sit there waiting.
  }, '0px');

  // Start from zero before the first paint, so the final value does not flash.
  useLayoutEffect(() => {
    if (parsed && !reduceMotion()) setShown(`${(0).toFixed(parsed.decimals)}${parsed.suffix}`);
  }, []);

  return (
    <span ref={ref} className="tabular-nums">
      {shown}
      {/* The real value for screen readers, which should not hear the count. */}
      <span className="sr-only"> ({value})</span>
    </span>
  );
}
