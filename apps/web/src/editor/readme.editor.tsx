// The owner's README editor entry (ADR 0037 point 5): its own build entry under src/editor/, loaded only by the README
// editor page, never by a profile page, and kept outside the island budget by its own cap (scripts/budgets/island.ts).
import { startReadmeEditor } from "./readme-form.tsx";

startReadmeEditor(document);
