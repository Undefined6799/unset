# Engineering rules: Top 15

An excerpt of [`engineering-rules.md`](engineering-rules.md) (decision 35, adopted by Alex 2026-10-04): the rules that matter most for the first slice. CLAUDE.md imports this page only; the full file holds all 48 rules with their sources, checks and triggers. Keep this page identical to the "Top 15" section of the full file; the P0.09 docs test compares them. Where a rule and the plan disagree, the plan wins; where a rule and the Architecture and Development Guideline disagree on structure, that guideline wins.

## Top 15

The rules that matter most for the first slice (sign in, see your own profile). CLAUDE.md imports this page only.

1. **AB-1** Folder dependencies form an allowlist matrix in dependency-cruiser, and any unlisted edge fails. [Clean Architecture ch. 22]
2. **AB-2** Ports exist only for I/O and non-determinism, and adapters are built only in the composition root. [Clean Architecture ch. 26]
3. **DM-1** Every external input is parsed once at the boundary into branded types, and domains never take a bare `string`. [Effective Java Item 49]
4. **DC-4** Expected failures are typed results, and no error is ever swallowed. [Effective Java Items 69, 77]
5. **SE-1** Every `[SEC]` step starts with a one-screen Threats section, and its PR updates the ASVS rows. [Shostack ch. 1]
6. **SE-2** Every id is resolved against `viewer`, hidden reads as missing (private profiles too, D7), and every route ships with a denial test. [OWASP API1:2023]
7. **SE-3** Clients receive only explicit view types, and each output context has a single encoder. [OWASP API3:2023]
8. **SE-7** Logs carry only allowlisted fields: never a DID, IP, handle or token. [SRE ch. 6]
9. **DA-1** Every fact we decide lives in an app-owned schema, and `idx` can be dropped and rebuilt. [DDIA 1st ed., Part III]
10. **DA-4** Each read-decide-write names its concurrency mechanism, and no network I/O runs inside a transaction. [DDIA 1st ed. ch. 7]
11. **RE-1** Every request has a deadline, timeouts nest inside it, and retries happen at one layer only. [SRE ch. 22]
12. **TE-1** No module mocks, and only unmanaged dependencies get doubles. [Khorikov ch. 5]
13. **TE-2** Tests that touch data run against real Postgres, connected as the real per-process role. [Khorikov ch. 10]
14. **TE-5** Every test is written first and shown failing. [Beck TDD ch. 25]
15. **DL-1** One step per PR, under about 400 lines, with refactoring and behaviour changes in separate commits. [Accelerate ch. 4]
