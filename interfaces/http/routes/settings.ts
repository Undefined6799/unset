// GET /settings/profile (P2.12): a placeholder app page so the onboarding gate has a route to refuse. P2.13
// replaces the body. The gate order is session, then onboarding, then a confirmed email.
import { defineRoute, type Route } from "@unset/shared-http";
import type { ReactNode } from "react";
import { type AppGate, type OpenedApp, openApp } from "../app-gate.ts";
import type { PageSpec } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";

export type SettingsDeps = {
  gate: AppGate;
  page: (page: PageSpec) => Response;
  screens: WebRender["screens"];
};

const open = (gate: AppGate, request: Request, deadline: AbortSignal): Promise<Response | OpenedApp> =>
  openApp(gate, request, deadline, "/settings/profile");

export function settingsRoutes(deps: SettingsDeps): Route[] {
  return [
    defineRoute({
      method: "GET",
      path: "/settings/profile",
      group: "app",
      rateLimit: "default",
      session: "none",
      handler: async ({ request, deadline }) => {
        const opened = await open(deps.gate, request, deadline);
        if (opened instanceof Response) return opened;
        const body: ReactNode = deps.screens.settingsProfile({ privacyNotice: opened.privacyNotice });
        return deps.page({
          group: "app",
          request,
          title: "Profile",
          body,
          islands: "off",
          shell: { noindex: true, navigation: { active: "settings", accountPath: `/${opened.session.did}` } },
        });
      },
    }),
  ];
}
