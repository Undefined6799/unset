import { BrandHeader } from "@unset/shared-ui/brand-header";
import { Avatar, Button, Icon, Input, Navigation, safeHref } from "@unset/shared-ui/presentation";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { SafeHref } from "../../safe-href.ts";
import { Header } from "./Header.tsx";

test("pure_brand_header_preserves_the_existing_composition", () => {
  const homeHref = safeHref("/home", ["path"]) as SafeHref;
  expect(renderToStaticMarkup(<BrandHeader homeHref={homeHref} className="shell" />)).toBe(
    renderToStaticMarkup(<Header brandOnly homeHref={homeHref} className="shell" />),
  );
  expect(renderToStaticMarkup(<BrandHeader />)).not.toMatch(/data-island|<script|<nav|<button/);
});

test("presentation_entry_exposes_the_pure_controls", () => {
  expect([Navigation, Button, Input, Icon, Avatar, safeHref].every((value) => typeof value === "function")).toBe(true);
});
