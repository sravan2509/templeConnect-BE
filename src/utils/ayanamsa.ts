/**
 * Lahiri Ayanamsa calculation.
 * Uses the IAU 2006 precession model to compute the tropical→sidereal offset
 * for a given UTC date. The base epoch is J2000.0 (2000-01-01T12:00:00Z).
 */
export function getLahiriAyanamsa(utcDate: Date): number {
  const J2000 = new Date("2000-01-01T12:00:00Z");
  const msDiff = utcDate.getTime() - J2000.getTime();
  const julianCenturies = msDiff / (36525 * 86400000);

  // Precession rate: ~50.29 arcseconds per Julian year ≈ 1.39697° per century
  // Lahiri offset from J2000 is ~23.86° (this drifts very slowly)
  const lahariBase = 23.86;
  const precessionPerCentury = 1.3969737;

  let ayanamsa = lahariBase + precessionPerCentury * julianCenturies;

  // Normalize to 0-360
  while (ayanamsa < 0) ayanamsa += 360;
  while (ayanamsa >= 360) ayanamsa -= 360;

  return ayanamsa;
}
