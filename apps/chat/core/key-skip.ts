// "Skip for now" on the unlock card (Alex 2026-11-23): a browser without the recovery key still uses chat and gets new
// messages; only what came before it stays unreadable until the key is given. Element offers the same as "I'll verify
// later" (element-web v1.12.35 apps/web/src/stores/SetupEncryptionStore.ts:197-210). The choice is kept by this
// origin for this account only, so a reload does not ask again, and Log out forgets it with the other local choices.
// Storage that refuses counts as no skip: the card asks again on the next load, which is the safe side.

type ChoiceStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const skipKeyName = (me: string) => `unset-chat:${me}:skip-key`;

export function keySkipped(storage: ChoiceStore, me: string): boolean {
  try {
    return storage.getItem(skipKeyName(me)) === "1";
  } catch {
    return false;
  }
}

export function skipKey(storage: ChoiceStore, me: string): void {
  try {
    storage.setItem(skipKeyName(me), "1");
  } catch {
    // Not kept: this page still goes on without the key; the next load asks again.
  }
}

export function forgetKeySkip(storage: ChoiceStore, me: string): void {
  try {
    storage.removeItem(skipKeyName(me));
  } catch {
    // Nothing kept that could be removed.
  }
}
