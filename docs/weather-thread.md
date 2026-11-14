# Weather Thread: decisions (M0)

Plan: "Weather Thread: Race-Day Weather + Coffee Climate Atlas" (Nov 13, 2026). This file records what was checked and
decided before building. Guardrails from the plan apply unchanged (public data only, coffee pages cover climate and
flavor only, no forecasting claims, no secrets, nothing stored server-side, attribution, informational only).

## Repo and stack (existing site, not migrated)

- Astro 7 + TypeScript, static output, pnpm, GitHub Pages via `.github/workflows/deploy.yml`.
- Charts: hand-built SVG, as on the Running and Forecast pages (no chart library).
- Units: the site defaults to imperial with a toggle (`data-units` on `<html>`, `unitschange` event). The new pages follow
  the site, not the plan's metric default.
- Tests: Vitest added (`pnpm test`), run in CI before the build.
- Commands use pnpm (`pnpm climate`, not `npm run climate`).
- `/coffee` is currently the latte art page. Bean log goes under it; layout to be settled with the owner at M3.

## Open-Meteo, checked 2026-11-14

| Need | Endpoint | Verified |
| --- | --- | --- |
| Forecast, ≤ 16 days | `api.open-meteo.com/v1/forecast` with `hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,precipitation_probability,cloud_cover`, `forecast_days=16`, `timezone=auto` | 200, 384 hourly steps |
| History | `archive-api.open-meteo.com/v1/archive` with `start_date`, `end_date`, `hourly=…` or `daily=temperature_2m_max,temperature_2m_min,precipitation_sum`, optional `elevation` | 200; `elevation=1800` is echoed back |
| Place search | `geocoding-api.open-meteo.com/v1/search?name=…&count=…` | 200 |

- Free tier: no key, non-commercial, CC BY 4.0 attribution; limits are per visitor IP (600/min, 5,000/h, 10,000/day).
- 20 years of hourly data in one request is ~6.7 MB, too heavy for a browser. Race climatology therefore makes one
  7-day request per year (20 small requests, 5 at a time), as the plan describes.
- The archive lags real time by about a week; climatology uses the latest year whose window is at least 10 days old.

## Method choices

- Race climatology: per-day means over the race hours (local time), then p10/p50/p90 across ~140 days
  (7 days × 20 years). A day counts as rainy at ≥ 0.2 mm during race hours.
- Normals: 1991–2020 daily values; temperature averaged by month, precipitation totalled per month then averaged.
- Dew point from humidity: Magnus formula (Alduchov & Eskridge 1996 coefficients).

## Owner answers so far

- Compliance: owner's call is that the site's hobby content is unrelated to work; plan guardrails still apply.
- Races: 2027 dates to be confirmed on each race's official site at M2; unconfirmed races are left out.
- Beans: Intelligentsia Black Cat, a Counter Culture coffee, a Stumptown coffee (green bag), plus one from London.
  Details come from the bags (photos from the owner). Blends list their origins; the climate card uses the main one
  and says so.
