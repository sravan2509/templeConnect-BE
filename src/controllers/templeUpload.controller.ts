import { Response } from "express";
import { z } from "zod";
import * as XLSX from "xlsx";
import { catchAsync } from "../utils/catchAsync";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/AppError";
import { prisma } from "../config/prisma";

// ── Template column headers ─────────────────────────────────
const TEMPLATE_COLUMNS = [
  "Serial Number",
  "Temple Name",
  "Deity Name",
  "Address",
  "Latitude",
  "Longitude",
  "Contact Details",
  "Temple History",
  "Significance",
  "Sevas",
  "Website Link",
];

// ── Download Excel Template ─────────────────────────────────
export const downloadTemplate = catchAsync(async (_req: AuthRequest, res: Response) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS]);

  // Set column widths for readability
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

  const ext = req.file.originalname.toLowerCase();
  if (!ext.endsWith(".xlsx") && !ext.endsWith(".csv")) {
    throw new AppError("Only .xlsx and .csv files are supported", 400);
  }

  const wb = XLSX.read(req.file.buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new AppError("Empty file", 400);

  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (rows.length < 2) throw new AppError("File has no data rows", 400);

  // Skip header row
  const dataRows = rows.slice(1).filter((row) => row.length > 1 && row[1]);

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    try {
      const serialNumber = row[0] ? parseInt(String(row[0])) || null : null;
      const name = String(row[1] || "").trim();
      if (!name) { errors.push(`Row ${i + 2}: Temple name is empty`); continue; }

      const deityName = String(row[2] || "").trim() || null;
      const address = String(row[3] || "").trim() || null;
      const lat = row[4] ? parseFloat(String(row[4])) : null;
      const lon = row[5] ? parseFloat(String(row[5])) : null;
      const contactDetails = String(row[6] || "").trim() || null;
      const templeHistory = String(row[7] || "").trim() || null;
      const significance = String(row[8] || "").trim() || null;
      const sevas = String(row[9] || "").trim() || null;
      const websiteLink = String(row[10] || "").trim() || null;

      // Generate a stable placeId from temple name
      const placeId = `db:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

      // Extract city and state from address
      const addressParts = (address || "").split(",").map((s) => s.trim());
      const city = addressParts.length >= 2 ? addressParts[addressParts.length - 2] : null;
      const state = addressParts.length >= 1 ? addressParts[addressParts.length - 1] : null;

      const existing = await prisma.temple.findUnique({ where: { placeId } });

      if (existing) {
        await prisma.temple.update({
          where: { placeId },
          data: {
            serialNumber, name, deityName, address, city, state,
            lat: lat && !isNaN(lat) ? lat : existing.lat,
            lon: lon && !isNaN(lon) ? lon : existing.lon,
            contactDetails, templeHistory, significance, sevas, websiteLink,
          },
        });
        updated++;
      } else {
        await prisma.temple.create({
          data: {
            serialNumber, name, placeId, deityName, address, city, state,
            lat: lat && !isNaN(lat) ? lat : null,
            lon: lon && !isNaN(lon) ? lon : null,
            contactDetails, templeHistory, significance, sevas, websiteLink,
          },
        });
        created++;
      }
    } catch (err: any) {
      errors.push(`Row ${i + 2}: ${err.message}`);
    }
  }

  res.json({
    success: true,
    created,
    updated,
    total: dataRows.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// ── List All Temples in DB ──────────────────────────────────
export const listAllTemples = catchAsync(async (_req: AuthRequest, res: Response) => {
  const temples = await prisma.temple.findMany({
    include: { events: true, templePujas: true },
    orderBy: { name: "asc" },
  });
  res.json(temples);
});

// ── Update Temple ───────────────────────────────────────────
const updateTempleSchema = z.object({
  name: z.string().min(1).optional(),
  deityName: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lon: z.number().optional().nullable(),
  contactDetails: z.string().optional().nullable(),
  templeHistory: z.string().optional().nullable(),
  significance: z.string().optional().nullable(),
  sevas: z.string().optional().nullable(),
  websiteLink: z.string().optional().nullable(),
  serialNumber: z.number().optional().nullable(),
});

export const updateTemple = catchAsync(async (req: AuthRequest, res: Response) => {
  const data = updateTempleSchema.parse(req.body);
  const temple = await prisma.temple.update({
    where: { id: req.params.id },
    data,
    include: { events: true, templePujas: true },
  });
  res.json(temple);
});

// ── Delete Temple ───────────────────────────────────────────
export const deleteTemple = catchAsync(async (req: AuthRequest, res: Response) => {
  await prisma.temple.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
