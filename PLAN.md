# Personal Website — Build Plan

This file is the spec for building my personal website. Read it fully before starting, then work **one phase at a time** (see §8).

## 0. Context

- **Purpose:** English-language personal site — mainly a personal showcase (work, photography, hobbies), not a recruiting page. (Owner decision, updated.)
- **Audience:** anyone curious — friends, peers, and the occasional recruiter. Don't tailor wording specifically for hiring.
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
/forecast             Forecast lab (+ forecast card, §5.8)
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
1. Read images anywhere under `photos-src/` (one folder per place; the folder name is the default album) plus optional `photos-src/meta.yaml` keyed by relative path (per file: title, **alt**, caption, album, location name, featured, `hide_location`).
2. Extract EXIF with `exifr`: camera, lens, focal length, aperture, shutter, ISO, capture date, GPS.
3. **Privacy:** round GPS to 2 decimal places (~1 km) and drop it entirely if `hide_location` is set. **Strip all metadata** from every output file.
4. With `sharp`, generate widths 480 / 720 / 960 / 1600 / 2400 (720 added after the Lighthouse pass, for phones) in AVIF and WebP, plus a ~20 px blurred placeholder (base64).
5. Upload to R2 via the S3-compatible API using content-hash filenames and `Cache-Control: public, max-age=31536000, immutable`. Skip files whose hash already exists.
6. Merge results into `src/data/photos.json` (id, album, dimensions, srcset URLs, placeholder, EXIF, rounded coords, title, caption, date).

**Gallery (owner decision: organised by place):**
- `/photos`: one card per album (place) — cover, title, subtitle, date range, count. Order, titles and covers in `src/data/albums.yaml`; albums not listed there (e.g. `coffee`) never appear in the gallery. Current albums: London, Yangshuo, Beijing, Night Sky.
- `/photos/[album]`: justified grid using known aspect ratios; `<picture>` with AVIF/WebP `srcset`; lazy loading; blur-up placeholders; prev/next album links.
- Latte art is **not** photography: it lives only on `/coffee` (§5.4), never in the gallery.
- **Lightbox:** ←/→ to navigate, Esc to close, swipe on touch, preload neighbors, deep link via `#photo-<id>`. Press `i` (or hover on desktop) to toggle an EXIF panel.
- **Map view:** a Grid/Map toggle. Note: the current photos carry no GPS, so markers will need per-album coordinates (e.g. in `albums.yaml`). Leaflet + OpenStreetMap tiles, loaded only when the map is first opened; clustered markers; clicking a marker opens the lightbox. Show required OSM attribution.

### 5.4 Coffee

- Collection `src/content/coffee/*.md`, frontmatter:
  `date`, `pattern` (heart | tulip | rosetta | swan | other), `beans`, `milk`, `result` (nailed | decent | wobbly | disaster), `photo` (id from `photos.json`), optional `before` (photo id of an earlier attempt), `note`.
- Page: grid view and timeline view toggle; filter by pattern; `result` shown as a playful badge.
- ~~CompareSlider~~ — dropped (owner decision). Instead, a short, modest intro: latte art is a weekend simple pleasure.
- Coffee photos live in `photos-src/coffee/`; their location is always dropped (taken at home).

### 5.5 Running

> ✅ **Built (owner decisions):** data from a manual Strava bulk export (`strava-export/`, gitignored) → `pnpm running:stats` → `src/data/running.json` (totals only). Hand-kept facts (half PB, Strava Best Efforts, month-only milestones, no race names) in `src/data/running.yaml`. Page: modest intro, totals, best times, milestones, yearly bar chart, two NYC Half photos with the bib covered by cat stickers. No cron. The original plan below is kept for reference.
>
> ~~On hold.~~ No automatic daily pushes. Data source still to decide: Strava bulk-export CSV (runs sync to Strava from Apple Watch) or Apple Health export — both manual, run locally. Strava API is out: its API Agreement (eff. 2026-06-01) only allows showing a user's data to that same user. Revisit before starting Phase 5.

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

### 5.8 Forecast lab (`/forecast`)

> ✅ **Built:** city chips (`src/data/forecast-cities.json`), 15-day ensemble plumes from AIFS ENS, IFS ENS and GEFS, a region map from precomputed `public/fx/` (CI every 6 h, `scripts/forecast-data/build.py`), and "How did the models do?" scored against ERA5. All forecast data is fetched client-side from Open-Meteo.

**Forecast card (Phase 7, ✅ built on branch `forecast-card`).** Code in `src/lib/forecast-card/` (stats, fetch, text, render, export; tests alongside) and `src/components/ForecastCard.astro`. Pick any place (search or map click) and optionally a date → a shareable card with a general forecast and how accurate forecasts have been at that spot. Modeled on three hand-made cards (Sequoia trip, Thanksgiving skiing in Maine/Vermont, Seattle on a date 15 days out).

- **Where it runs:** entirely in the visitor's browser; the site stays static on GitHub Pages. No server, no API keys, $0. Open-Meteo's free non-commercial tier limits by IP (600/min, 5,000/h, 10,000/day), so each visitor spends their own quota. Don't proxy through a server: one shared IP hits 429s (seen from the cloud sandbox).
- **Input:**
  - A search box in the lab (Open-Meteo Geocoding API). It only matches names written in Latin script, so it asks for English.
  - Or a city chip, or a click on the map.
  - A date, or a range of up to 14 days, from today to +32 days (GEFS runs 35 days, but the newest run's last full day is about 32 out). "Today" is the place's own date, taken from the forecast response (`timezone=auto`), so a place already into tomorrow doesn't show an empty first day.
  - A range shows its own tiles: chance of at least one wet day, how many wet days (members followed day by day), the spread of highs and lows. Normals come from the same dates in each past year.
  - Share link: `/forecast/?lat=&lon=&name=&detail=&date=&lang=#card`.
- **Cost.** Open-Meteo limits each IP by request *cost* (600/min, 10,000/day). Cost grows with days × variables, so a request for 30 years of daily data alone costs ~313. That is what blanked the normals and scores on the first live test.
  - Budget: about 100 per card. Normals and scores are cached in `localStorage` for 30 and 3 days.
  - On a per-minute 429, wait 20 s and retry once; the daily limit isn't retried.
  - The forecast is drawn first (~1 s); normals and scores fill in.
  - A failed load says so ("couldn't load… try again in a minute"), separately from "not enough data".
- **Data per card** (~35 small requests in parallel, about 1–3 s):
  - Ensembles: `ecmwf_aifs025` and `ecmwf_ifs025` (51 members each, 15 days) and `gfs025` (31, 10 days). For targets past 15 days, add `gfs05` (31, 35 days) and `gem_global` (21, 16 days).
  - History, **by season, not "the last N days"**: `previous-runs-api` for `ecmwf_aifs025_single`, `ecmwf_ifs025` and `gfs_seamless`, hourly precipitation and temperature at leads 1, 2, 3, 5 and 7 days. Fetch only the target date ±6 weeks in every past year the archive holds, plus this year's days up to ERA5's lag.
    - Coverage: IFS and GFS go back to early 2024 (two full seasons now), AIFS to Feb 2025 (one).
    - The archive gains a season each year with no code change.
    - One request per model per season. Truth is ERA5 (`archive-api`, about 5 days behind), fetched for the same windows.
    - Measured for Seattle around Dec 9: 12 requests, ~1 s each in parallel, 1.2 MB raw / 155 KB gzipped, 191 scored days (106 for AIFS). The last 12 months would be 3.4 MB for 175 days spread over every season.
  - Normals: the last 20 years of ERA5 daily data, one small request per year covering just the shown days ±7. Total cost ≈ 16, against 313 for one 30-year request.
- **Card contents** (general, not tied to an activity):
  - Headline and a short verdict built from rules and templates. No LLM.
  - Per day: chance of ≥1 mm precipitation; chance of ≥1 cm snow (row shown only if any member snows); median high/low with a 10–90% band.
  - Rows per model, plus a climatology row when the target is more than 7 days out.
  - Accuracy at this spot, by lead (1–7 days): "said dry → stayed dry", "said wet → was wet", and daily-high error.
  - Draw a "just guess" line: the wet-day rate in the same scored days. It's the baseline for "said wet → was wet" only, so draw it in that line's color.
  - Scored on the same-season windows only. In Seattle the rate is 64% for late Oct–mid Jan against 55% for Nov–Apr, so a whole-year or whole-winter base would mislead.
  - Past 7 days: say plainly it can't be back-tested (the archive stores leads of 1–7 days only) and compare with climatology instead.
  - Footer: sources, the ERA5 caveat (≈25 km grid, not a station), Open-Meteo attribution.
- **Language:** English by default, with a 中文 toggle on the card. The rest of the site stays English.
- **Export:** the card is one SVG, used on the page and for "Save image", so the two always match. Text is wrapped with canvas `measureText`.
  - To save, the site's fonts are inlined as data URIs, then the SVG is drawn to a canvas at 3× and saved as a PNG. No new dependency.
  - Chinese uses system fonts. Phones get the share sheet (Web Share API with files); desktops download the file.
- **Not in v1:**
  - Per-location link previews. These need a Cloudflare Worker, about $5/mo for image rendering.
  - Verdicts written by an LLM.
  - Activity modes, e.g. skiing (wet-bulb snowmaking hours) or hiking.
  - Saving cards on a server.
- **Done when:** a card for any searched place renders in under 3 s on a phone, the PNG matches the on-screen card, both languages work, and `pnpm astro check && pnpm build` pass.

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
| 5 | ✅ Running page from a manual Strava export (no API, no cron) | Done |
| 6 | Photo map view, home teasers, OG images, Lighthouse pass | All targets in §4 met |
| 7 | Forecast card on `/forecast` (§5.8): any place or date → forecast + local accuracy, PNG export, EN/中文 | Done-when list in §5.8 met |

## 8. Working rules for Claude Code

- Work one phase at a time. At the end of each phase: run `pnpm astro check && pnpm build`, summarize what changed and anything I need to do, then **stop and wait for review**.
- Ask before adding dependencies not listed in §1.
- Never commit secrets, `.env`, or anything in `photos-src/`.
- Prefer build-time rendering; add client JS only where there is real interaction.
- Keep components small and documented with a one-line comment on purpose.

## 9. Owner to-do

- [x] Buy domain (`siweiwang.me`, Cloudflare)
- [x] Point DNS to GitHub Pages (custom domain live)
- [ ] Verify `siweiwang.me` in GitHub account settings (Settings → Pages → Add a domain) — anti-takeover, optional
- [ ] Decide where the weather card lives (not Home) and rewrite its caption (current draft: "I build ML models that try to get this right.")
- [ ] Set up `hi@siweiwang.me` via Cloudflare Email Routing (forwarding), then fill `{{EMAIL}}` — needed before the Email button in Phase 2
- [ ] Create R2 bucket, API token, and connect `{{R2_PUBLIC_HOST}}`
- [ ] ~~Create a Strava API app~~ — not needed (Strava API ruled out, see §5.5)
- [x] Positioning line
- [x] Bio
- [ ] Real `resume.yaml` content (currently sample; set `sample: false`)
- [ ] Publish the first blog post, then flip Blog `live` in `src/data/nav.ts` and drop the `/blog` sitemap filter
- [ ] Pick photos and coffee shots; fill in `meta.yaml`
