import { Temple } from "@prisma/client";
import { prisma } from "../config/prisma";
import { GoogleTemple, googlePlaceDetails } from "./google.service";
import { findMatchingTemple, mergeTempleData, TempleFields } from "./templeMatcher.service";
import { DEITY_SEARCH_KEYWORDS } from "../data/deityTempleKeywords";

/** How long a Google search result set is reused before Google is asked again. */
const SEARCH_LOG_TTL_DAYS = 30;
/** How long fetched Google place details (phone, website, hours) are reused. */
const DETAILS_TTL_DAYS = 30;

// ── Search log: avoid repeating identical external searches ──

export async function hasRecentSearch(key: string): Promise<boolean> {
  const log = await prisma.templeSearchLog.findUnique({ where: { key } });
  return !!log && Date.now() - log.fetchedAt.getTime() < SEARCH_LOG_TTL_DAYS * 86400000;
}

export async function recordSearch(key: string, provider: string, resultCount: number) {
  await prisma.templeSearchLog.upsert({
    where: { key },
    create: { key, provider, resultCount },
    update: { provider, resultCount, fetchedAt: new Date() },
  });
}

// ── Address helpers ──

/** "Chilkur, Hyderabad, Telangana 501504, India" → { city: "Hyderabad", state: "Telangana" } */
export function cityStateFromAddress(address: string | null | undefined) {
  const parts = (address || "")
    .split(",")
    .map((s) => s.replace(/\b\d{6}\b/g, "").trim())
    .filter((s) => s && !/^india$/i.test(s));
  return {
    city: parts.length >= 2 ? parts[parts.length - 2] : null,
    state: parts.length >= 1 ? parts[parts.length - 1] : null,
  };
}

function deityFromName(name: string): string | null {
  const lower = ` ${name.toLowerCase()} `;
  for (const [deity, keywords] of Object.entries(DEITY_SEARCH_KEYWORDS)) {
    if (keywords.some((k) => k.length >= 3 && lower.includes(` ${k.toLowerCase()}`))) return deity;
  }
  return null;
}

// ── Save Google results ──

/**
 * Saves (or merges) a Google Places result into the temple table and returns the stored row.
 * An existing temple — e.g. one an admin uploaded — is matched and enriched instead of duplicated.
 */
export async function saveGoogleTemple(g: GoogleTemple): Promise<Temple> {
  const { city, state } = cityStateFromAddress(g.address);
  const fields: TempleFields = {
    name: g.name,
    address: g.address,
    city,
    state,
    lat: g.lat,
    lon: g.lon,
    rating: g.rating,
    reviewCount: g.reviewCount,
    googlePlaceId: g.placeId,
    deityName: deityFromName(g.name),
  };

  const existing = await findMatchingTemple({ name: g.name, city, address: g.address, lat: g.lat, lon: g.lon, googlePlaceId: g.placeId });
  if (existing) {
    // A different Google id already sits on another row: don't steal it.
    if (existing.googlePlaceId && existing.googlePlaceId !== g.placeId) delete fields.googlePlaceId;
    const data = mergeTempleData(existing, fields, "google");
    return Object.keys(data).length ? prisma.temple.update({ where: { id: existing.id }, data }) : existing;
  }

  return prisma.temple.create({
    data: {
      name: g.name,
      placeId: `google:${g.placeId}`,
      source: "google",
      address: fields.address,
      city: fields.city,
      state: fields.state,
      lat: fields.lat,
      lon: fields.lon,
      rating: fields.rating,
      reviewCount: fields.reviewCount,
      googlePlaceId: g.placeId,
      deityName: fields.deityName,
    },
  });
}

export async function saveGoogleTemples(results: GoogleTemple[]): Promise<Temple[]> {
  const saved: Temple[] = [];
  for (const g of results) {
    try {
      saved.push(await saveGoogleTemple(g));
    } catch (err: any) {
      console.error(`[TEMPLE_STORE] Could not save "${g.name}": ${err.message?.split("\n").pop()}`);
    }
  }
  return saved;
}

/**
 * Fetches Google place details (phone, website, opening hours) once per temple and caches them
 * on the row; later views are served from the DB without calling Google.
 */
export async function ensureGoogleDetails(temple: Temple): Promise<Temple> {
  if (!temple.googlePlaceId) return temple;
  const fresh = temple.detailsFetchedAt && Date.now() - temple.detailsFetchedAt.getTime() < DETAILS_TTL_DAYS * 86400000;
  if (fresh) return temple;

  try {
    const d = await googlePlaceDetails(temple.googlePlaceId);
    const fields: TempleFields = {
      phone: d.phone ?? null,
      website: d.website ?? null,
      rating: d.rating ?? null,
      reviewCount: d.reviewCount ?? null,
      openingHours: d.openingHours?.length ? JSON.stringify(d.openingHours) : null,
      address: d.address ?? null,
      lat: d.lat ?? null,
      lon: d.lon ?? null,
    };
    const data = mergeTempleData(temple, fields, "google");
    return await prisma.temple.update({ where: { id: temple.id }, data: { ...data, detailsFetchedAt: new Date() } });
  } catch (err: any) {
    console.error(`[TEMPLE_STORE] Details fetch failed for ${temple.name}: ${err.message}`);
    return temple;
  }
}
