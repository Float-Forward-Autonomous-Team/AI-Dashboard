export const FONT = 'Montserrat, system-ui, -apple-system, sans-serif';

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const COLOR_KEYS = [
  'surface', 'text', 'muted', 'faint', 'rule', 'border', 'data', 'brand', 'sky', 'alert', 'negative',
  'map-water', 'map-land', 'map-edge', 'map-route', 'map-track', 'map-scan',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/** Colours from the CSS tokens in styles.css, read once at start-up. */
export const C = Object.fromEntries(COLOR_KEYS.map(k => [k, cssVar('--' + k)])) as Record<ColorKey, string>;

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Blend two #rrggbb colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}

const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

/** Size a canvas to its CSS box at device pixel ratio; returns a context that draws in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  const w = Math.round(r.width * d), h = Math.round(r.height * d);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  let ctx = contexts.get(canvas);
  if (!ctx) {
    ctx = canvas.getContext('2d')!;
    contexts.set(canvas, ctx);
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
