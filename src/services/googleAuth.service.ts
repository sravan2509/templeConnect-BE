import { OAuth2Client } from "google-auth-library";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { env } from "../config/env";
import { issueSession } from "./auth.service";

export interface GoogleIdentity {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>;

const client = new OAuth2Client();

/**
 * Verifies a Google ID token's signature, expiry, issuer and audience (must be one of our
 * OAuth client IDs). Never trust the app's claims about who the user is without this.
 */
export const verifyGoogleIdToken: GoogleVerifier = async (idToken) => {
  if (env.googleClientIds.length === 0) {
    throw new AppError("Google sign-in is not configured on the server", 503);
  }
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientIds });
    payload = ticket.getPayload();
  } catch {
    throw new AppError("Google sign-in failed. Please try again.", 401);
  }
  if (!payload?.sub || !payload.email) throw new AppError("Google account has no email address", 401);
  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
  };
};

/**
 * "Continue with Google": signs in an existing account or creates a new one.
 *  1. Account already linked to this Google ID → sign in.
 *  2. Account with the same (Google-verified) email → link Google to it and sign in.
 *  3. Otherwise → create a new devotee account.
 */
export async function continueWithGoogle(idToken: string, verify: GoogleVerifier = verifyGoogleIdToken) {
  const identity = await verify(idToken);
  // Only link or create accounts for emails Google has verified the user owns.
  if (!identity.emailVerified) throw new AppError("Please verify your Google account's email address first", 401);

  let user = await prisma.user.findUnique({ where: { googleId: identity.googleId } });
  let isNewUser = false;

  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });
    if (byEmail) {
      if (byEmail.googleId && byEmail.googleId !== identity.googleId) {
        throw new AppError("This email is already linked to a different Google account", 409);
      }
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId: identity.googleId, avatarUrl: byEmail.avatarUrl ?? identity.picture },
      });
      console.log(`[AUTH] Linked Google to existing account ${user.id}`);
    } else {
      user = await prisma.user.create({
        data: {
          name: (identity.name || identity.email.split("@")[0]).slice(0, 100),
          email: identity.email,
          googleId: identity.googleId,
          avatarUrl: identity.picture,
          passwordHash: null,
        },
      });
      isNewUser = true;
      console.log(`[AUTH] Registered via Google ${user.id}`);
    }
  }

  return { ...issueSession(user), isNewUser };
}
