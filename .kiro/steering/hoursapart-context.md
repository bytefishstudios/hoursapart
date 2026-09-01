---
inclusion: always
---

# Hours Apart — project context

Session handoff so a fresh Kiro window (opened on this folder) can continue without
re-explaining. Keep the "Current status" and "Open items" sections updated as work
proceeds; the rest is durable.

## What this is

A world clock and time-zone tool, static-generated, no backend. Two differentiators
that no mainstream competitor (worldtimebuddy, 24timezones, timeanddate) does well:

1. **"Is it light there"** — every city shows a day/twilight/night state and a sky
   strip, computed from latitude. A plain clock says "16:00 in Stockholm"; we say
   whether the sun is up, which is the actual question behind "can I call now".
2. **DST drift warning** — the gap between two cities is NOT a fixed number. London and
   Sydney are 9, 10, or 11 hours apart depending on the date, because the two change
   clocks on different weekends. A recurring meeting breaks up to 4 times a year. We
   show the exact dates. This is the sharpest, most defensible edge.

Product shape: the **world clock is the homepage** (acquisition/habit); the **overlap
meeting-planner lives at `/overlap`** (the shareable artifact). The city list is shared
between them through the URL, so you never re-enter cities.

## Name & domain (decided)

- Product name: **Hours Apart**. Domain: **hoursapart.app**.
- Why `.app` not `.com`: `hoursapart.com` (plural, the natural spelling) is taken by
  someone else, so its one real advantage — default type-in traffic — is already lost.
  `hourapart.com` (singular) is available but singular isn't the idiom and leaks spoken
  traffic to the plural `.com` owner. `.app` is SEO-equal, HTTPS-forced (free for a
  static site), and lets us own the correctly-spelled name. Keyword-in-domain gives no
  SEO benefit anyway; our keywords are in the paths (`/time/london`).
- `overlap` as a word stays in the code: it is the meeting-overlap FEATURE and the
  `/overlap` route, not the brand. Do not rename the route or the engine.

## Stack

Astro 7.2.9 (static, `build.format: 'directory'`), React 19.2.8 islands,
Tailwind 4.3.3 (via `@tailwindcss/vite`), Vitest 4.1.11, TypeScript 7.0.2,
`@astrojs/react` 6.0.4, `@astrojs/sitemap` 3.7.3. No tzdata bundled — everything uses
the browser/Node `Intl` API.

## Commands

```
cd /Users/alan.lyu1/Workspace/hoursapart
npm run dev                 # http://localhost:4321
npm run build               # static output to dist/ (currently 640 pages)
npm test                    # vitest run (93 tests)
npx tsc --noEmit            # typecheck
```

Notes:

- `npx astro check` is too slow (times out ~300s); use `tsc --noEmit` for types.
- TypeScript 7 removed `baseUrl`; keep tsconfig WITHOUT path aliases.
- Running bash may emit `direnv: ...` / colima / AWS noise from a sibling workspace;
  it is harmless and unrelated to this project.

## Architecture

- **Static-first.** Offsets, DST dates, sunrise tables do not change between builds, so
  they are generated at build time. Only the live clock runs client-side. The split is
  deliberate: pages are useful before JS loads, precise after.
- **URL is the state.** No accounts, no DB. The scenario lives in the query string, which
  is also the share mechanism. Format:
  `?p=<zone>-<workStart>-<workEnd>-<workDays>[-<label>]_<next person>...&a=<anchorIndex>&m=<meetingMinutes>&d=<YYYY-MM-DD>`
  Minutes are since local midnight; `d` is omitted when live/today; decode is tolerant of
  mangled links and backward-compatible with date-less (pre-date) links.

### Files

Engine — `src/lib/time/`:

- `zone.ts` — zoned time primitives. `zonedParts`, `offsetMinutes` (strips ms before
  dividing — matters on transition boundaries), `formatMinutes/Offset`, and the date
  domain: dates are `YYYY-MM-DD` STRINGS not `Date` (a Date is an instant; midnight UTC
  is still the previous day in LA). `toIsoDate`, `isValidIsoDate`, `addDays`,
  `daysBetween`, `zonedDateTimeToInstant` (two-pass; handles spring-forward gap &
  ambiguous autumn hour), `formatIsoDateLong/Short` (en-GB, day-month order).
- `overlap.ts` — `Participant`, `isAvailable` (handles overnight shifts + workdays),
  `findFullOverlaps`. NOTE: `findBestOverlaps` and `scanFrom` are DEAD exports (nothing
  imports them; the partial-overlap logic lives in TeamPlanner because it must map to
  drawn grid columns). Safe to delete on a cleanup pass.
- `dst.ts` — `findTransitions` (empirical: samples daily, bisects to the minute — works
  for DST, permanent changes, and one-off political redefinitions), `resolveLocalTime`,
  `projectMeeting` (projects a recurring meeting forward, finds the weeks it shifts).
- `solar.ts` — `solarElevation`/`solarElevationAt`, `skyState` (day/twilight/night),
  `sunTimes` (sunrise/sunset/daylight by sampling — handles polar day/night with no
  special-casing), `daylightHours`. WHY ONLY LATITUDE: longitude taken as the zone's
  central meridian cancels the UTC-offset term in the NOAA equation. Cost: sunrise/sunset
  CLOCK times can be ~75 min off for cities far from their meridian (Madrid); daylight
  DURATION is accurate. Latitude is per-CITY not per-zone (Miami 25.76 vs Boston 42.36
  share America/New_York).
- `cities.ts` — ~112 cities: name, country, timeZone, lat, aliases, `slug`
  (unique-asserted at module load — THROWS on collision or a hyphen in a zone id, since
  share.ts is hyphen-delimited), `isHub`. `HUBS` (~33), `COMPARISON_CITIES` (16, for the
  per-city difference table), `hubPairs()` (skips same-timezone pairs), `cityBySlug`,
  `citiesSharingZone`.
- `difference.ts` — the pair-page engine. `offsetSpans` (day-by-day scan at local noon in
  zone A), `describeDifference` (spans + distinctGaps + `varies` + `shortestSpan`),
  `gapOnDate`, `convertTime` (returns `{minutes, dayShift}`), `dstProfile`, `formatGap`.
- `share.ts` — `encodeScenario`/`decodeScenario`. `useScenario.ts` — the shared React
  state hook (seeds viewer zone + London + New York + Tokyo).

Components — `src/components/`:

- `WorldClock.tsx` (homepage), `TeamPlanner.tsx` (`/overlap`), `CityClock.tsx`
  (`/time/*` live part), `PairClock.tsx` (`/difference/*` live part), `DateControl.tsx`
  (shared native `input[type=date]` + prev/next/Today; null date = live), `CityPicker.tsx`.

Pages — `src/pages/`: `index.astro`, `overlap.astro`, `time/[city].astro`
(getStaticPaths over all cities), `difference/[a]/[b].astro` (getStaticPaths over
`hubPairs()`, alphabetical slug order so each pair has ONE canonical URL),
`404.astro` (noindex), `privacy.astro`. Layout: `layouts/Base.astro` — carries the
"Hours Apart" wordmark banner, footer nav, and all OG / icon / theme-color meta. Styles:
`styles/global.css`.

Build & deploy files — `.nvmrc` (Node 22), `public/robots.txt`, `public/_redirects`
(www→apex 301), `public/_headers` (security headers + immutable cache for `/_astro/*`),
`public/site.webmanifest`, and `public/og.svg` (source) → `public/og.png` + app icons
generated by `scripts/make-og.mjs` (`npm run assets`, uses sharp — already an Astro dep).
`.github/workflows/ci.yml` runs typecheck + format:check + test + build. Prettier config in
`.prettierrc.json`.

### Theme (sky-driven)

Every Tailwind color compiles to `var(--color-*)`, so `[data-sky='day'|'twilight'|'night']`
blocks in `global.css` re-theme the whole site with zero component changes. An inline
script in `Base.astro` sets `data-sky` pre-paint (no flash) from `localStorage['sky-mode']`
or `prefers-color-scheme`; a deferred module script refines to the real solar sky state
for the viewer's city and drives the footer toggle (Follow my sky / Light / Dark). A
stored preference always wins.

## Key decisions

- World clock = homepage, overlap = `/overlap`. Rejected shipping overlap standalone.
- Default seed = viewer + London + NY + Tokyo (NOT Sydney+London, which never overlap on
  9–5 and made the first impression read as broken).
- When no full overlap exists, show the best partial ("2 of 4 free, 10:00–17:00, London
  and NY out") instead of a dead end.
- Static difference pages only between hubs, skipping same-timezone and always-zero pairs
  — a few hundred near-identical pages look like doorway pages to search engines.
- Pair-page span scan anchors to the FIRST OF THE MONTH, not "today", so static rows keep
  real dates on both ends between deploys.
- Palette deliberately warm "paper", not slate/indigo (that is the AI-default look).
- Deploy target = Cloudflare Pages (build `npm run build`, output `dist`, Node from
  `.nvmrc`). Apex `hoursapart.app` is canonical; `www` 301s to it via `public/_redirects`.
- Formatting = Prettier (+ prettier-plugin-astro), enforced in CI via `format:check`.
  ESLint is DEFERRED: `typescript-eslint` peers on `typescript <6.1.0` but the project runs
  TS 7.0.2, so no compatible release exists yet. Biome is the fallback if lint is wanted
  sooner. Do NOT force it with `--legacy-peer-deps` (breaks `npm ci` for others).
- No CSP header yet: the pre-paint theme script must be inline and the JSON-LD is inline and
  per-page, so a static hash/nonce can't cover them. The other security headers ARE set.

## Current status (update me)

- 642 pages build clean: home, `/overlap`, `/privacy`, `/404`, 112 `/time/[city]`,
  526 `/difference/[a]/[b]`. Sitemap generated. (Was 640 before `/privacy` + `/404`.)
- 93 tests pass across 4 files (time, share, solar, difference). tsc clean. Re-verified on
  Node 22.18 after the launch-prep changes below.
- Launch prep done in code: visible wordmark; `robots.txt`; OG image (`og.png`) + app icons
  - manifest + theme-color; security headers + www→apex redirect; privacy page; Prettier +
    CI + README. Dead `overlap.ts` exports removed. Remaining items are in `LAUNCH-CHECKLIST.md`.
- `SITE` in `astro.config.mjs` = `https://hoursapart.app` (env `SITE_URL` overrides for
  CI). All canonicals + sitemap derive from it; zero `example.com` left.
- Accessibility: all fg/bg pairs across the 3 palettes measured ≥4.5:1 WCAG AA. `paper-500`
  was fixed from oklch(0.62)=3.57:1 to oklch(0.54); `paper-300` is borders-only.
- Folder renamed overlap → hoursapart; caches cleared; verified from new path.

## Open items / next steps

Full launch list lives in `LAUNCH-CHECKLIST.md`. The code/config items are done; what is
left needs your accounts or manual testing:

- **Git.** Repo initialised with a `.gitignore` (node_modules, dist, .astro) and an initial
  commit. Pushing needs a remote you create — no remote/push has been done.
- **Cloudflare Pages.** Create the project + connect the repo, add the custom domain
  `hoursapart.app` and its DNS. Build `npm run build`, output `dist`, Node from `.nvmrc`.
- **Share / SEO ops.** Enable Cloudflare Web Analytics (dashboard, cookieless), register
  Google + Bing Search Console and submit the sitemap.
- **OG artwork.** `og.png` is generated from `og.svg`; swap in a designed image later if
  wanted (`npm run assets` regenerates).
- **Manual QA.** Lighthouse, cross-browser + iOS date input, keyboard / screen-reader pass,
  and DST spot-checks against real transition dates.
- **ESLint** deferred until `typescript-eslint` supports TS 7 (or adopt Biome).

## Working style the user has asked for

- Do NOT over-build or make scope/brand decisions for them; propose, then wait. They have
  called out over-eagerness before.
- Be decisive with a clear recommendation + reasoning when asked to choose; don't dump
  options without a pick.
- Verify claims with real checks (build/test/measured numbers), don't assert.
- Plain language, concrete worked examples over abstraction.
