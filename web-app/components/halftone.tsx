'use client';

import { useEffect, useRef } from 'react';
import { BIRD, OWL, type Frame } from './pixel-art';

/**
 * Brightness of a temple of Mnemosyne at (u, v) inside its box, both from 0 to 1, or -1 outside
 * it. Columns are shaded as if lit from the left.
 */
function temple(u: number, v: number): number {
  if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
  if (v < 0.2) {
    // Pediment: a triangle, with a slightly darker tympanum inside.
    const half = (v / 0.2) * 0.5;
    const off = Math.abs(u - 0.5);
    if (off > half) return -1;
    // Lit from the left: brighter on the left slope.
    return (off < half - 0.05 && v > 0.05 ? 0.66 : 0.95) - (u - 0.5) * 0.25;
  }
  if (v < 0.3) return v > 0.245 && v < 0.26 ? 0.6 : 0.92; // entablature with a frieze line
  if (v < 0.84) {
    const columns = 6;
    const span = 0.84 / columns;
    const rel = (u - 0.08) / span;
    const i = Math.floor(rel);
    if (i < 0 || i >= columns) return 0.1;
    const x = rel - i - 0.5; // -0.5..0.5 within the column's slot
    const width = v < 0.33 ? 0.4 : 0.3; // a wider capital on top
    if (Math.abs(x) > width) return 0.1;
    const round = Math.cos(((x / width + 0.35) * Math.PI) / 2.7) ** 2;
    const flute = 0.88 + 0.12 * Math.cos((x / width) * Math.PI * 4);
    return (0.3 + 0.7 * round) * flute;
  }
  // Three steps, widening to the bottom.
  const step = Math.min(2, Math.floor((v - 0.84) / 0.054));
  const inset = [0.04, 0.02, 0][step] as number;
  return u < inset || u > 1 - inset ? -1 : ([0.85, 0.72, 0.6][step] as number) - u * 0.2;
}

/**
 * A halftone scene in white dots on the brand blue: a temple on a plain whose surface ripples
 * slowly. The sky and temple are computed once per size; only the plain is redrawn. Pauses when
 * off screen or in a hidden tab; one still frame for reduced motion.
 */
export function Halftone({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let cell = 7;
    let cols = 0;
    let rows = 0;
    let fixed = new Float32Array(0); // brightness of static cells; -1 marks the plain
    const layer = document.createElement('canvas'); // the static cells, drawn once per size
    const layerCtx = layer.getContext('2d') as CanvasRenderingContext2D;
    let frame = 0;
    let visible = true;
    // Where the temple is, for the owl on its roof and the memories rising from it.
    let templeBox = { x: 0, y: 0, w: 0, h: 0 };
    let stars: { x: number; y: number; speed: number; phase: number }[] = [];
    // How much of the art shows at a point: 1 everywhere, less behind the text on wide screens.
    let calm = (_x: number, _y: number): number => 1;
    let last = 0;

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cell = width < 640 ? 4 : 5;
      cols = Math.ceil(width / cell);
      rows = Math.ceil(height / cell);
      // Phones and tablets: the temple goes below the text. The same query as the CSS, which counts
      // the scrollbar, so the two always agree.
      const narrow = !window.matchMedia('(min-width: 1024px)').matches;
      const horizon = narrow ? 0.72 : 0.68;
      // The temple sits right of the text on wide screens, centered below it on phones.
      // On wide screens it stays in the right half of the page's 72rem frame, not of the window.
      const frameW = Math.min(width, 1152);
      const frameX = (width - frameW) / 2;
      const box = narrow
        ? { x: 0.12, y: 0.69, w: 0.76, h: 0.26 }
        : frameW < 1150
          ? // Laptop widths: lower and smaller, below the headline's first line.
            { x: (frameX + frameW * 0.6) / width, y: 0.36, w: (frameW * 0.36) / width, h: 0.52 }
          : { x: (frameX + frameW * 0.58) / width, y: 0.22, w: (frameW * 0.38) / width, h: 0.62 };
      const skyScale = narrow ? 0.55 : 1;
      const glow = { x: box.x + box.w / 2, y: box.y + box.h * 0.15 };
      templeBox = { x: box.x * width, y: box.y * height, w: box.w * width, h: box.h * height };
      // Stars in the upper sky, away from the temple; fixed positions from a simple hash.
      stars = Array.from({ length: narrow ? 14 : 26 }, (_, i) => {
        const hx = (Math.sin(i * 91.7) * 43758.5) % 1;
        const hy = (Math.sin(i * 12.3) * 24634.6) % 1;
        return {
          x: Math.abs(hx) * width,
          y: Math.abs(hy) * height * (narrow ? 0.5 : horizon * 0.55),
          speed: 0.6 + Math.abs(hx) * 1.4,
          phase: i * 1.7,
        };
      });
      if (narrow) calm = () => 1;
      else {
        // An oval around the text column; the dots shrink smoothly toward its middle.
        // Laptops: the text runs higher and further left in a narrower frame.
        const compact = frameW < 1150;
        const cx = frameX + frameW * (compact ? 0.22 : 0.27);
        const cy = height * (compact ? 0.42 : 0.48);
        const rx = frameW * 0.36;
        const ry = height * 0.46;
        calm = (x, y) => {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          const t = Math.min(1, Math.max(0, (d - 0.35) / 0.85));
          return 0.1 + 0.9 * t * t * (3 - 2 * t);
        };
      }
      fixed = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        const v = (r * cell) / height;
        for (let c = 0; c < cols; c++) {
          const u = (c * cell) / width;
          const t = temple((u - box.x) / box.w, (v - box.y) / box.h);
          let b: number;
          if (t >= 0) b = t;
          else if (v >= horizon) b = -1;
          else {
            // Sky: darker high up, a soft light behind the pediment, low hills at the horizon.
            const d = (u - glow.x) ** 2 * 1.6 + (v - glow.y) ** 2 * 3;
            b = skyScale * (0.06 + 0.22 * (v / horizon) ** 3 + 0.32 * Math.exp(-d / 0.03));
            const hill = horizon - 0.035 * (1 + Math.sin(u * 9) * 0.5 + Math.sin(u * 23) * 0.2);
            if (v > hill) b = 0.34;
          }
          // A little grain, fixed per cell, so it reads as print rather than a grid.
          const grain = (Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1;
          fixed[r * cols + c] =
            b === -1 ? -1 : Math.max(0, b + grain * 0.06) * calm(c * cell, r * cell);
        }
      }
      layer.width = canvas.width;
      layer.height = canvas.height;
      layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      layerCtx.fillStyle = '#ffffff';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const b = fixed[r * cols + c] as number;
          if (b !== -1) dot(layerCtx, c * cell + cell / 2, r * cell + cell / 2, b);
        }
      }
      draw(last);
    };

    const dot = (target: CanvasRenderingContext2D, x: number, y: number, b: number) => {
      if (b < 0.03) return;
      target.beginPath();
      target.arc(x, y, cell * 0.56 * Math.sqrt(Math.min(1, b)), 0, Math.PI * 2);
      target.fill();
    };

    const draw = (time: number) => {
      const t = time / 1000;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(layer, 0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      const horizonRow = fixed.findIndex((b) => b === -1);
      const top = horizonRow === -1 ? rows : Math.floor(horizonRow / cols);
      for (let r = 0; r < rows; r++) {
        const y = r * cell + cell / 2;
        // Rows of the plain: perspective depth, and a slow ripple across the surface.
        const depth = r >= top ? (r - top + 1) / Math.max(1, rows - top) : 0;
        const z = 1 / Math.max(depth, 0.02);
        for (let c = 0; c < cols; c++) {
          const x = c * cell + cell / 2;
          const b = fixed[r * cols + c] as number;
          if (b !== -1) continue; // on the cached layer
          const wx = ((x - width / 2) / width) * z * 6;
          const wave =
            Math.sin(wx * 0.8 + t * 0.9) * Math.cos(z * 1.4 - t * 1.3) * 0.6 +
            Math.sin((wx + z) * 0.5 + t * 0.5) * 0.4;
          dot(ctx, x, y, (0.14 + 0.56 * depth) * (0.55 + 0.45 * wave) * calm(x, y));
        }
      }
      life(t);
    };

    /** A sprite frame as square pixels, snapped to the halftone grid. */
    const sprite = (f: Frame, x: number, y: number, alpha = 1) => {
      const gx = Math.round(x / cell) * cell;
      const gy = Math.round(y / cell) * cell;
      ctx.globalAlpha = alpha;
      f.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '#') ctx.fillRect(gx + c * cell, gy + r * cell, cell - 1, cell - 1);
        }
      });
      ctx.globalAlpha = 1;
    };

    const life = (t: number) => {
      ctx.fillStyle = '#ffffff';
      // Stars: each sparkles now and then, into a small plus at its brightest.
      for (const star of stars) {
        const b = Math.max(0, Math.sin(t * star.speed + star.phase)) ** 10;
        if (b < 0.05) continue;
        const gx = Math.round(star.x / cell) * cell;
        const gy = Math.round(star.y / cell) * cell;
        ctx.globalAlpha = b * calm(gx, gy);
        ctx.fillRect(gx, gy, cell - 1, cell - 1);
        if (b > 0.6) {
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            ctx.fillRect(gx + dx * cell, gy + dy * cell, cell - 1, cell - 1);
          }
        }
      }
      ctx.globalAlpha = 1;

      // Memories rising from the temple roof, drifting, and fading out.
      const roof = templeBox.y + templeBox.h * 0.1;
      for (let i = 0; i < 16; i++) {
        const p = (t / 7 + i / 16) % 1;
        const start = templeBox.x + templeBox.w * (0.15 + ((i * 0.618) % 1) * 0.7);
        const x = start + Math.sin(p * 4 + i) * cell * 3;
        const y = roof - p * templeBox.h * 0.55;
        const size = i % 4 === 0 ? 2 : 1;
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.9;
        const gx = Math.round(x / cell) * cell;
        const gy = Math.round(y / cell) * cell;
        ctx.fillRect(gx, gy, size * cell - 1, size * cell - 1);
      }
      ctx.globalAlpha = 1;

      // Birds crossing the sky, each at its own height and pace.
      for (let i = 0; i < 3; i++) {
        const span = width + 160;
        const x = ((t * (26 + i * 9) + i * span * 0.37) % span) - 80;
        const y = height * (0.12 + i * 0.07) + Math.sin(t * 0.8 + i * 2) * cell * 1.5;
        sprite(BIRD[Math.floor(t * 5 + i) % BIRD.length] as Frame, x, y, 0.95 * calm(x, y));
      }

      // Athena's owl keeps watch on the apex of the pediment.
      const owl = OWL[Math.floor(t * 3) % OWL.length] as Frame;
      const owlW = (owl[0]?.length ?? 0) * cell;
      sprite(owl, templeBox.x + templeBox.w / 2 - owlW / 2, templeBox.y - owl.length * cell);
    };

    const loop = (time: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden || time - last < 1000 / 20) return;
      last = time;
      draw(time);
    };

    const resize = new ResizeObserver(layout);
    resize.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(canvas);
    if (!still) frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
