// Quotas per command (ADR 0081 decision 5; rule SE-5): a rolling hour per account and for the whole service, held in
// memory (guideline §1: in-memory limits are the default). A slot is spent before MAS is called, whatever it answers,
// so a compromised caller can do at most this much per hour.
import type { ChatAdminVerb } from "@unset/shared-admin-envelope";

export type Limits = Readonly<Record<ChatAdminVerb, { readonly perUser: number; readonly global: number }>>;

export const DEFAULT_LIMITS: Limits = {
  "account.create": { perUser: 3, global: 300 },
  "session.mint": { perUser: 30, global: 3_000 },
  "session.end": { perUser: 60, global: 6_000 },
  // ADR 0084: web's queued jobs, each safe to repeat; a retry spends a slot like any call.
  "account.lock": { perUser: 10, global: 1_000 },
  "account.unlock": { perUser: 10, global: 1_000 },
  "account.deactivate": { perUser: 5, global: 500 },
  // ADR 0091: web's hourly job from each replica; the sweep names no account, so both counts are the same.
  "rooms.sweep": { perUser: 6, global: 6 },
};
const WINDOW_MS = 3_600_000;

export type Quotas = { readonly spend: (verb: ChatAdminVerb, user: string, now: number) => boolean };

export function createQuotas(overrides: Partial<Limits> = {}): Quotas {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const spent = new Map<string, number[]>();
  const recent = (key: string, now: number) => (spent.get(key) ?? []).filter((at) => at > now - WINDOW_MS);
  return {
    spend: (verb, user, now) => {
      const perUser = recent(`${verb} ${user}`, now);
      const global = recent(verb, now);
      if (perUser.length >= limits[verb].perUser || global.length >= limits[verb].global) return false;
      spent.set(`${verb} ${user}`, [...perUser, now]);
      spent.set(verb, [...global, now]);
      return true;
    },
  };
}
