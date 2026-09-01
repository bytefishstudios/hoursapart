# Hours Apart

A world clock and time-zone tool that answers the two questions a plain clock leaves out:

- **Is it light there?** Every city shows a day / twilight / night state and a sky strip, computed from its latitude.
- **How far apart, really?** The gap between two cities is not a fixed number. Because places change their clocks on different weekends, a recurring meeting drifts up to four times a year. Hours Apart shows the exact dates.

The world clock is the homepage; the meeting-overlap planner lives at `/overlap`. There is no backend and no account — the whole scenario lives in the URL, which is also how you share it.

## Stack

Astro (static output) · React islands · Tailwind · Vitest · TypeScript. Time data comes from the browser/Node `Intl` API; no tzdata is bundled.

## Commands

```bash
npm run dev         # local dev server
npm run build       # static build to dist/
npm test            # unit tests (vitest)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write
npm run assets      # regenerate og.png + app icons from the SVG sources
```

Requires Node `>=22.12.0` (see `.nvmrc`).

## Deployment

Static site deployed on **Cloudflare Pages**:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: from `.nvmrc`

`_redirects` sends `www` to the apex, and `_headers` sets security headers plus long-lived caching for hashed assets. The production URL lives in `astro.config.mjs` (`SITE`, overridable with `SITE_URL` for preview builds).

## Pre-launch

See [`LAUNCH-CHECKLIST.md`](./LAUNCH-CHECKLIST.md) for the remaining go-live tasks.
