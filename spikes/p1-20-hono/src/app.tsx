// The fixture app (P1.20 step 1): the same four routes for every candidate, plus the /neg control on test servers.
import { Hono } from "hono";
import { Box } from "./components/Box.tsx";
import { page } from "./glue/document.tsx";
import { Island } from "./glue/islands.tsx";
import Counter from "./islands/Counter.tsx";
import Search from "./islands/Search.tsx";

export function createApp(options: { negativeControl: boolean }) {
  const app = new Hono();
  app.get("/", (c) =>
    c.html(
      page(
        <main>
          <Box>Server-rendered box</Box>
          <Island source="src/islands/Counter.tsx" component={Counter} props={{ start: 1 }} />
          <Island source="src/islands/Search.tsx" component={Search} props={{ placeholder: "Search" }} />
          <form method="post" action="/form">
            <button type="submit">Send</button>
          </form>
        </main>,
      ),
    ),
  );
  app.get("/@demo", (c) => c.html(page(<Box>Zero-JS profile</Box>, false)));
  app.post("/form", (c) => {
    if (c.req.header("sec-fetch-site") !== "same-origin") return c.text("Forbidden", 403);
    return c.redirect("/?ok=1", 303);
  });
  app.get("/api/echo", (c) => c.json({ q: c.req.query("q") ?? "" }));
  // No icon in the fixture; an empty answer keeps the console free of the browser's favicon 404.
  app.get("/favicon.ico", (c) => c.body(null, 204));
  if (options.negativeControl) {
    app.get("/neg", (c) => c.html(page(<div style={{ color: "red" }}>negative control</div>, false)));
  }
  return app;
}
