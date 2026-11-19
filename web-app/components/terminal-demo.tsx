'use client';

import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { amphora, LOGO, SYSTEM_MONO } from './ascii';

const COMMAND = 'npx -y remimem init';
const MODEL_MB = 22.6;
const DONE = [
  'Created .remimem/config.json',
  'Added .remimem/index.db* to .gitignore',
  'Everything runs on this machine. No telemetry.',
  'Indexed 570 files, 3,384 symbols, 5,300 chunks in 38s',
];

/** Stages of the replay; each one shows everything before it. */
type Stage = 'typing' | 'logo' | 'download' | 'done';

/**
 * A replay of `remimem init` in a terminal window: the command types itself, the logo
 * appears, the amphora fills while the model downloads, then the steps are checked off.
 * It plays once when it scrolls into view. With reduced motion it shows the final state.
 */
export function TerminalDemo() {
  const [stage, setStage] = useState<Stage>('done');
  const [typed, setTyped] = useState(COMMAND.length);
  const [fraction, setFraction] = useState(1);
  const [checked, setChecked] = useState(DONE.length);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setStage('typing');
    setTyped(0);
    setFraction(0);
    setChecked(0);
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    for (let i = 1; i <= COMMAND.length; i++) at(i * 45, () => setTyped(i));
    const t0 = COMMAND.length * 45 + 350;
    at(t0, () => setStage('logo'));
    at(t0 + 700, () => setStage('download'));
    for (let i = 1; i <= 40; i++) at(t0 + 700 + i * 55, () => setFraction(i / 40));
    const t1 = t0 + 700 + 40 * 55 + 300;
    at(t1, () => setStage('done'));
    for (let i = 1; i <= DONE.length; i++) at(t1 + i * 280, () => setChecked(i));
  }, []);

  // The server renders the finished state; the client starts from the beginning.
  useLayoutEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStage('typing');
      setTyped(0);
      setFraction(0);
      setChecked(0);
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        play();
        observer.disconnect();
      }
    });
    observer.observe(el);
    const pending = timers.current;
    return () => {
      observer.disconnect();
      pending.forEach(clearTimeout);
    };
  }, [play]);

  const showLogo = stage !== 'typing';
  const showDownload = stage === 'download' || stage === 'done';

  return (
    <div
      ref={ref}
      className="w-full overflow-hidden rounded-lg border border-fd-foreground/15 bg-[#1b1a15] text-left text-[#ece6d6] shadow-2xl shadow-black/20"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#d9774f]" />
        <span className="size-2.5 rounded-full bg-[#d9a94b]" />
        <span className="size-2.5 rounded-full bg-[#8a9a5b]" />
        <span className="ml-3 font-mono text-xs text-white/40">~/your-project</span>
        <button
          type="button"
          onClick={play}
          aria-label="Replay"
          className="ml-auto rounded p-1 text-white/40 transition-colors hover:text-white/80"
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>
      {/* The finished output, for screen readers; the animation is decoration. */}
      <p className="sr-only">
        Running npx -y remimem init shows the remimem logo, downloads the embedding model once, and
        then reports: {DONE.join('. ')}.
      </p>
      <div
        aria-hidden
        className="h-[380px] overflow-hidden p-4 font-mono text-[10px] leading-[1.45] sm:h-[400px] sm:p-5 sm:text-[11.5px]"
      >
        <div>
          <span className="text-[#d9a94b]">$ </span>
          {COMMAND.slice(0, typed)}
          {stage === 'typing' && <span className="typing-cursor" />}
        </div>
        {showLogo && (
          <div className="enter mt-3">
            <pre
              // The web mono font has no box-drawing characters; one system font keeps the
              // logo's glyphs the same width.
              style={{ fontFamily: SYSTEM_MONO }}
              className="overflow-hidden text-[5.4px] leading-[1.05] text-[#d9a94b] sm:text-[9.5px]"
            >
              {LOGO}
            </pre>
            <div className="mt-2 text-white/80">
              codebase memory for coding agents <span className="text-white/35">v0.1.0</span>
            </div>
          </div>
        )}
        {showDownload && (
          <div className="mt-3 flex gap-3 sm:gap-4">
            <pre style={{ fontFamily: SYSTEM_MONO }} className="leading-[1.25] text-[#d9a94b]">
              {amphora(fraction).join('\n')}
            </pre>
            <div className="min-w-0 pt-6">
              <div className="text-white/85">Downloading the embedding model</div>
              <div className="text-white/40">downloaded once, then cached</div>
              <div className="mt-2 text-[#d9a94b]">
                {'█'.repeat(Math.round(fraction * 16))}
                <span className="text-white/20">{'░'.repeat(16 - Math.round(fraction * 16))}</span>
                <span className="ml-2 text-white/80">{Math.round(fraction * 100)}%</span>
              </div>
              <div className="text-white/40">
                {(fraction * MODEL_MB).toFixed(1)} of {MODEL_MB} MB
              </div>
            </div>
          </div>
        )}
        {stage === 'done' && (
          <div className="mt-2 space-y-0.5">
            {DONE.slice(0, checked).map((line) => (
              <div key={line} className="enter">
                <span className="text-[#8fbf7a]">✓</span> {line}
              </div>
            ))}
            {checked === DONE.length && (
              <div className="enter mt-2 text-white/50">
                Next:{' '}
                <span className="text-white/85">
                  claude mcp add remimem -- npx -y remimem serve
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
