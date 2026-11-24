// A GET always redirects to the member's next step (+page.server.ts), and what the route would draw ships no script.
// The page says so itself (book P1.22j), so its answer does not follow the root layout's default; the step that
// switches it on removes the line.
export const csr = false;
