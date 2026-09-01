# Hours Apart — Launch Checklist

Pre-launch task list for taking **Hours Apart** live on **Cloudflare Pages**.
Static Astro site, no backend; growth is share- and SEO-driven.

Legend: `[x]` done · `[ ]` todo · **(Blocker)** must ship before public launch ·
**(Recommended)** soon · **(Nice-to-have)** when there is time · _(you)_ needs your
account/DNS · _(QA)_ manual testing.

Last updated: 2026-09-01. Build is green: 642 pages, 93 tests, tsc clean.

## 1. Quality gates

- [x] **(Blocker)** `npm run build`, `npm test`, `npm run typecheck` all green
- [x] (Recommended) Prettier configured + enforced in CI (`format:check`)
- [ ] (Recommended) ESLint — **deferred**: `typescript-eslint` requires `typescript <6.1.0`, project is on TS 7.0.2. Revisit when it supports TS 7, or adopt Biome.
- [x] (Nice-to-have) CI runs typecheck + format:check + test + build on push

## 2. Repository

- [x] **(Blocker)** `git init` + `.gitignore` (node_modules, dist, .astro) + initial commit
- [ ] **(Blocker)** _(you)_ Push to a remote — Cloudflare Pages deploys from it
- [x] (Nice-to-have) `README.md`

## 3. Deployment — Cloudflare Pages

- [ ] **(Blocker)** _(you)_ Create Pages project; build `npm run build`, output `dist`
- [x] **(Blocker)** Pin Node version — `.nvmrc` (`22`, satisfies Astro's `>=22.12.0`)
- [ ] **(Blocker)** _(you)_ Custom domain `hoursapart.app` + DNS; HTTPS is automatic
- [x] **(Blocker)** `SITE` = `https://hoursapart.app` in `astro.config.mjs`
- [x] (Recommended) Apex is canonical; `www` → apex via `public/_redirects`
- [x] (Recommended) `public/_headers`: security headers + immutable cache for `/_astro/*`
- [ ] (Recommended) No CSP yet — inline pre-paint script + per-page inline JSON-LD block a static hash/nonce. Other security headers are set.
- [ ] (Recommended) _(you)_ Verify preview deployments

## 4. SEO & discoverability

- [x] Canonical URLs, sitemap integration, keyword-in-path
- [x] `og:image` + `og:url` meta wired in Base.astro
- [x] **(Blocker)** `robots.txt` pointing at the sitemap
- [ ] (Recommended) _(you)_ Register in Google + Bing Search Console; submit sitemap
- [ ] (Recommended) _(you)_ Validate structured data with the Rich Results test (`WebApplication` + `FAQPage` are in place)
- [x] (Recommended) Every page template has a unique title + description

## 5. Branding & assets

- [x] Visible wordmark (banner in Base.astro)
- [x] **(Blocker)** `public/og.png` 1200×630 (generated from `og.svg`; swap in designed art anytime with `npm run assets`)
- [x] (Recommended) App icons + web manifest + `theme-color` (apple-touch-icon, icon-192, icon-512, site.webmanifest)

## 6. Analytics & monitoring

- [ ] (Recommended) _(you)_ Cloudflare Web Analytics (cookieless, no consent banner) — dashboard toggle, no code
- [ ] (Nice-to-have) _(you)_ Uptime / deploy notifications

## 7. Performance

- [ ] (Recommended) _(QA)_ Lighthouse pass on the built output
- [ ] (Recommended) _(QA)_ Check the two `client:load` island bundles (WorldClock, TeamPlanner)
- [x] System-font stack (no web-font cost)

## 8. Accessibility

- [x] Contrast ≥ 4.5:1 measured across all three sky palettes
- [ ] (Recommended) _(QA)_ Keyboard + screen-reader pass (header link, skip-link, CityPicker combobox)
- [x] Reduced-motion handling

## 9. Cross-browser / device QA

- [ ] (Recommended) _(QA)_ Chrome / Firefox / Safari + iOS Safari (date input) + Android
- [ ] (Recommended) _(QA)_ Mobile layout of the TeamPlanner grid
- [ ] (Recommended) _(QA)_ DST edge cases against real upcoming transition dates (the headline feature)

## 10. Content, legal, trust

- [x] **(Blocker)** Custom 404 page
- [x] (Recommended) Privacy page (`/privacy`, linked in the footer) — stores nothing but `localStorage['sky-mode']`
- [x] (Recommended) Copy proofread; FAQ content reviewed

## 11. Launch ops

- [ ] (Recommended) _(you)_ Lower DNS TTL before cutover; smoke-test the live domain post-deploy
- [ ] (Recommended) _(you)_ Watch Search Console for indexing/coverage in the first weeks
