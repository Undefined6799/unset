# AI system record

This is the one-page record of the automated content review (plan §5.8 "Reviewed before going public", §6.1, decision
30). It is filled as far as is known now and completed in Phase 4 (P4.08 image gate, P4.09 transcript, P4.09a text
gate). A field that is not known yet reads `TBD (Phase 4)`. `scripts/docs/compliance.test.ts` checks that every field is
present, and with `STRICT=1` (launch gate L.03) that none is `TBD`. The sections follow ISO/IEC 42001 headings (plan
§6.1: the certification track is kept on paper).

## Context and purpose

| Field | Value |
|---|---|
| Purpose | Check public posts automatically before they are written to the user's repository. A pass publishes, a clear fail is blocked with the reason and an appeal, and anything uncertain goes to a person (plan §5.8, decision 6). |
| Inputs | Video frames, images, caption, alt text, captions text, the local transcript, post text and comment text. |
| Where it runs | Every model runs in the no-network compute container (plan §5.2, decision 30). |
| Processors and transfers | None. No post content leaves our servers for moderation, and nothing is sent to Anthropic or any model provider (Alex answer 30b). Enabling P4.10 later would add a processor and a transfer, and this row would change first. |
| Retention | Scores only, kept with the draft and deleted with it (plan §6: abandoned drafts 30 days). |
| Notice shown to users | TBD (Phase 4). Plan §5.8 fixes the substance: posts are checked automatically on our own servers before they go live, and a person sees anything the check is unsure about. |

## Models

Each model file is pinned by SHA-256 with its thresholds in the repository (plan §5.8).

| Model | Name | Version | sha256 | Threshold |
|---|---|---|---|---|
| nudity | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) |
| gore | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) |
| Detoxify | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) |
| Llama Guard 3 1B | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) |
| whisper.cpp | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) | TBD (Phase 4) |

| Field | Value |
|---|---|
| Policy-text version | TBD (Phase 4) |

## Performance evaluation

Each rate is measured per category and per language (EN, FR) on 200 or more labelled items, before first use.

| Field | Value |
|---|---|
| False-positive rate | TBD (Phase 4) |
| False-negative rate | TBD (Phase 4) |
| S4 rate | TBD (Phase 4) |
| Labelled items: provenance and consent | TBD (Phase 4) |

## Human oversight

| Field | Value |
|---|---|
| Human reviewer | TBD (Phase 4) |
| Appeal route | A statement of reasons says the decision used automated means and names the appeal route (DSA Art. 17). A person decides every appeal; it is never re-run through a model (plan §5.8). |

## Change control

| Field | Value |
|---|---|
| Change control | Any change to a model, threshold or policy text means re-measuring the rates above before the change is used. |
