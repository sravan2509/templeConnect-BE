import { prisma } from "../config/prisma";
import { haversineDistance } from "../utils/haversine";
import { notifyRecipients, Recipient } from "./push.service";

/**
 * Who should hear about something a temple published.
 *  - seva:         followers of the temple who want Seva updates
 *  - event:        followers who want event updates, plus the local community
 *  - announcement: followers who want announcements, plus (optionally) the local community
 * The local community = devotees who picked the place's town as one of their areas, or whose saved
 * home location is within their chosen radius of the place.
 */
export type AudienceKind = "seva" | "event" | "announcement";

export interface Place {
  city?: string | null;
  state?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface AudienceOptions {
  templeId: string;
  kind: AudienceKind;
  place: Place;
  /** Include the local community (non-followers). Defaults to true for events. */
  includeCommunity?: boolean;
  /** Include followers. Defaults to true. */
  includeFollowers?: boolean;
  /** Users never notified (e.g. whoever made the change). */
  excludeUserIds?: string[];
}

const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();

/** Users whose selected areas or home radius cover the place. */
export async function communityUserIds(place: Place): Promise<string[]> {
  const ids = new Set<string>();

  const city = norm(place.city);
  if (city) {
    const areas = await prisma.communityArea.findMany({ select: { userId: true, city: true, state: true } });
    const state = norm(place.state);
    for (const a of areas) {
      if (norm(a.city) !== city) continue;
      // An area saved without a state matches the town in any state.
      if (a.state && state && norm(a.state) !== state) continue;
      ids.add(a.userId);
    }
  }

  if (place.lat != null && place.lon != null) {
    const nearby = await prisma.user.findMany({
      where: { homeLat: { not: null }, homeLon: { not: null }, communityRadiusKm: { gt: 0 } },
      select: { id: true, homeLat: true, homeLon: true, communityRadiusKm: true },
    });
    for (const u of nearby) {
      if (haversineDistance(place.lat, place.lon, u.homeLat!, u.homeLon!) <= u.communityRadiusKm!) ids.add(u.id);
    }
  }
  return [...ids];
}

export async function resolveAudience(opts: AudienceOptions): Promise<Recipient[]> {
  const includeFollowers = opts.includeFollowers ?? true;
  const includeCommunity = opts.includeCommunity ?? opts.kind === "event";
  const recipients = new Map<string, string>();

  if (includeFollowers) {
    const flag = opts.kind === "seva" ? "notifySevas" : opts.kind === "event" ? "notifyEvents" : "notifyAnnouncements";
    const followers = await prisma.templeFollow.findMany({ where: { templeId: opts.templeId, [flag]: true }, select: { userId: true } });
    const type = opts.kind === "seva" ? "seva_update" : opts.kind === "event" ? "temple_event" : "temple_announcement";
    for (const f of followers) recipients.set(f.userId, type);
  }

  if (includeCommunity && opts.kind !== "seva") {
    // Followers who muted this temple's events/announcements are not re-added through their area.
    const muted = new Set(
      (await prisma.templeFollow.findMany({
        where: { templeId: opts.templeId, ...(opts.kind === "event" ? { notifyEvents: false } : { notifyAnnouncements: false }) },
        select: { userId: true },
      })).map((f) => f.userId)
    );
    for (const id of await communityUserIds(opts.place)) {
      if (!recipients.has(id) && !muted.has(id)) recipients.set(id, opts.kind === "event" ? "community_event" : "temple_announcement");
    }
  }

  const exclude = new Set(opts.excludeUserIds ?? []);
  return [...recipients.entries()].filter(([id]) => !exclude.has(id)).map(([userId, type]) => ({ userId, type }));
}

/** Resolves the audience and notifies it. Returns { targeted, notified }. Never throws. */
export async function notifyAudience(opts: AudienceOptions, title: string, body: string, data: Record<string, string> = {}) {
  try {
    const recipients = await resolveAudience(opts);
    const notified = await notifyRecipients(recipients, title, body, { templeId: opts.templeId, ...data });
    return { targeted: recipients.length, notified };
  } catch (err: any) {
    console.error(`[AUDIENCE] Failed to notify (${opts.kind}, temple ${opts.templeId}): ${err.message}`);
    return { targeted: 0, notified: 0 };
  }
}
