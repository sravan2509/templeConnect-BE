import { Response } from "express";
import { parse } from "csv-parse/sync";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { googleTextSearch, isGoogleEnabled } from "../services/google.service";
import { clearTempleCache } from "../services/temple.service";
import { safeWebsite, templePlaceId } from "./templeUpload.controller";
import { findMatchingTemple, mergeTempleData } from "../services/templeMatcher.service";

const MAX_ROWS = 2000;

function parseCSV(text: string): Record<string, string>[] {
  try {
    return parse(text, {
      columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });
  } catch (err: any) {
    throw new AppError(`Could not parse CSV: ${err.message}`, 400);
  }
}

function num(value: string | undefined, max: number): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

function extractTempleFields(row: Record<string, string>) {
  return {
    name: row.name || row.temple_name || row.templename || row["temple name"] || "",
    city: row.city || row.place || row.location || "",
    state: row.state || "",
    deity: row.deity || row.deity_name || row.god || "",
    address: row.address || row.full_address || "",
    lat: num(row.lat || row.latitude, 90),
    lon: num(row.lon || row.lng || row.longitude, 180),
    phone: row.phone || row.contact || row.contact_details || "",
    website: safeWebsite(row.website || row.website_link || row.site) ?? "",
    history: row.history || row.temple_history || row.description || "",
    significance: row.significance || row.speciality || "",
    sevas: row.sevas || row.pujas || row.services || "",
  };
}

export const importTemplesCSV = catchAsync(async (req: AuthRequest, res: Response) => {
  const { csv, rows: jsonRows } = req.body as { csv?: unknown; rows?: unknown };

  let records: Record<string, string>[];
  if (typeof csv === "string" && csv.trim()) {
    records = parseCSV(csv);
  } else if (Array.isArray(jsonRows)) {
    records = jsonRows.map((r) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k.toLowerCase(), String(v ?? "").trim()])));
  } else {
    throw new AppError("Provide either csv (string) or rows (array of objects)", 400);
  }
  if (records.length === 0) throw new AppError("No rows found in upload", 400);
  if (records.length > MAX_ROWS) throw new AppError(`Please import at most ${MAX_ROWS} rows at a time`, 400);

  let created = 0, merged = 0, skipped = 0, googleEnriched = 0;
  const imported: any[] = [];

  for (const raw of records) {
    const f = extractTempleFields(raw);
    if (!f.name || !f.city) { skipped++; continue; }

    // Same temple already stored (uploaded, imported, or saved from a Google search)? Merge into it:
    // imported values win, blank cells leave stored values untouched.
    const matchInput = () => ({ name: f.name, city: f.city, address: f.address, lat: f.lat, lon: f.lon, placeId: templePlaceId(f.name, f.city) });
    let existing = await findMatchingTemple(matchInput());

    // Look up coordinates on Google only when neither the row nor the stored temple has them.
    if ((f.lat === null || f.lon === null) && existing?.lat == null && isGoogleEnabled()) {
      try {
        const [best] = await googleTextSearch(`${f.name} ${f.city}`);
        if (best?.lat != null && best?.lon != null) {
          f.lat ??= best.lat;
          f.lon ??= best.lon;
          googleEnriched++;
          existing ??= await findMatchingTemple(matchInput());
        }
      } catch {}
    }

    if (existing) {
      const fields = {
        name: f.name, city: f.city, state: f.state || null, deityName: f.deity || null, address: f.address || null,
        lat: f.lat, lon: f.lon, contactDetails: f.phone || null, websiteLink: f.website || null,
        templeHistory: f.history || null, significance: f.significance || null, sevas: f.sevas || null,
      };
      await prisma.temple.update({ where: { id: existing.id }, data: { ...mergeTempleData(existing, fields, "import"), source: existing.source === "upload" || existing.source === "admin" ? existing.source : "import" } });
      merged++;
      imported.push({ name: f.name, city: f.city, status: "merged", into: existing.name, id: existing.id });
    } else {
      const row = await prisma.temple.create({
        data: {
          name: f.name, placeId: templePlaceId(f.name, f.city), source: "import",
          deityName: f.deity || null, address: f.address || null, city: f.city, state: f.state || null,
          lat: f.lat, lon: f.lon, contactDetails: f.phone || null, websiteLink: f.website || null,
          templeHistory: f.history || null, significance: f.significance || null, sevas: f.sevas || null,
        },
      });
      created++;
      imported.push({ name: f.name, city: f.city, status: "created", id: row.id });
    }
  }

  clearTempleCache();
  res.status(200).json({ success: true, created, merged, skipped, googleEnriched, imported });
});
