// The shape of an error a page can show. What the request gate puts on every request (App.Locals) is declared in
// src/lib/server/locals.d.ts, server code, since it names domain types a screen may not import.
declare global {
  namespace App {
    interface Error {
      message: string;
      reqId?: string;
    }
  }
}

export {};
