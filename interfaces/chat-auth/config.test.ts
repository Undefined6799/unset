// The door's settings (build step 6; ADR 0081 decision 4): its own https origin on unset.cc and web's, the kit's proxy
// and limit keys; a plain-http web origin, or one equal to the door's, refuses boot.
import { loadConfig } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { schema } from "./config.ts";

export const DOOR_ENV = {
  UNSET_ENV: "test",
  UNSET_SERVICE: "chat-auth",
  UNSET_COMMIT: "a".repeat(40),
  LISTEN_PORT: "8090",
  PUBLIC_ORIGIN: "https://unset.cc",
  HTTP_ALLOWED_HOSTS: "unset.cc",
  TRUSTED_PROXY_MODE: "socket",
  WEB_ORIGIN: "https://unset.sh",
};

describe("door config", () => {
  test("door_config.boots: with the two origins and the kit's keys", () => {
    const config = loadConfig(schema, DOOR_ENV);
    expect([config.PUBLIC_ORIGIN, config.WEB_ORIGIN]).toEqual(["https://unset.cc", "https://unset.sh"]);
  });

  test("door_config.web_origin: required, https, and never the door's own", () => {
    const { WEB_ORIGIN: _, ...without } = DOOR_ENV;
    expect(() => loadConfig(schema, without)).toThrow();
    expect(() => loadConfig(schema, { ...DOOR_ENV, WEB_ORIGIN: "http://unset.sh" })).toThrow();
    expect(() => loadConfig(schema, { ...DOOR_ENV, WEB_ORIGIN: "https://unset.cc" })).toThrow();
  });

  test("door_config.no_media: the media origin the kit carries for pages is not a door setting", () => {
    expect(Object.keys(schema.fields)).not.toContain("MEDIA_ORIGIN");
  });
});
