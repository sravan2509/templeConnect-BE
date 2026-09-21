import dotenv from "dotenv";

dotenv.config();

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/temple_connect?schema=public",
  jwtSecret: optional("JWT_SECRET", "temple-connect-dev-secret-change-in-production"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "365d",
  nominatimBaseUrl: optional("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org"),
  nominatimUserAgent: optional("NOMINATIM_USER_AGENT", "temple-connect-app (contact@example.com)"),
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  swissEphemerisBaseUrl: process.env.SWISS_EPHEMERIS_BASE_URL ?? "",
};
