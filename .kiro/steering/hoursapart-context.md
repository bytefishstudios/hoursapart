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
npm run dev                 # http://localhost:4321 (forces NODE_ENV=development)
npm run build               # static output to dist/ (659 pages)
npm test                    # vitest run (110 tests)
npm run typecheck           # tsc --noEmit
npm run smoke:browser       # real Chrome hydration + responsive overflow check
npm run format:check        # Prettier verification
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
  `?p=<zone>-<workStart>-<workEnd>-<workDays>[-<label>]|<next person>...&a=<anchorIndex>&m=<meetingMinutes>&l=<durationMinutes>&d=<YYYY-MM-DD>`
  Minutes are since local midnight; duration `l` supports 30/60/90/120 and is omitted at
  the 30-minute default. New links use `|` between participants; it is escaped inside labels,
  so both custom names and underscores inside IANA zones remain safe. Decode still accepts
  legacy `_` links (and the short-lived development `~` form). `d` is omitted when live/today; decode is tolerant of mangled
  links and backward-compatible with links made before dates or durations existed.

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
- `cities.ts` — 128 cities: name, country, timeZone, lat, aliases, `slug`
  (unique-asserted at module load — THROWS on collision or a hyphen in a zone id, since
  share.ts is hyphen-delimited), `isHub`. Regional coverage includes Chengdu, Kyoto and
  other secondary East/Southeast Asian cities without making them pair-page hubs. `HUBS`
  (~33), `COMPARISON_CITIES` (16, for the
  per-city difference table), `hubPairs()` (skips same-timezone pairs), `cityBySlug`,
  `citiesSharingZone`.
- `difference.ts` — the pair-page engine. `offsetSpans` (day-by-day scan at local noon in
  zone A), `describeDifference` (spans + distinctGaps + `varies` + `shortestSpan`),
  `gapOnDate`, `convertTime` (returns `{minutes, dayShift}`), `dstProfile`, `formatGap`.
- `share.ts` — `encodeScenario`/`decodeScenario`, including backward-compatible meeting
  duration state. `calendar.ts` — portable UTC `.ics`, Google Calendar and Outlook export
  helpers. `useScenario.ts` — the shared React state hook (seeds viewer zone + London + New
  York + Tokyo).

Components — `src/components/`:

- `WorldClock.tsx` (homepage), `TeamPlanner.tsx` (`/overlap`), `CityClock.tsx`
  (`/time/*` live part), `PairClock.tsx` (`/difference/*` live part), `DateControl.tsx`
  (shared native `input[type=date]` + prev/next/Today; null date = live), `CityPicker.tsx`.

Pages — `src/pages/`: `index.astro`, `overlap.astro`, `time/[city].astro`
(getStaticPaths over all cities), `difference/[a]/[b].astro` (getStaticPaths over
`hubPairs()`, alphabetical slug order so each pair has ONE canonical URL),
`404.astro` (noindex), `privacy.astro`, `contact.astro` (browser-built mailto feedback;
no form backend). Layout: `layouts/Base.astro` — carries the
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
for the viewer's city and drives the footer toggle (Automatic / Light / Dark). Automatic
mode tracks local day/twilight/night; a stored Light or Dark preference always wins.

## Key decisions

- World clock = homepage, overlap = `/overlap`. Rejected shipping overlap standalone.
- Default seed = viewer + London + NY + Tokyo (NOT Sydney+London, which never overlap on
  9–5 and made the first impression read as broken).
- When no full-duration overlap exists, show the best full-meeting coverage instead of a dead
  end; once a time is selected, preserve and report each person&rsquo;s partial coverage rather
  than collapsing them to unavailable.
- Static difference pages only between hubs, skipping same-timezone and always-zero pairs
  — a few hundred near-identical pages look like doorway pages to search engines.
- Pair-page span scan anchors to the FIRST OF THE MONTH, not "today", so static rows keep
  real dates on both ends between deploys.
- Palette deliberately warm "paper", not slate/indigo (that is the AI-default look).
- Meeting duration is restricted to 30/60/90/120 minutes because the planner evaluates a
  30-minute grid. Participant rows always show their configured working hours and never change
  with Duration; changing Duration only changes the selected outline and its coverage summary.
  Selected meetings report full, partial or zero per-person coverage. End instants are elapsed UTC
  time so DST transitions stay correct.
- Calendar export uses UTC `DTSTART`/exclusive `DTEND` for portable `.ics` files, plus
  encoded Google/Outlook links. Feedback is a plain outbound link to a hosted Tally form
  (`https://tally.so/r/jaRql6`), chosen over a Pages Function or a `mailto:` draft: free,
  unlimited, no backend, no mailbox, and no third-party request until the link is clicked.
  There is deliberately NO contact email address anywhere on the site.
- Deploy target = Cloudflare Pages (build `npm run build`, output `dist`, Node from
  `.nvmrc`). Apex `hoursapart.app` is canonical; `www` 301s to it via `public/_redirects`.
- Formatting = Prettier (+ prettier-plugin-astro), enforced in CI via `format:check`.
  ESLint is DEFERRED: `typescript-eslint` peers on `typescript <6.1.0` but the project runs
  TS 7.0.2, so no compatible release exists yet. Biome is the fallback if lint is wanted
  sooner. Do NOT force it with `--legacy-peer-deps` (breaks `npm ci` for others).
- No CSP header yet: the pre-paint theme script must be inline and the JSON-LD is inline and
  per-page, so a static hash/nonce can't cover them. The other security headers ARE set.

## Current status (update me)

- 659 pages build clean: home, `/overlap`, `/privacy`, `/contact`, `/404`, 128
  `/time/[city]`, 526 `/difference/[a]/[b]`. Sitemap generated.
- 111 tests pass across 5 files (time, share, solar, difference, calendar). tsc and
  Prettier clean.
- World clock hierarchy shows the base city only in the main console, including its daylight
  state/strip; lower cards are explicitly “Other cities.” Base identity survives reorder/removal.
  Other-city cards use a conventional six-dot grip backed by pinned dnd-kit sensors: the active
  card follows the pointer/touch via CSS transform while neighbouring cards animate out of its
  way, with keyboard sorting support. Cards also promote the full local weekday/date plus an always-visible base-relative Yesterday/Today/Tomorrow badge (or an
  exact multi-day label across the date line). City search includes 16 additional regional cities
  such as Chengdu and Kyoto. Automatic theme wording explicitly means following local day/night.
- Meeting planner supports 30/60/90/120-minute meetings in share URLs and validates every
  recommendation across the full interval. Participant timelines now show only configured working
  hours and remain byte-for-byte stable when Duration changes. The selected outline and summary
  are the only duration-dependent chart elements. Selected meetings report full, partial or zero
  coverage per person (and in copied summaries), while the copy consistently says working
  hours rather than claiming calendar free/busy knowledge. Wall-clock starts resolve once on DST
  days; nonexistent starts are disabled and the resolved instant is reused for export. Mobile
  recommendation cards expose their valid starts. Selected meetings export to `.ics`, Google
  Calendar, and Outlook with participant-local summaries and exact UTC endpoints.
- Static `/contact` links out to the hosted Tally feedback form; the old local form, its
  `mailto:` draft script, and every email address were removed. Privacy disclosure states there
  is no form backend and no mailbox.
- Production UI redesign complete: responsive product shell; tool-first homepage; high-contrast
  world-clock console; mobile-specific meeting recommendations; daylight-led city hero; unified
  pair converter; and labelled mobile table cards. Real-Chrome smoke checks cover `/`, a
  duration-selected `/overlap`, `/time/chengdu`, `/difference/london/sydney`, and `/contact`
  at 1440×1000 and 390×844. The overlap check uses a London 18:00–02:00 overnight
  schedule, changes Duration from 30 minutes to 2 hours, proves all 48 working-hour states stay
  identical, and verifies 00:30–02:30 reports 1h30m of 2h partial coverage. The home check
  performs a real CDP mouse drag, requires a non-zero in-flight transform, and proves the final
  order changes while the base remains unchanged. All 10 checks render expected content, throw
  zero runtime exceptions, and have zero page-level overflow; React routes also prove hydration.
- `npm run dev` forces `NODE_ENV=development` to prevent Vite from caching React's production
  `jsx-dev-runtime` during development. `npm run smoke:browser` guards against empty islands.
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
- **Feedback form.** Submit a test response through the Tally form and confirm the notification
  arrives. No mailbox is needed; the address `hello@hoursapart.app` was never set up and has been
  removed from the site.
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
