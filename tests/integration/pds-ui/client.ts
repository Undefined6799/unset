// Native provider0.23.1 transport contract: installed router/create-api-middleware.js:602-623
// and router/assets/csrf.js. HTTP evidence only: this jar does not model browser Secure/SameSite.
import type { Reply } from "./helper.ts";
export type NativeBody = {
  account: { did: string; handle: string; emailAuthFactor: boolean };
  sessions: { account: { did: string }; loginRequired: boolean }[];
  error?: string;
};
export async function nativeClient(
  baseUrl: string,
  send: (path: string, method: string, headers: Record<string, string>, body: string) => Promise<Reply>,
) {
  const jar = new Map<string, string>();
  const headers = () => ({
    cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
    origin: baseUrl,
    referer: `${baseUrl}/account/sign-in`,
    "user-agent": "unset-pds-fixture",
  });
  async function call(path: string, method: string, extra: Record<string, string>, body = "") {
    const response = await send(path, method, { ...headers(), ...extra }, body);
    const cookies = response.headers["set-cookie"];
    for (const cookie of typeof cookies === "string" ? [cookies] : (cookies ?? [])) {
      const pair = cookie.split(";")[0] ?? "";
      const equals = pair.indexOf("=");
      if (equals > 0) jar.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    return response;
  }
  async function navigate() {
    const response = await call("/account/sign-in", "GET", {
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    });
    if (response.status !== 200 || !jar.has("csrf-token"))
      throw new Error(`native navigation failed (${response.status})`);
  }
  await navigate();
  return {
    navigate,
    async api(endpoint: string, input?: object): Promise<{ status: number; body: NativeBody }> {
      const response = await call(
        `/@atproto/oauth-provider/~api/${endpoint}`,
        input ? "POST" : "GET",
        {
          "sec-fetch-mode": "same-origin",
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          "x-csrf-token": jar.get("csrf-token") ?? "",
        },
        input ? JSON.stringify(input) : "",
      );
      let body: NativeBody;
      try {
        const parsed = JSON.parse(response.body);
        body = (Array.isArray(parsed) ? { sessions: parsed } : parsed) as NativeBody;
      } catch {
        throw new Error(`native response invalid (${response.status})`);
      }
      return { status: response.status, body };
    },
  };
}
