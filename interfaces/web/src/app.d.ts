// What the request gate (hooks.server.ts) puts on every request, and the shape of an error a page can show.
declare global {
  namespace App {
    interface Locals {
      /** The signed-in DID; undefined for a visitor. */
      did: string | undefined;
      reqId: string;
      /** The request's deadline; every load and action passes it to each call it makes (rule RE-1). */
      deadline: AbortSignal;
    }
    interface Error {
      message: string;
      reqId?: string;
    }
  }
}

export {};
