/**
 * Lahiri (Chitrapaksha) ayanamsa for a UTC date.
 * Value at J2000.0 is 23°51'11" (23.85306°), advancing with general precession
 * (~50.29"/year) — accurate to well under an arcminute for 1900–2100.
 */
export function getLahiriAyanamsa(utcDate: Date): number {
  const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  const T = (utcDate.getTime() - J2000) / (36525 * 86400000); // Julian centuries
  const precessionDeg = (5028.796195 * T + 1.1054348 * T * T) / 3600;
  return 23.85306 + precessionDeg;
}
