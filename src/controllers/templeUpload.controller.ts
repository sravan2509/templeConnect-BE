import { Response } from "express";
import { z } from "zod";
import * as XLSX from "xlsx";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";
import { clearTempleCache } from "../services/temple.service";
import { findMatchingTemple, mergeTempleData } from "../services/templeMatcher.service";

// City and State were added at the end, so older templates (11 columns) still upload.
const TEMPLATE_COLUMNS = [
  "Serial Number", "Temple Name", "Deity Name", "Address", "Latitude", "Longitude",
  "Contact Details", "Temple History", "Significance", "Sevas", "Website Link", "City", "State",
];

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Stable id from name + city, so same-named temples in different towns stay separate. */
export function templePlaceId(name: string, city: string | null) {
  return `db:${slug(name)}${city ? `--${slug(city)}` : ""}`;
}

/** Best-effort city/state from an address like "Main Rd, Bhimavaram, Andhra Pradesh 534201, India". */
function cityStateFromAddress(address: string | null) {
  const parts = (address || "")
    .split(",")
    .map((s) => s.replace(/\b\d{6}\b/g, "").trim())
    .filter((s) => s && s.toLowerCase() !== "india");
  return {
    city: parts.length >= 2 ? parts[parts.length - 2] : null,
    state: parts.length >= 1 ? parts[parts.length - 1] : null,
  };
}

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v).trim();
  return s || null;
};

function coordinate(v: unknown, max: number): number | null {
  const s = cell(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : NaN;
}

// ── Download Excel Template ─────────────────────────────────
export const downloadTemplate = catchAsync(async (_req: AuthRequest, res: Response) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_COLUMNS,
    [1, "Sri Someswara Swamy Temple", "Shiva", "Gunupudi, Bhimavaram, Andhra Pradesh 534201", 16.5449, 81.5212,
      "+91 8816 222222", "One of the Pancharama Kshetras...", "Pancharama temple", "Abhishekam 6:00 AM", "https://example.org", "Bhimavaram", "Andhra Pradesh"],
  ]);
  ws["!cols"] = TEMPLATE_COLUMNS.map((h) => ({ wch: Math.max(h.length + 4, 20) }));
  XLSX.utils.book_append_sheet(wb, ws, "Temples");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=temple_upload_template.xlsx");
  res.send(Buffer.from(buf));
});

// ── Upload Excel/CSV ────────────────────────────────────────
export const uploadTemples = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new AppError("No file uploaded", 400);
  const name = req.file.originalname.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) throw new AppError("Only .xlsx and .csv files are supported", 400);
  // Check the content, not just the extension: .xlsx is a ZIP ("PK"), .csv must be plain text.
  const head = req.file.buffer.subarray(0, 4);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const looksText = !req.file.buffer.subarray(0, 2048).includes(0);
  if ((name.endsWith(".xlsx") && !isZip) || (name.endsWith(".csv") && !looksText)) {
    throw new AppError("The file content doesn't match its extension. Please upload a real .xlsx or .csv file.", 400);
  }

  let rows: unknown[][];
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer", dense: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("empty");
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  } catch {
    throw new AppError("Could not read the file. Please use the provided template.", 400);
  }
  if (rows.length < 2) throw new AppError("File has no data rows", 400);
  if (rows.length > 5001) throw new AppError("Please upload at most 5000 temples per file", 400);

  let created = 0, updated = 0, skipped = 0;
  const errors: string[] = [];
  const details: { row: number; name: string; action: string; into?: string; previousSource?: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNum = i + 1; // spreadsheet row number (header is row 1)
    if (row.every((c) => cell(c) === null)) continue;
    try {
      const templeName = cell(row[1]);
      if (!templeName) { errors.push(`Row ${rowNum}: Temple name is empty`); skipped++; continue; }

      const lat = coordinate(row[4], 90);
      const lon = coordinate(row[5], 180);
      if (Number.isNaN(lat) || Number.isNaN(lon)) { errors.push(`Row ${rowNum}: Latitude/Longitude are not valid numbers`); skipped++; continue; }

      const address = cell(row[3]);
      const derived = cityStateFromAddress(address);
      const city = cell(row[11]) ?? derived.city;
      const state = cell(row[12]) ?? derived.state;
      const serial = cell(row[0]);

      const fields = {
        name: templeName,
        serialNumber: serial ? parseInt(serial, 10) || null : null,
        deityName: cell(row[2]), address, city, state, lat, lon,
        contactDetails: cell(row[6]), templeHistory: cell(row[7]), significance: cell(row[8]),
        sevas: cell(row[9]), websiteLink: safeWebsite(cell(row[10])),
      };

      // Same temple already in the DB (uploaded before, imported, or saved from a Google search)?
      // Merge into it: uploaded values win, blank cells leave stored values untouched.
      const existing = await findMatchingTemple({ name: templeName, city, address, lat, lon, placeId: templePlaceId(templeName, city) });
      if (existing) {
        await prisma.temple.update({ where: { id: existing.id }, data: { ...mergeTempleData(existing, fields, "upload"), source: "upload" } });
        updated++;
        details.push({ row: rowNum, name: templeName, action: "merged", into: existing.name, previousSource: existing.source });
      } else {
        const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
        await prisma.temple.create({ data: { ...(data as typeof fields), name: templeName, placeId: templePlaceId(templeName, city), source: "upload" } });
        created++;
        details.push({ row: rowNum, name: templeName, action: "created" });
      }
    } catch (err: any) {
      errors.push(`Row ${rowNum}: ${err.message?.split("\n").pop() || "could not be saved"}`);
      skipped++;
    }
  }

  clearTempleCache();
  res.json({ success: true, created, updated, skipped, total: rows.length - 1, errors: errors.slice(0, 100), details: details.slice(0, 500) });
});

// ── List / update / delete temples ──────────────────────────
export const listAllTemples = catchAsync(async (req: AuthRequest, res: Response) => {
  const includeSearch = req.query.all === "true";
  const temples = await prisma.temple.findMany({
    where: includeSearch ? {} : { source: { in: ["upload", "import", "admin"] } },
    include: { events: { orderBy: { date: "asc" } }, templePujas: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  res.json(temples);
});

/** Accepts "example.org" or http(s) URLs only — never javascript:, data:, etc. */
export function safeWebsite(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));

const updateTempleSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  deityName: optionalText(100),
  address: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  contactDetails: optionalText(300),
  templeHistory: optionalText(10000),
  significance: optionalText(5000),
  sevas: optionalText(5000),
  websiteLink: optionalText(500).refine((v) => v == null || safeWebsite(v) !== null, "Website must be an http(s) address"),
  serialNumber: z.number().int().nullable().optional(),
}).strict();

export const updateTemple = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = updateTempleSchema.parse(req.body);
  const temple = await prisma.temple.update({
    where: { id: req.params.id },
    // Admin edits make a temple curated.
    data: { ...data, source: "admin" },
    include: { events: true, templePujas: true },
  });
  clearTempleCache();
  res.json(temple);
});

export const deleteTemple = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.temple.delete({ where: { id: req.params.id } });
  clearTempleCache();
  res.status(204).send();
});
