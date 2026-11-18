// What a card shows beside its own words (the profile-card mockup, Alex 2026-11-17): a labelled link names its site,
// and an email button's address is shown under the buttons.
import { describe, expect, test } from "vitest";
import { cardViews } from "./view.ts";

describe("card views", () => {
  test("a_labelled_link_names_its_host_and_an_unlabelled_one_shows_the_host_as_its_text", () => {
    const [card] = cardViews([
      {
        key: "k",
        width: "half",
        content: {
          kind: "links",
          title: "Elsewhere",
          layout: "list",
          items: [
            { uri: "https://www.instagram.com/mara.records", label: "@mara.records", description: "" },
            { uri: "https://github.com/maralind/", label: "", description: "" },
          ],
        },
      },
    ]);
    expect(card?.shown).toMatchObject({
      kind: "links",
      items: [
        { text: "@mara.records", site: "instagram.com" },
        { text: "github.com/maralind", site: "" },
      ],
    });
  });

  test("an_email_button_carries_its_address_and_a_link_button_none", () => {
    const [card] = cardViews([
      {
        key: "k",
        width: "half",
        content: {
          kind: "buttons",
          heading: "Booking",
          text: "",
          buttons: [
            { kind: "email", address: "hello@mara.example" },
            { kind: "link", preset: "bookCall", uri: "https://cal.example/mara", label: "" },
          ],
        },
      },
    ]);
    expect(card?.shown).toEqual({
      kind: "buttons",
      heading: "Booking",
      text: "",
      buttons: [
        { href: "mailto:hello%40mara.example", label: "Email me", address: "hello@mara.example" },
        { href: "https://cal.example/mara", label: "Book a call" },
      ],
    });
  });
});
