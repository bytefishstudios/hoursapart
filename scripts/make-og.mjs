// Rasterises the SVG sources into the PNGs that social cards and app icons need.
// X, Facebook and LinkedIn do not render SVG share images, hence og.png.
//
//   npm run assets
//
// sharp is already present as Astro's image-pipeline dependency.
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * og.svg carries explicit 1200x630 pixel dimensions, so the default 72 dpi
 * renders it at native size. favicon.svg is a 32-unit viewBox with no pixel
 * size, so it needs a high density to rasterise crisply before downscaling.
 * The icon PNGs are flattened onto the mark's own dark ground so iOS does not
 * show black in the transparent corners once it applies its rounded mask.
 */
const jobs = [
  { src: 'og.svg', out: 'og.png', width: 1200, height: 630, density: 72, bg: null },
  {
    src: 'favicon.svg',
    out: 'apple-touch-icon.png',
    width: 180,
    height: 180,
    density: 2304,
    bg: '#1c1a17',
  },
  {
    src: 'favicon.svg',
    out: 'icon-192.png',
    width: 192,
    height: 192,
    density: 2304,
    bg: '#1c1a17',
  },
  {
    src: 'favicon.svg',
    out: 'icon-512.png',
    width: 512,
    height: 512,
    density: 2304,
    bg: '#1c1a17',
  },
];

for (const { src, out, width, height, density, bg } of jobs) {
  const input = await readFile(join(pub, src));
  let pipe = sharp(input, { density }).resize(width, height, {
    fit: 'contain',
    background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (bg) pipe = pipe.flatten({ background: bg });
  await pipe.png().toFile(join(pub, out));
  console.log(`wrote public/${out} (${width}x${height})`);
}
