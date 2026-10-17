// The age-screen date (P2.12). Pure: the date is judged here and then dropped. Nothing in this module stores it,
// logs it, or knows the threshold. The route compares the year count with MIN_AGE and stores only the outcome.

export type BirthDate = { readonly year: number; readonly month: number; readonly day: number };

const YEAR = /^\d{4}$/;
const DAY_OR_MONTH = /^\d{1,2}$/;

/** A day or month, including a leading zero (`01`). The year is matched separately, as exactly four digits. */
function dayOrMonth(raw: string): number | null {
  const text = raw.trim();
  if (!DAY_OR_MONTH.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * A real calendar date, not in the future and not before 1900, in UTC. Letters, 31 February, a future day and a year
 * before 1900 are all refused. The year must be four digits; the day and month are whole numbers.
 */
export function parseBirthDate(
  fields: { readonly day: string; readonly month: string; readonly year: string },
  today: Date,
): BirthDate | null {
  const yearText = fields.year.trim();
  if (!YEAR.test(yearText)) return null;
  const year = Number(yearText);
  const month = dayOrMonth(fields.month);
  const day = dayOrMonth(fields.day);
  if (month === null || day === null || year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const born = new Date(Date.UTC(year, month - 1, day));
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) return null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (born.getTime() > todayUtc) return null;
  return { year, month, day };
}

/** Full years from `birth` to `today`, UTC. The birthday itself counts: the year increments that day. */
export function ageInYears(birth: BirthDate, today: Date): number {
  let age = today.getUTCFullYear() - birth.year;
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  if (month < birth.month || (month === birth.month && day < birth.day)) age -= 1;
  return age;
}
