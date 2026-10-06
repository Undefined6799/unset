# P1.16: the `single_use_expires_at` index (PF-1)

Source: `run.sh` in this folder (sha256 `acc697a78d2922ed4cc1cb80673cb75d52d0ce29a135c9864775e837fe3e02c6`), run
2026-10-06 against the pinned `postgres:18` (18.6) image digest from `tests/support/postgres.ts`.

The sweep's `DELETE FROM app.single_use WHERE expires_at < now() - interval '1 day'` on 200,000 rows, timed by
`EXPLAIN ANALYZE` inside a rolled-back transaction, so every run sees the same table. 200 runs without the index,
then 200 with it.

| Scenario | Rows past the line | Without index (p50 / p95 / p99) | With index (p50 / p95 / p99) |
| --- | --- | --- | --- |
| Daily sweep (`SPAN_H=25`) | 7,695 | 33.87 / 45.41 / 58.54 ms | 4.51 / 7.56 / 7.95 ms |
| Missed day (`SPAN_H=48`) | 97,960 | 79.10 / 179.15 / 207.67 ms | 54.97 / 72.55 / 87.10 ms |
