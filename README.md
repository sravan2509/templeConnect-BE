# Temple Connect — Backend

Node.js/Express/TypeScript API for the Temple Connect app: user accounts, geocoding, nearby temple search, and birth-chart (nakshatra/rashi) lookup.

## Stack

- Express + TypeScript
- PostgreSQL via Prisma
- JWT auth (bcrypt password hashing)
- External APIs: Nominatim (geocoding), Google Places (temple search), Swiss Ephemeris (astrology)

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, GOOGLE_PLACES_API_KEY
npx prisma migrate dev --name init
npm run dev
```

Server runs on `http://localhost:4000` by default.

## Environment variables

See `.env.example`. Notes:

- `GOOGLE_PLACES_API_KEY` — required for `/api/locations/temples`. Get one from the Google Cloud Console (enable the Places API).
- `SWISS_EPHEMERIS_BASE_URL` — points at a Swiss Ephemeris microservice you host/run yourself (this repo does not embed the ephemeris calculation, since it typically runs as a separate Python/C service). Expected contract:
  - `POST {SWISS_EPHEMERIS_BASE_URL}/calculate` with `{ dob, time, lat, lon }` → `{ nakshatra, rashi }`
- `NOMINATIM_USER_AGENT` — Nominatim's usage policy requires a real identifying User-Agent; set it to your app name + contact.

## API

### Auth

- `POST /api/auth/register` — `{ name, email, password }` → `{ token, user }`
- `POST /api/auth/login` — `{ email, password }` → `{ token, user }`

### Locations

- `GET /api/locations/geocode?place=Hyderabad,India` → `{ lat, lon, displayName }`
- `GET /api/locations/temples?query=Krishna Temple near Munich` → `[{ name, rating, address, placeId, location }]`

### Astrology (requires `Authorization: Bearer <token>`)

- `POST /api/astrology/birth-chart` — `{ dob, time, place }` → saves and returns `{ nakshatra, rashi, ... }`
- `GET /api/astrology/birth-chart` → the signed-in user's saved birth chart

## Project structure

```
src/
  config/       env + prisma client
  controllers/  request handlers
  services/     business logic + external API calls
  routes/       Express routers
  middleware/   auth, error handling
  utils/        AppError, catchAsync, jwt
prisma/
  schema.prisma
```

## Next steps

- Wire routes to the Figma screens once flows are confirmed (temple detail page, saved/favorite temples, profile).
- Add a persistent `Temple` table if you want to cache Google Places results instead of calling live each time.
- Add tests (Jest/Supertest) for auth and the astrology flow.
