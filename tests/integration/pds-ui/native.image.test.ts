import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { startPdsUiFixture } from "./fixture.ts";
import { FIXTURE_TEST_MS, type FixtureContext } from "./fixture-lifetime.ts";

async function withFixture(
  ctx: FixtureContext,
  body: (fixture: Awaited<ReturnType<typeof startPdsUiFixture>>) => Promise<void>,
) {
  const fixture = await startPdsUiFixture(ctx);
  try {
    await body(fixture);
  } catch (failure) {
    try {
      await fixture.close();
    } catch (cleanupFailure) {
      throw new AggregateError([failure, cleanupFailure], "native smoke failed; cleanup also failed");
    }
    throw failure;
  }
  await fixture.close();
  expect(await fixture.resourcesRemain()).toBe(false);
}

test(
  "confines native resources and removes them, including owned cleanup",
  async (ctx) => {
    await withFixture(ctx, async (fixture) => {
      writeFileSync(join(tmpdir(), "pds-ui-native-evidence.json"), JSON.stringify(fixture.evidence), { mode: 0o600 });
      expect(fixture.evidence.internal).toBe(true);
      expect(fixture.evidence.ssrfProtection).toBe(true);
      expect(fixture.evidence.denied).toBe(true);
      expect(fixture.evidence.nativeCommand).toBe(true);
    });
  },
  FIXTURE_TEST_MS,
);

test(
  "runs native signup, remembered signin, recovery and email factor through real mail",
  async (ctx) => {
    await withFixture(ctx, async (fixture) => {
      const client = await fixture.client();
      const suffix = randomBytes(6).toString("hex");
      const email = `${suffix}@fixture.test`,
        handle = `h${suffix}.test`;
      const password = randomBytes(24).toString("base64url"),
        nextPassword = randomBytes(24).toString("base64url");
      const signup = await client.api("sign-up", { locale: "en", email, handle, password });
      expect(signup.status).toBe(200);
      const did = signup.body.account.did;
      expect(did.startsWith("did:plc:")).toBe(true);
      expect(signup.body.account.handle === handle).toBe(true);
      expect(await fixture.plcContains(did)).toBe(true);
      expect(
        (await client.api("device-sessions")).body.sessions.some(
          (a: { account: { did: string }; loginRequired: boolean }) => a.account.did === did && !a.loginRequired,
        ),
      ).toBe(true);
      expect((await client.api("sign-out", { did })).status).toBe(200);
      const signin = await fixture.client();
      expect((await signin.api("sign-in", { locale: "en", username: email, password, remember: true })).status).toBe(
        200,
      );
      await signin.navigate();
      expect(
        (await signin.api("device-sessions")).body.sessions.some(
          (a: { account: { did: string }; loginRequired: boolean }) => a.account.did === did && !a.loginRequired,
        ),
      ).toBe(true);
      const recovery = await fixture.client();
      expect((await recovery.api("reset-password-request", { locale: "en", email })).status).toBe(200);
      const reset = await fixture.mailbox.code(email, "Password Reset Requested");
      expect((await recovery.api("reset-password-confirm", { token: reset, password: nextPassword })).status).toBe(200);
      expect((await recovery.api("reset-password-confirm", { token: reset, password: nextPassword })).status).toBe(400);
      expect((await recovery.api("sign-in", { locale: "en", username: email, password, remember: true })).status).toBe(
        400,
      );
      expect(
        (await recovery.api("sign-in", { locale: "en", username: email, password: nextPassword, remember: true }))
          .status,
      ).toBe(200);
      expect((await recovery.api("verify-email-request", { did, locale: "en" })).status).toBe(200);
      const confirmation = await fixture.mailbox.code(email, "Email Confirmation");
      expect((await recovery.api("verify-email-confirm", { did, email, token: confirmation })).status).toBe(200);
      expect((await recovery.api("enable-email-otp", { did, locale: "en" })).body.account.emailAuthFactor).toBe(true);
      const factor = await fixture.client();
      const credentials = { locale: "en", username: email, password: nextPassword, remember: true };
      const challenge = await factor.api("sign-in", credentials);
      expect(challenge.status).toBe(401);
      expect(challenge.body.error).toBe("second_authentication_factor_required");
      const otp = await fixture.mailbox.code(email, "Sign-in Confirmation");
      const wrong = `${otp.startsWith("A") ? "B" : "A"}${otp.slice(1)}`;
      expect((await factor.api("sign-in", { ...credentials, emailOtp: wrong })).status).toBe(400);
      expect((await factor.api("sign-in", { ...credentials, emailOtp: otp })).status).toBe(200);
      await factor.navigate();
      expect(
        (await factor.api("device-sessions")).body.sessions.some(
          (a: { account: { did: string }; loginRequired: boolean }) => a.account.did === did && !a.loginRequired,
        ),
      ).toBe(true);
    });
  },
  FIXTURE_TEST_MS,
);
