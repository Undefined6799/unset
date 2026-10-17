// P2.12 (auth/age.ts): the birth date is judged and then dropped. Nothing here stores it.
import { describe, expect, test } from "vitest";
import { ageInYears, parseBirthDate } from "./age.ts";

const TODAY = new Date(Date.UTC(2026, 9, 17, 15, 0, 0));

describe("birth date", () => {
  test("age.valid_adult", () => {
    const birth = parseBirthDate({ day: "1", month: "1", year: "2000" }, TODAY);
    expect(birth).toEqual({ year: 2000, month: 1, day: 1 });
    expect(birth === null ? 0 : ageInYears(birth, TODAY)).toBe(26);
  });

  test("age.exact_birthday", () => {
    const today = parseBirthDate({ day: "17", month: "10", year: "2010" }, TODAY);
    const tomorrow = parseBirthDate({ day: "18", month: "10", year: "2010" }, TODAY);
    expect(today === null ? 0 : ageInYears(today, TODAY)).toBe(16);
    expect(tomorrow === null ? 0 : ageInYears(tomorrow, TODAY)).toBe(15);
  });

  test("age.leading_zero", () => {
    expect(parseBirthDate({ day: "01", month: "01", year: "2000" }, TODAY)).toEqual({ year: 2000, month: 1, day: 1 });
  });

  test("age.invalid_dates", () => {
    const refused = [
      { day: "ab", month: "1", year: "2000" },
      { day: "31", month: "2", year: "2000" },
      { day: "30", month: "2", year: "2000" },
      { day: "1", month: "1", year: "2099" },
      { day: "1", month: "1", year: "1850" },
      { day: "1", month: "13", year: "2000" },
      { day: "0", month: "1", year: "2000" },
      { day: "1", month: "1", year: "999" },
    ];
    for (const fields of refused) expect(parseBirthDate(fields, TODAY)).toBeNull();
  });

  test("age.leap_day_waits_for_the_day", () => {
    const birth = { year: 2000, month: 2, day: 29 };
    expect(ageInYears(birth, new Date(Date.UTC(2026, 1, 28)))).toBe(25);
    expect(ageInYears(birth, new Date(Date.UTC(2026, 2, 1)))).toBe(26);
  });
});
