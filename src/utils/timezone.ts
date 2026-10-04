// eslint-disable-next-line @typescript-eslint/no-var-requires
const tzlookup: (lat: number, lon: number) => string = require("tz-lookup");

/** IANA timezone for a coordinate (e.g. "Asia/Kolkata"). */
export function timezoneFor(lat: number, lon: number): string {
  try {
    return tzlookup(lat, lon);
  } catch {
    return "Asia/Kolkata";
  }
}

/** Offset (minutes east of UTC) of `timeZone` at the given instant, including historical rules and DST. */
function offsetMinutesAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instantMs) / 60000);
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC Date, independent of the
 * server's own timezone.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes handle instants near DST/offset transitions.
  let guess = wallAsUtc - offsetMinutesAt(wallAsUtc, timeZone) * 60000;
  guess = wallAsUtc - offsetMinutesAt(guess, timeZone) * 60000;
  return new Date(guess);
}
