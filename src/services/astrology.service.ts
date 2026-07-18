import { Body, Observer, Equator, Ecliptic } from "astronomy-engine";
import { getLahiriAyanamsa } from "../utils/ayanamsa";
import { NAKSHATRAS, Nakshatra } from "../data/nakshatraData";
import { RASHIS, Rashi } from "../data/rashiData";

export interface BirthChartInput {
  dob: string;
  time: string;
  lat: number;
  lon: number;
}

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
}

export function calculateAstroProfile(
  birthDate: string,
  birthTime: string,
  latitude: number,
  longitude: number
): AstroProfile {
  const [year, month, day] = birthDate.split("-").map(Number);
  const [hour, minute] = birthTime.split(":").map(Number);

  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  const utcDate = new Date(localDate.getTime() - istOffsetMs);

  const observer = new Observer(latitude, longitude, 0);
  const moonEquatorial = Equator(Body.Moon, utcDate, observer, true, true);

  const moonEcliptic = Ecliptic(moonEquatorial.vec);
  let tropicalLongitude = moonEcliptic.elon;

  const ayanamsa = getLahiriAyanamsa(utcDate);
  let siderealLongitude = tropicalLongitude - ayanamsa;
  if (siderealLongitude < 0) siderealLongitude += 360;
  if (siderealLongitude >= 360) siderealLongitude -= 360;

  const nakshatra = findNakshatra(siderealLongitude);
  const pada = findPada(siderealLongitude, nakshatra);
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
  };
}

function findNakshatra(siderealDeg: number): Nakshatra {
  for (const n of NAKSHATRAS) {
    if (siderealDeg >= n.startDeg && siderealDeg < n.endDeg) return n;
  }
  return NAKSHATRAS[0];
}

function findPada(siderealDeg: number, nakshatra: Nakshatra): number {
  const offset = siderealDeg - nakshatra.startDeg;
  const padaSize = 13.3333 / 4;
  return Math.min(4, Math.floor(offset / padaSize) + 1);
}

function findRashi(siderealDeg: number): Rashi {
  for (const r of RASHIS) {
    if (siderealDeg >= r.startDeg && siderealDeg < r.endDeg) return r;
  }
  return RASHIS[0];
}

export function getNakshatraName(siderealDeg: number): string {
  return findNakshatra(siderealDeg).name;
}

export function getRashiName(siderealDeg: number): string {
  return findRashi(siderealDeg).name;
}
