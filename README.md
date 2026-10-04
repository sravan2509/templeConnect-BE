# Temple Connect — Backend

Node.js/Express/TypeScript API for the Temple Connect app: accounts, temple search and details, Vedic birth-chart (nakshatra/rashi) calculation, puja bookings with priests, chat, notifications and an admin console.

## Stack

- Express + TypeScript
- SQLite via Prisma (`DATABASE_URL`)
- JWT auth (bcrypt password hashing, sessions revoked on password change)
- Astronomy: `astronomy-engine` (geocentric Moon, Lahiri ayanamsa, birthplace timezone via `tz-lookup`)
- External APIs: Nominatim (geocoding, rate-limited to 1 req/s), Google Places (optional), Expo Push

## Setup

```bash
npm install
cp .env.example .env   # set JWT_SECRET (32+ chars); optionally SMTP_* and GOOGLE_MAPS_API_KEY
npm run db:push        # create/update the SQLite schema
npm run seed           # demo data (development only)
npm run dev
```

Server runs on `http://localhost:4000` by default. Run `npm run typecheck` before committing.

Demo accounts created by the seed (development only — never seed production): `admin@templeconnect.com / admin123`, priests `*@temple.com / priest123`, devotees `*@example.com / dev123`.

## Environment variables

See `.env.example`. Notes:

- `JWT_SECRET` — required (32+ characters) when `NODE_ENV=production`; the server refuses to start without it.
- `SMTP_*` — used to email password-reset codes. Without `SMTP_HOST`, codes are printed to the server console in development. `DEV_EXPOSE_RESET_CODE=true` (development only) also returns the code in the API response for testing.
- `GOOGLE_MAPS_API_KEY` — optional; enables Google Places results for search, nearby temples and temple details.
- `NOMINATIM_USER_AGENT` — Nominatim's usage policy requires a real identifying User-Agent with contact details.
- `CORS_ORIGINS` — comma-separated browser origins; leave empty for mobile-only use.

## API overview

All routes are under `/api`. Unless noted, routes require `Authorization: Bearer <token>`.

- **Auth** (`/auth`, public, rate-limited): `register`, `login`, `forgot-password`, `reset-password`; `change-password` (auth) returns a fresh token.
- **Users** (`/users/me`): profile (`GET`/`PATCH`), `DELETE` with `{ password }`, notification preferences, bookmarks, check-ins, booking history.
- **Temples** (`/temples`, public): `/:placeId` details (only real data — unknown fields are `null`), `/nearby?lat&lng&deity&radiusKm`, `/nearby-events`, reminders (auth). Text search: `GET /locations/temples?query=shiva temples in chennai`.
- **Astrology** (`/astrology`): `birth-chart` (`POST`/`GET`), `astro-profile`, `forecast`, `recommendations`. Birth time is interpreted in the birthplace's local timezone.
- **Bookings** (`/bookings`): create → priest accepts (`/admin/bookings/:id/accept`) → devotee pays (`/:id/pay`) → priest marks complete after the puja (`/admin/bookings/:id/complete`) → devotee reviews (`POST /priests/:id/reviews`). Reschedule returns the booking to `pending`; confirmed bookings can be cancelled up to 24 h before.
- **Chat** (`/chat`): `GET /chat/users`, `GET|POST /chat/:userId`, `PATCH /chat/:userId/read`. Only users who share a booking can chat. WebSocket: `ws://host/ws?token=<JWT>`.
- **Admin** (`/admin`, role-checked per route): dashboard, pujas, priests, knowledge base, FAQs, daily suggestions, temple upload/import/edit, temple events and pujas.

## Temple data: search, Google caching and merging

- **Search is database-first.** `GET /locations/temples` searches stored temples (uploaded, imported, admin-edited, and previously saved Google results) plus the built-in famous-temples list.
- **Google is a fallback, called at most once per query.** Google Places is called only when the DB has fewer than 5 matches, no stored temple's name already contains every word of the query, and the same query hasn't been sent to Google in the last 30 days (`TempleSearchLog`). Results are saved as `source = "google"` with their `googlePlaceId`, so later searches are answered from the DB. Nearby search works the same way per area.
- **Place details are cached.** Phone, website, rating and opening hours are fetched from Google the first time a temple's detail page is opened, stored on the row, and refreshed after 30 days.
- **Uploads and imports merge instead of duplicating.** Each Excel/CSV row is matched to an existing temple by Google id/placeId, then by location (within 400 m, tolerant of spelling variants like "Ramalingeswara"/"Rama Lingeshwara"), then by same city + similar name, then by identical name. Uploaded values overwrite stored values, blank cells never erase data, and Google-only data (rating, hours, Google id) is kept. Generic names such as "Durga Temple" are not merged into "Kanaka Durga Temple" unless the two are at the same location. The upload response lists which rows were created and which were merged into which temple.
- **Tip:** include Latitude/Longitude in uploads — location is the most reliable way to match a temple that was saved from Google under a slightly different name.

## Known gaps

- **Payments are simulated.** `POST /bookings/:id/pay` records a `SIMULATED-…` payment id, subscriptions are recorded without charging, and online donations return `501`. Integrate a payment gateway (e.g. Razorpay) with server-side signature verification before launch.
- `india-states-districts` bundles an old copy of `npm`, which `npm audit` reports; it is never executed by this app.

## Project structure

```
src/
  config/       env, prisma client, seed
  controllers/  request handlers
  services/     business logic + external API calls
  routes/       Express routers
  middleware/   auth, roles, error handling
  data/         static datasets (nakshatras, rashis, famous temples, starter content)
  utils/        AppError, catchAsync, jwt, timezone, ayanamsa
prisma/
  schema.prisma
```
