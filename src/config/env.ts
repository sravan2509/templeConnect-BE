import dotenv from "dotenv";

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (isProduction) {
    throw new Error("JWT_SECRET must be set to a random string of at least 32 characters in production");
  }
  console.warn("[ENV] JWT_SECRET is missing or shorter than 32 chars — using an insecure development secret");
  return secret || "temple-connect-dev-secret-change-in-production";
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  isProduction,
  jwtSecret: jwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  // Number of proxy hops to trust (e.g. 1 behind nginx / a load balancer). 0 = not behind a proxy.
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  // Comma-separated list of allowed browser origins. Empty = allow all (mobile apps send no Origin).
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  // Only for local development: include the password-reset code in the API response.
  exposeResetCode: !isProduction && process.env.DEV_EXPOSE_RESET_CODE === "true",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "Temple Connect <no-reply@templeconnect.app>",
  },
  nominatimBaseUrl: optional("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org"),
  nominatimUserAgent: optional("NOMINATIM_USER_AGENT", "temple-connect-app (contact@example.com)"),
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
  // OAuth client IDs (web, Android, iOS) whose Google ID tokens we accept for "Continue with Google".
  googleClientIds: (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? "").split(",").map((c) => c.trim()).filter(Boolean),
  // Base URL devices use to reach this API (checkout page, locally stored uploads). No trailing slash.
  publicApiUrl: (process.env.PUBLIC_API_URL ?? "").replace(/\/+$/, ""),
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  },
  // When unset, payments are simulated so the full flow still works in development (never in production).
  allowSimulatedPayments: !isProduction && process.env.ALLOW_SIMULATED_PAYMENTS !== "false",
  s3: {
    region: process.env.AWS_REGION ?? "",
    bucket: process.env.S3_BUCKET ?? "",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
    // Public URL prefix for objects, e.g. a CloudFront domain. Defaults to the bucket's S3 URL.
    publicBaseUrl: (process.env.S3_PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
    prefix: (process.env.S3_KEY_PREFIX ?? "uploads").replace(/^\/+|\/+$/g, ""),
  },
};
