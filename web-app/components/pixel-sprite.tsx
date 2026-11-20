import type { CSSProperties } from 'react';
import type { Frame } from './pixel-art';

/**
 * A pixel-art sprite that plays its frames as a sprite sheet: every frame is drawn side by side
 * in one SVG, and a CSS `steps()` animation slides the sheet one frame at a time. Only
 * `transform` changes, so it costs nothing on the main thread. With reduced motion it shows the
 * last frame, which is the finished picture.
 */
export function PixelSprite({
  frames,
  pixel = 4,
  fps = 6,
  className,
  label,
}: {
  frames: Frame[];
  pixel?: number;
  fps?: number;
  className?: string;
  label?: string;
}) {
  const first = frames[0] ?? [];
  const w = first[0]?.length ?? 0;
  const h = first.length;
  const rects: string[] = [];
  frames.forEach((frame, f) => {
    frame.forEach((row, y) => {
      // One rect per run of lit pixels keeps the SVG small.
      for (const run of row.matchAll(/#+/g)) {
        rects.push(`M${f * w + (run.index ?? 0)} ${y}h${run[0].length}v1h-${run[0].length}z`);
      }
    });
  });
  const width = w * pixel;
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`pixel-sprite inline-block overflow-hidden ${className ?? ''}`}
      style={{ width, height: h * pixel }}
    >
      <svg
        className="pixel-sheet block"
        width={width * frames.length}
        height={h * pixel}
        viewBox={`0 0 ${w * frames.length} ${h}`}
        shapeRendering="crispEdges"
        style={
          {
            '--sheet-shift': `-${width * frames.length}px`,
            '--sheet-last': `-${width * (frames.length - 1)}px`,
            '--sheet-frames': frames.length,
            '--sheet-duration': `${frames.length / fps}s`,
          } as CSSProperties
        }
      >
        <path d={rects.join('')} fill="currentColor" />
      </svg>
    </span>
  );
}
