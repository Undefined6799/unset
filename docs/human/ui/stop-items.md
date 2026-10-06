# UI stop items

The UI pieces the plan needed that the design sheet did not have when P1.24's gate first read it (plan §8 Phase 1:
anything missing is a stop item for Alex). Each was drafted on the sheet by the design session and approved by Alex
on its own, and only then built. A piece with no approval keeps `status: "stop"` in `shared/ui/inventory.json`
and is used nowhere in `apps/`. One line per piece: its name, the step that builds it, the sheet draft, and the
approval with its date (UTC) and the sheet version it was published in. `shared/ui/inventory.test.ts` reads this
file.

No stop item is open.

- **Icon** · needed by P1.24i · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-03 18:02Z, sheet v34
- **Avatar** · needed by P1.24s · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-03 18:13Z, sheet v36
- **Switch** · needed by P1.24s · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-03 18:16Z, sheet v37
- **Toast** · needed by P1.24a · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-03 18:18Z, sheet v38
- **SkipLink** · needed by P1.24s · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-03 18:21Z, sheet v39
- **Card** · needed by P1.24a · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-04, sheet v40
- **MediaFrame** · needed by P1.24s · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-04, sheet v41
- **Pagination** · needed by P1.24s · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-04, sheet v44
- **NewPosts** · needed by P1.24a · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-04, sheet v44
- **FeedMore** · needed by P1.24a · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-04, sheet v44
- **DescriptionList** · needed by P1.24s · sheet draft: https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt · approved by Alex 2026-10-04 22:00Z, sheet v45

Card's item is the opaque surface: `surface-card` is solid since v40, so there is no solid variant.
