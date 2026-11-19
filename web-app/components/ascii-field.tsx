'use client';

import { useEffect, useRef } from 'react';
import { SYSTEM_MONO } from './ascii';

// Characters from low to high: the wave's height picks one.
const RAMP = ' .·:-=+*';
const CELL = 14;
const FPS = 20;

/**
 * A slow ASCII wave floor in perspective, drawn on a canvas behind the hero.
 * Pauses when off screen or in a hidden tab; draws one still frame for reduced motion.
 */
export function AsciiField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let color = '';
    let frame = 0;
    let visible = true;
    let last = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      color = getComputedStyle(canvas).color;
      draw(last);
    };

    const draw = (time: number) => {
      const t = time / 1000;
      ctx.clearRect(0, 0, width, height);
      ctx.font = `${CELL - 3}px ${SYSTEM_MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = color;
      const horizon = height * 0.55;
      const cx = width / 2;
      for (let y = horizon + CELL; y < height; y += CELL) {
        // Inverse perspective: distance into the floor for this screen row.
        const z = (height * 0.9) / (y - horizon);
        const depthFade = Math.min(1, ((y - horizon) / (height - horizon)) * 1.6);
        for (let x = CELL / 2; x < width; x += CELL) {
          const wx = ((x - cx) * z) / 260;
          const h =
            Math.sin(wx * 0.9 + t * 0.6) * Math.cos(z * 0.55 - t * 0.8) * 0.6 +
            Math.sin((wx + z) * 0.35 + t * 0.3) * 0.4;
          const level = Math.floor(((h + 1) / 2) * RAMP.length);
          const ch = RAMP[Math.min(RAMP.length - 1, Math.max(0, level))] as string;
          if (ch === ' ') continue;
          ctx.globalAlpha = depthFade * (0.25 + 0.75 * ((h + 1) / 2));
          ctx.fillText(ch, x, y);
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden || time - last < 1000 / FPS) return;
      last = time;
      draw(time);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(canvas);
    // Theme switches change the color; read it again when the class on <html> changes.
    const theme = new MutationObserver(() => {
      color = getComputedStyle(canvas).color;
      draw(last);
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (!still) frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      io.disconnect();
      theme.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
