// P2.03x: the session timeouts the store (P2.03) reads, with the defaults of plan section 5.3 and their bounds.
import { defineConfig, loadConfig } from "@unset/shared-config";
import { describe, expect, test } from "vitest";
import { config, loginConfig, sessionConfig } from "./config.ts";

const load = (env: Record<string, string>) =>
  loadConfig(defineConfig({ ...sessionConfig }), env, { onUnknownKeys: () => undefined });
const problems = (env: Record<string, string>) => {
  try {
    load(env);
    return [];
  } catch (error) {
    return (error as { problems: { key: string; reason: string }[] }).problems;
  }
};

describe("session config", () => {
  test("session_timeouts_default", () => {
    // Idle 7 days, absolute 30 days, touch at most every 5 minutes (P2.03 Inputs).
    expect(load({})).toEqual({ SESSION_IDLE_S: 604_800, SESSION_ABSOLUTE_S: 2_592_000, SESSION_TOUCH_INTERVAL_S: 300 });
  });

  test("session_timeouts_in_the_web_server_config", () => {
    for (const key of Object.keys(sessionConfig)) expect(config.fields).toHaveProperty(key);
  });

  test("session_timeouts_bounded", () => {
    // The absolute limit is also the cookie's Max-Age, so it never exceeds the 30 days the plan sets.
    for (const [key, value] of [
      ["SESSION_ABSOLUTE_S", "2592001"],
      ["SESSION_ABSOLUTE_S", "299"],
      ["SESSION_IDLE_S", "299"],
      ["SESSION_TOUCH_INTERVAL_S", "0"],
      ["SESSION_TOUCH_INTERVAL_S", "3601"],
      ["SESSION_IDLE_S", "7d"],
    ] as const) {
      expect(problems({ [key]: value }), `${key}=${value}`).toEqual([{ key, reason: "invalid" }]);
    }
    expect(load({ SESSION_ABSOLUTE_S: "300", SESSION_IDLE_S: "300", SESSION_TOUCH_INTERVAL_S: "1" })).toEqual({
      SESSION_IDLE_S: 300,
      SESSION_ABSOLUTE_S: 300,
      SESSION_TOUCH_INTERVAL_S: 1,
    });
  });

  test("session_timeouts_ordered", () => {
    // Idle never outlasts absolute, and the touch interval is shorter than idle, or a live session would expire
    // between two touches.
    expect(problems({ SESSION_IDLE_S: "2592000", SESSION_ABSOLUTE_S: "604800" })).toEqual([
      { key: "SESSION_IDLE_S", reason: "invalid" },
    ]);
    expect(problems({ SESSION_IDLE_S: "600", SESSION_TOUCH_INTERVAL_S: "600" })).toEqual([
      { key: "SESSION_TOUCH_INTERVAL_S", reason: "invalid" },
    ]);
    expect(load({ SESSION_IDLE_S: "2592000" }).SESSION_IDLE_S).toBe(2_592_000);
  });
});

describe("email recheck", () => {
  const recheck = (env: Record<string, string>) =>
    loadConfig(defineConfig({ EMAIL_RECHECK_S: loginConfig.EMAIL_RECHECK_S }), env, {
      onUnknownKeys: () => undefined,
    });

  test("email_recheck_capped_at_900", () => {
    // P2.11a: the recheck is how long another browser keeps rendering after the grant is revoked at the PDS, so its
    // maximum is the revocation window: 15 minutes.
    expect(recheck({}).EMAIL_RECHECK_S).toBe(900);
    expect(recheck({ EMAIL_RECHECK_S: "900" }).EMAIL_RECHECK_S).toBe(900);
    for (const value of ["901", "86400"]) {
      expect(() => recheck({ EMAIL_RECHECK_S: value }), value).toThrow(
        expect.objectContaining({ problems: [{ key: "EMAIL_RECHECK_S", reason: "invalid" }] }),
      );
    }
  });
});
