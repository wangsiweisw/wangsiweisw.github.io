# Personal Website — Build Plan

This file is the spec for building my personal website. Read it fully before starting, then work **one phase at a time** (see §8).

## 0. Context

- **Purpose:** English-language personal site, primarily for overseas job searching.
- **Audience:** recruiters and hiring managers who skim in ~15 seconds, plus curious visitors who explore.
- **Design principle:** the scan path is clean and obvious (who I am → what I do → resume). Personality and interaction live one layer down (photos, coffee, running, small touches).
- **Me:** software engineer working on ML for weather forecasting and LLMs. Hobbies: running, latte art, photography.

### Placeholders (owner fills in; use these tokens until then)

| Token | Meaning |
|---|---|
| `{{NAME}}` | My full name — **Siwei Wang** (Chinese name 王思为 shown as a secondary line, no parentheses) |
| `{{DOMAIN}}` | **`siweiwang.me`** |
| `{{CITY}}`, `{{LAT}}`, `{{LON}}` | City shown in the weather card (TBD) |
| `{{LINKEDIN}}`, `{{EMAIL}}` | Contact links. LinkedIn: `https://www.linkedin.com/in/siwei-wang/`. Email TBD. **No GitHub link anywhere on the site.** |
| `{{R2_PUBLIC_HOST}}` | e.g. `img.example.com` |

Mark any placeholder content in code or content files with `TODO(owner)`.

## 1. Tech stack

- **Framework:** Astro (latest stable), TypeScript strict mode, pnpm.
- **Content:** Astro content collections (blog, coffee) with zod schemas; JSON/YAML data files for photos, runs, races, resume.
- **Styling:** plain CSS with custom properties as design tokens. No CSS framework.
- **Interactivity:** small islands in vanilla TS / Web Components. No React/Vue unless a component genuinely needs it (ask first).
- **Hosting:** GitHub Pages, deployed by GitHub Actions, custom domain via `CNAME`.
- **Images:** originals stay local (gitignored); resized variants live in Cloudflare R2 served from `{{R2_PUBLIC_HOST}}`. Never commit photo files to the repo.
- **Allowed dependencies:** `@astrojs/mdx`, `@astrojs/rss`, `@astrojs/sitemap`, `sharp`, `exifr`, `@aws-sdk/client-s3`, `yaml`, `leaflet` (+ `leaflet.markercluster`), `playwright` (dev only). Ask before adding anything else.

## 2. Site map

```
/                     Home
/resume               Web resume (+ /resume.pdf)
/photos               Gallery (grid + map view)
/coffee               Latte art log
/running              Running stats
/blog                 Post index
/blog/[slug]          Post
/blog/tags/[tag]      Tag listing
/rss.xml, /sitemap-index.xml, 404
```

## 3. Repo structure

```
.
├── PLAN.md
├── astro.config.mjs
├── public/               favicon, CNAME, resume.pdf (generated)
├── photos-src/           GITIGNORED: original photos + meta.yaml sidecar
├── scripts/
│   ├── photos-sync.ts    resize + strip metadata + upload to R2 + write manifest
│   ├── runs-sync.ts      Strava → src/data/runs.json
│   ├── runs-import.ts    Strava bulk-export CSV → same schema (fallback)
│   └── resume-pdf.ts     Playwright: render /resume → public/resume.pdf
├── src/
│   ├── components/       WeatherCard, Lightbox, CompareSlider, Heatmap, UnitToggle, ...
│   ├── content/
│   │   ├── blog/         *.mdx
│   │   └── coffee/       *.md
│   ├── data/
│   │   ├── photos.json   generated manifest (committed)
│   │   ├── runs.json     generated cache (committed)
│   │   ├── races.yaml    manual
│   │   ├── resume.yaml   single source for resume
│   │   └── site.yaml     name, bio, links, city, flags
│   ├── layouts/
│   ├── pages/
│   └── styles/           tokens.css, global.css, print.css
└── .github/workflows/deploy.yml
```

## 4. Global design & behavior

- **Visual direction:** ✅ picked **A · "Almanac"** — warm paper background, terracotta accent, Fraunces (display) + Instrument Sans (body). May be revisited later.
- **Theme:** light/dark following system by default, with a toggle; preference persisted in `localStorage` (wrapped in try/catch).
- **Units:** one global Metric/Imperial toggle (°C/°F, km/mi), default Imperial for a US audience, persisted like the theme. Used by the running page (and the weather card, wherever it ends up). Only shown on pages that use it.
- **Motion:** hover states, subtle transitions, Astro View Transitions between pages. Everything respects `prefers-reduced-motion`. No cursor trails, particle effects, or scroll-jacking.
- **Accessibility:** every interactive component is keyboard-operable with visible focus; `alt` text is required by schema for every image.
- **Performance targets:** Lighthouse ≥ 95 in all categories on Home, Photos, Blog post. Home page ships < 30 KB of JS. No layout shift from images (width/height always known).
- **SEO:** per-page title/description, Open Graph tags, sitemap, `robots.txt`.
- **Employer visibility:** `site.yaml` has `showEmployerOnHome: false`. The current employer appears only on the resume page unless that flag is flipped.

## 5. Page specs

### 5.1 Home

- **Hero:** `{{NAME}}`, one-line positioning, 2–3 sentence bio, buttons: Resume, LinkedIn, Email (no GitHub). All from `site.yaml`.
- **Weather card (signature piece) — ⏸ NOT on Home for now.** Owner will decide placement and caption later (see §9). Spec kept for when it lands:
  - Client-side fetch from Open-Meteo (no API key): current temperature + today and tomorrow high/low and weather code for `{{LAT}},{{LON}}`, `timezone=auto`.
  - Map WMO weather codes to a small icon set (inline SVG).
  - Caption from `site.yaml`, default: *"I build ML models that try to get this right."*
  - Skeleton while loading; cache response in `sessionStorage` for 30 min; on any error, hide the card entirely (never show a broken state).
- **Section teasers** (built at build time): latest photo, latest coffee pour, year-to-date running distance, latest blog post. Each links to its page.

### 5.2 Resume

- Single source: `src/data/resume.yaml`, validated with zod (experience, education, skills, selected projects, links).
- `/resume` renders it as a web page with a dedicated `print.css` (US Letter, fits 1–2 pages, no nav/footer, links shown as text).
- `scripts/resume-pdf.ts` uses Playwright to print the built page to `public/resume.pdf`. Runs in CI on every deploy so the PDF can never drift from the web version.

### 5.3 Photos

**Pipeline — `pnpm photos:sync`** (run locally, not in CI):
1. Read images in `photos-src/` plus optional `photos-src/meta.yaml` (per file: title, caption, album, location name, featured, `hide_location`).
2. Extract EXIF with `exifr`: camera, lens, focal length, aperture, shutter, ISO, capture date, GPS.
3. **Privacy:** round GPS to 2 decimal places (~1 km) and drop it entirely if `hide_location` is set. **Strip all metadata** from every output file.
4. With `sharp`, generate widths 480 / 960 / 1600 / 2400 in AVIF and WebP, plus a ~20 px blurred placeholder (base64).
5. Upload to R2 via the S3-compatible API using content-hash filenames and `Cache-Control: public, max-age=31536000, immutable`. Skip files whose hash already exists.
6. Merge results into `src/data/photos.json` (id, album, dimensions, srcset URLs, placeholder, EXIF, rounded coords, title, caption, date).

**Gallery page:**
- Justified grid using known aspect ratios; `<picture>` with AVIF/WebP `srcset`; lazy loading; blur-up placeholders.
- Album filter chips (albums include `coffee`, which the coffee page reuses).
- **Lightbox:** ←/→ to navigate, Esc to close, swipe on touch, preload neighbors, deep link via `#photo-<id>`. Press `i` (or hover on desktop) to toggle an EXIF panel.
- **Map view:** a Grid/Map toggle. Leaflet + OpenStreetMap tiles, loaded only when the map is first opened; clustered markers; clicking a marker opens the lightbox. Show required OSM attribution.

### 5.4 Coffee

- Collection `src/content/coffee/*.md`, frontmatter:
  `date`, `pattern` (heart | tulip | rosetta | swan | other), `beans`, `milk`, `result` (nailed | decent | wobbly | disaster), `photo` (id from `photos.json`), optional `before` (photo id of an earlier attempt), `note`.
- Page: grid view and timeline view toggle; filter by pattern; `result` shown as a playful badge.
- **CompareSlider component:** when `before` exists, show a before/after slider ("Week 1 vs now"). Draggable handle, arrow keys move it, works on touch.

### 5.5 Running

**Data — `pnpm runs:sync`** (runs in CI on every build):
- Refresh the Strava OAuth token using `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`; page through `/athlete/activities`; keep `sport_type` Run and TrailRun.
- Store only: id, local date, distance (m), moving time (s), elevation gain, sport type. **Never store or render activity names, polylines, maps, or start coordinates.**
- Write `src/data/runs.json`. If Strava fails for any reason, log a warning and build from the committed `runs.json`; the build must never fail because of Strava.
- If Strava returns a different refresh token than the one used, log a clear warning so I can update the secret.
- `scripts/runs-import.ts` converts a Strava bulk-export CSV into the same schema, as a fallback data source. **Before relying on the API, check that Strava's current API Agreement permits publicly displaying my own aggregated data; if not, use the CSV path only.**
- Races come from `src/data/races.yaml` (name, date, distance, finish time, optional link).

**Page:**
- Year-to-date and all-time totals (distance, runs, time).
- Last-365-days calendar heatmap rendered as SVG at build time, with an accessible tooltip on hover/focus.
- Monthly distance bar chart (build-time SVG).
- Races / PR table.
- Respects the global units toggle. "Powered by Strava" attribution when Strava data is shown.

### 5.6 Blog

- MDX collection, frontmatter: `title`, `description`, `date`, `updated?`, `tags`, `draft`, `cover?`.
- Index sorted by date; tag pages; post page with reading time, auto TOC for posts with ≥ 3 H2s, heading anchor links, prev/next links.
- Shiki code highlighting with dual light/dark themes.
- RSS with full content; drafts excluded from production builds.
- Seed with one placeholder post marked `draft: true`.

### 5.7 404

A short, playful page in the site's voice (e.g. "Forecast: 100% chance of a wrong URL.") with a link home.

## 6. CI/CD

`.github/workflows/deploy.yml`
- **Triggers:** push to `main`, daily cron (06:00 UTC, keeps running stats fresh), manual `workflow_dispatch`.
- **Steps:** checkout → setup pnpm/Node → install → `runs:sync` → `astro check` → build → `resume-pdf` → upload Pages artifact → `actions/deploy-pages`.
- **Secrets:** `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`. (R2 credentials are only needed locally for `photos:sync`; keep them in a gitignored `.env`.)
- Pull requests run `astro check` and build only, no deploy.

## 7. Phases

| Phase | Scope | Done when |
|---|---|---|
| 0 | Scaffold Astro project, tooling, base layout shell, deploy workflow, `CNAME` | Placeholder page is live at `https://{{DOMAIN}}` with HTTPS |
| 1 | Two visual directions → **stop for my pick** → tokens, typography, theme + units toggles, nav/footer | Chosen direction applied site-wide |
| 2 | Home (hero), Resume (web + PDF), Blog skeleton, 404 | **MVP shipped** — site is shareable |
| 3 | Photos pipeline, gallery, lightbox | I can add photos with one command |
| 4 | Coffee page + CompareSlider | |
| 5 | Running sync, CSV fallback, stats page, cron | Stats update daily without me |
| 6 | Photo map view, home teasers, OG images, Lighthouse pass | All targets in §4 met |

## 8. Working rules for Claude Code

- Work one phase at a time. At the end of each phase: run `pnpm astro check && pnpm build`, summarize what changed and anything I need to do, then **stop and wait for review**.
- Ask before adding dependencies not listed in §1.
- Never commit secrets, `.env`, or anything in `photos-src/`.
- Prefer build-time rendering; add client JS only where there is real interaction.
- Keep components small and documented with a one-line comment on purpose.

## 9. Owner to-do

- [x] Buy domain (`siweiwang.me`, Cloudflare)
- [ ] Point DNS to GitHub Pages and verify the domain in GitHub account settings
- [ ] Decide where the weather card lives (not Home) and rewrite its caption (current draft: "I build ML models that try to get this right.")
- [ ] Set up `hi@siweiwang.me` via Cloudflare Email Routing (forwarding), then fill `{{EMAIL}}` — needed before the Email button in Phase 2
- [ ] Create R2 bucket, API token, and connect `{{R2_PUBLIC_HOST}}`
- [ ] Create a Strava API app and obtain a refresh token (`activity:read_all` scope if private runs should count toward totals)
- [ ] Write bio, positioning line, and `resume.yaml` content
- [ ] Pick photos and coffee shots; fill in `meta.yaml`
