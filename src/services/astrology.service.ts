import { EclipticGeoMoon } from "astronomy-engine";
import { getLahiriAyanamsa } from "../utils/ayanamsa";
import { timezoneFor, zonedTimeToUtc } from "../utils/timezone";
import { AppError } from "../utils/AppError";
import { NAKSHATRAS, Nakshatra } from "../data/nakshatraData";
import { RASHIS, Rashi } from "../data/rashiData";

export interface AstroProfile {
  rashi: {
    name: string;
    englishName: string;
    rulingPlanet: string;
    element: string;
    quality: string;
    deities: string[];
  };
  nakshatra: {
    name: string;
    pada: number;
    presidingDeity: string;
    rulingPlanet: string;
    templeDeity: string;
    qualities: string;
  };
  moonLongitude: {
    tropical: number;
    sidereal: number;
    ayanamsa: number;
  };
  timezone: string;
  birthUtc: string;
}

const NAKSHATRA_SPAN = 360 / 27;
const PADA_SPAN = NAKSHATRA_SPAN / 4;

/** Validates "YYYY-MM-DD" and "HH:MM" and returns their numeric parts. Rejects impossible dates like Feb 31. */
export function parseBirthDateTime(birthDate: string, birthTime: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const t = /^(\d{2}):(\d{2})$/.exec(birthTime);
  if (!d) throw new AppError("Date of birth must be in YYYY-MM-DD format", 400);
  if (!t) throw new AppError("Time of birth must be in HH:MM (24-hour) format", 400);
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new AppError("That date does not exist — please check the day and month", 400);
  }
  if (year < 1900) throw new AppError("Please enter a birth year from 1900 onwards", 400);
  if (hour > 23 || minute > 59) throw new AppError("Invalid time of birth", 400);
  return { year, month, day, hour, minute };
}

/**
 * Computes the Moon's sidereal (Lahiri) position at birth, and from it the
 * Nakshatra, Pada and Rashi. The birth time is interpreted in the local
 * timezone of the birthplace (historical offsets included).
 */
export function calculateAstroProfile(birthDate: string, birthTime: string, latitude: number, longitude: number): AstroProfile {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new AppError("Invalid birth place coordinates", 400);
  }
  const { year, month, day, hour, minute } = parseBirthDateTime(birthDate, birthTime);
  const timezone = timezoneFor(latitude, longitude);
  const utcDate = zonedTimeToUtc(year, month, day, hour, minute, timezone);
  if (utcDate.getTime() > Date.now()) throw new AppError("Birth date/time cannot be in the future", 400);

  // Geocentric apparent Moon in the ecliptic of date (the standard for Vedic charts).
  const tropicalLongitude = EclipticGeoMoon(utcDate).lon;
  const ayanamsa = getLahiriAyanamsa(utcDate);
  const siderealLongitude = (((tropicalLongitude - ayanamsa) % 360) + 360) % 360;

  const nakshatra = findNakshatra(siderealLongitude);
  const pada = Math.min(4, Math.floor((siderealLongitude - nakshatra.startDeg) / PADA_SPAN) + 1);
  const rashi = findRashi(siderealLongitude);

  return {
    rashi: {
      name: rashi.name,
      englishName: rashi.englishName,
      rulingPlanet: rashi.rulingPlanet,
      element: rashi.element,
      quality: rashi.quality,
      deities: rashi.deities,
    },
    nakshatra: {
      name: nakshatra.name,
      pada,
      presidingDeity: nakshatra.presidingDeity,
      rulingPlanet: nakshatra.rulingPlanet,
      templeDeity: nakshatra.templeDeity,
      qualities: nakshatra.qualities,
    },
    moonLongitude: {
      tropical: Math.round(tropicalLongitude * 1000) / 1000,
      sidereal: Math.round(siderealLongitude * 1000) / 1000,
      ayanamsa: Math.round(ayanamsa * 1000) / 1000,
    },
    timezone,
    birthUtc: utcDate.toISOString(),
  };
}

function findNakshatra(siderealDeg: number): Nakshatra {
  return NAKSHATRAS[Math.min(26, Math.floor(siderealDeg / NAKSHATRA_SPAN))];
}

function findRashi(siderealDeg: number): Rashi {
  return RASHIS[Math.min(11, Math.floor(siderealDeg / 30))];
}
