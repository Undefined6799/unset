import { describe, expect, test } from "vitest";
import { HISTORY_LIMIT, parseSignInIds } from "./sign-in-history.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("sign-in history", () => {
  test("ids.a_delete_form_keeps_valid_ids_once_and_at_most_the_page", () => {
    expect(parseSignInIds([id(1), "x", id(2), id(1), "", `${id(3)} `, id(4).toUpperCase()])).toEqual([id(1), id(2)]);
    const many = Array.from({ length: HISTORY_LIMIT + 5 }, (_, n) => id(n + 1));
    expect(parseSignInIds(many)).toEqual(many.slice(0, HISTORY_LIMIT));
    expect(parseSignInIds([])).toEqual([]);
  });
});
