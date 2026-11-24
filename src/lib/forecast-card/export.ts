// Browser side of the card: measuring text with the page's fonts, and turning the card SVG into a PNG.
// The site's web fonts are embedded into the SVG as data URIs, because an SVG drawn as an image can't load files;
// Chinese falls back to the system's fonts, which an SVG image can use.
import type { Fonts, Measure } from './render';

/** The page's display and body font stacks (self-hosted by Astro under hashed family names). */
export function pageFonts(): Fonts {
  const cs = getComputedStyle(document.documentElement);
  return {
    display: cs.getPropertyValue('--font-display').trim() || 'Georgia, serif',
    body: cs.getPropertyValue('--font-body').trim() || 'system-ui, sans-serif',
  };
}

/** Text width from a canvas, in the same fonts the SVG uses. */
export function canvasMeasure(fonts: Fonts): Measure {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const cjk = '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  return (text, size, weight, face) => {
    ctx.font = `${weight} ${size}px ${face === 'display' ? fonts.display : fonts.body}, ${cjk}`;
    return ctx.measureText(text).width;
  };
}

let fontCssCache: Promise<string> | null = null;

/** @font-face rules for the page's own fonts, with each file inlined as a data URI. */
function embeddedFontCss(): Promise<string> {
  fontCssCache ??= (async () => {
    const rules: CSSFontFaceRule[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const r of Array.from(sheet.cssRules)) if (r instanceof CSSFontFaceRule && /url\(/.test(r.cssText)) rules.push(r);
      } catch {} // a stylesheet from another origin can't be read; ours are inline
    }
    const parts = await Promise.all(
      rules.map(async (r) => {
        const m = r.cssText.match(/url\("?([^")]+)"?\)/);
        if (!m) return '';
        try {
          const blob = await (await fetch(m[1])).blob();
          const data = await new Promise<string>((res) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result));
            fr.readAsDataURL(blob);
          });
          return r.cssText.replace(m[0], `url("${data}")`);
        } catch {
          return '';
        }
      }),
    );
    return parts.join('\n');
  })();
  return fontCssCache;
}

/** Rasterize the card SVG at `scale`× (3× suits phone screens). */
export async function cardPng(svg: string, width: number, height: number, scale = 3): Promise<Blob> {
  const css = await embeddedFontCss();
  const withFonts = svg.replace(/^(<svg[^>]*>)/, `$1<defs><style>${css}</style></defs>`);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withFonts)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  // Safari sometimes draws an SVG image before its embedded fonts are ready: draw, wait a beat, draw again
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  await new Promise((r) => setTimeout(r, 120));
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}

/** Hand the PNG to the phone's share sheet when it can take files, otherwise download it. */
export async function saveOrShare(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'shared';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}
