import { Response } from "express";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/prisma";
import { googleTextSearch, isGoogleEnabled } from "../services/google.service";

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

function extractTempleFields(row: Record<string, string>) {
  return {
    name: row.name || row.temple_name || row.templename || row["temple name"] || "",
    city: row.city || row.place || row.location || "",
    state: row.state || "",
    deity: row.deity || row.deity_name || row.god || "",
    address: row.address || row.full_address || "",
    lat: parseFloat(row.lat || row.latitude || "NaN") || null,
    lon: parseFloat(row.lon || row.lng || row.longitude || "NaN") || null,
    phone: row.phone || row.contact || row.contact_details || "",
    website: row.website || row.website_link || row.site || "",
    history: row.history || row.temple_history || row.description || "",
    significance: row.significance || row.speciality || "",
    sevas: row.sevas || row.pujas || row.services || "",
  };
}

export const importTemplesCSV = catchAsync(async (req: AuthRequest, res: Response) => {
  const { csv } = req.body as { csv?: string };
  const { rows: jsonRows } = req.body as { rows?: Record<string, string>[] };

  let records: Record<string, string>[] = [];

  if (csv && typeof csv === "string") {
    records = parseCSV(csv);
  } else if (Array.isArray(jsonRows)) {
    records = jsonRows;
  } else {
    return res.status(400).json({ error: "Provide either csv (string) or rows (array of objects)" });
  }

  if (records.length === 0) return res.status(400).json({ error: "No rows found in upload" });

  let created = 0, merged = 0, skipped = 0, googleEnriched = 0;
  const imported: any[] = [];

  for (const raw of records) {
    const f = extractTempleFields(raw);
    if (!f.name || !f.city) { skipped++; continue; }

    const key = `${f.name.toLowerCase().trim()}::${f.city.toLowerCase().trim()}`;

    // 1. Find existing by exact name+city (any source)
    const existing = await prisma.temple.findFirst({
      where: { name: { contains: f.name }, city: { contains: f.city } },
    });

    // 2. Optionally enrich from Google if missing lat/lon and key present
    if ((!f.lat || !f.lon) && isGoogleEnabled()) {
      try {
        const gResults = await googleTextSearch(`${f.name} ${f.city}`);
        if (gResults.length > 0) {
          const best = gResults[0];
          if (!f.lat) f.lat = best.lat;
          if (!f.lon) f.lon = best.lon;
          if (!f.phone) f.phone = best.phone || "";
          googleEnriched++;
        }
      } catch {}
    }

    if (existing) {
      // 3. MERGE: fill only missing fields on existing record
      await prisma.temple.update({
        where: { id: existing.id },
        data: {
          deityName: existing.deityName || f.deity || null,
          address: existing.address || f.address || null,
          lat: existing.lat ?? f.lat,
          lon: existing.lon ?? f.lon,
          contactDetails: existing.contactDetails || f.phone || null,
          websiteLink: existing.websiteLink || f.website || null,
          templeHistory: existing.templeHistory || f.history || null,
          significance: existing.significance || f.significance || null,
          sevas: existing.sevas || f.sevas || null,
        },
      });
      merged++;
      imported.push({ ...f, status: "merged", id: existing.id });
    } else {
      // 4. CREATE new record
      const createdRow = await prisma.temple.create({
        data: {
          name: f.name,
          placeId: `csv:${key}`,
          deityName: f.deity || null,
          address: f.address || null,
          city: f.city,
          state: f.state || null,
          lat: f.lat,
          lon: f.lon,
          contactDetails: f.phone || null,
          websiteLink: f.website || null,
          templeHistory: f.history || null,
          significance: f.significance || null,
          sevas: f.sevas || null,
        },
      });
      created++;
      imported.push({ ...f, status: "created", id: createdRow.id });
    }
  }

  res.status(200).json({ success: true, created, merged, skipped, googleEnriched, imported });
});
