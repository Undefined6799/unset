<!--
  The notifications page (P2.27b, ADR 0081), as Alex shaped it on the mock-up on 2026-11-21: it fills the window below
  the header, so the footer shows only on scrolling. Dense rows with a checkbox each sit beside the chosen entry's
  detail; the list scrolls on its own. Nothing is removed by looking: an entry goes when it is dismissed (its detail's
  Dismiss, Dismiss selected, or Dismiss all) or after 30 days.

  With no script every part is a plain link or form: a row is a link to `?n=<id>`, its checkbox posts with Dismiss
  selected. With script, choosing a row on a wide screen shows it without a round trip; the split between list and
  detail can be dragged (or moved with the arrow keys) between 2/5 and 3/5 and is kept on this device only; and a row
  whose title is cut off is lifted above the detail, whole, after a short rest of the pointer. On a phone the detail is
  its own screen, reached by following the row's link, so the browser's Back returns to the list.

  Positions are set through the CSSOM (`style.setProperty`), never a style attribute, so the page's CSP holds.
-->
<script lang="ts">
import { onMount } from "svelte";
import type { Attachment } from "svelte/attachments";
import { SvelteSet } from "svelte/reactivity";
import { NOTIFICATIONS as T } from "../../notifications/messages.ts";
import { type ReasonScreen, reasonScreen } from "../../notifications/reasons.ts";
import { type NotificationsView, type NotificationView, shortTime, timeText } from "../../notifications/view.ts";
import { Icon, type IconName } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";
import DismissAll from "./dismiss-all.svelte";
import Tabs from "./tabs.svelte";

let { view, chosen }: { view: NotificationsView | undefined; chosen: string | null } = $props();

const HOME = "/notifications";
const FORM = "notifications-dismiss-selected";
/** The list's share of the split, in percent: each side keeps at least 2/5 (Alex, 2026-11-21). */
const MIN = 40;
const MAX = 60;
const KEY = "unset.notifications.split";
/** How long the pointer rests on a cut-off row before it is lifted, and how near the drag bar it never is. */
const LIFT_DELAY_MS = 400;
const LIFT_QUIET_PX = 40;

type Row = { entry: NotificationView; screen: ReasonScreen };
const rows: Row[] = $derived(
  view?.state === "ready"
    ? view.entries.flatMap((entry) => {
        const screen = reasonScreen(entry.reason);
        return screen === undefined ? [] : [{ entry, screen }];
      })
    : [],
);

// The row shown in the detail: the one picked here, else the one the address names, else the newest. A pick holds only
// while the address still names what it named then: SvelteKit keeps this component across a navigation, so a bell row
// (`?n=` another entry) must win over an earlier pick (https://svelte.dev/docs/kit/state-management).
let picked = $state<{ id: string; under: string | null } | null>(null);
const named = $derived(rows.some((row) => row.entry.id === chosen) ? chosen : null);
const pickedId = $derived(picked !== null && picked.under === chosen ? picked.id : null);
const current = $derived(
  rows.find((row) => row.entry.id === pickedId) ?? rows.find((row) => row.entry.id === named) ?? rows[0],
);
// A phone shows the detail as its own screen only when the address names an entry.
const detailScreen = $derived(named !== null);

let now: Date | undefined = $state();
let mounted = $state(false);
const ticked = new SvelteSet<string>();
const allTicked = $derived(rows.length > 0 && rows.every((row) => ticked.has(row.entry.id)));

let share = $state(MIN);
let split: HTMLElement | undefined = $state();
let list: HTMLElement | undefined = $state();

onMount(() => {
  now = new Date();
  mounted = true;
  try {
    const kept = Number(localStorage.getItem(KEY));
    if (Number.isFinite(kept) && kept >= MIN && kept <= MAX) share = kept;
  } catch {
    // Storage refused (a private window): the split starts at 2/5.
  }
});

const shareStyle: Attachment<HTMLElement> = (node) => {
  node.style.setProperty("--list-share", `${share}%`);
};

function setShare(value: number) {
  share = Math.round(Math.min(MAX, Math.max(MIN, value)));
  try {
    localStorage.setItem(KEY, String(share));
  } catch {
    // Kept for this visit only.
  }
}

let dragging = false;
function startDrag(event: PointerEvent) {
  if (split === undefined) return;
  event.preventDefault();
  dropLift();
  dragging = true;
  const bar = event.currentTarget as HTMLElement;
  bar.setPointerCapture(event.pointerId);
  const box = split.getBoundingClientRect();
  // A move with the button up ends the drag: the release happened where this page could not see it. Firefox 157
  // (Playwright 1.64.1) reports a pointer released outside the window that way, with clientX 0, and sends no
  // pointerup (`buttons`, https://w3c.github.io/pointerevents/#the-buttons-property).
  const move = (e: PointerEvent) => {
    if ((e.buttons & 1) === 0) stop();
    else setShare(((e.clientX - box.left) / box.width) * 100);
  };
  const stop = () => {
    dragging = false;
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", stop);
    bar.removeEventListener("pointercancel", stop);
  };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", stop);
  bar.addEventListener("pointercancel", stop);
}

function nudge(event: KeyboardEvent) {
  const step = { ArrowLeft: -2, ArrowRight: 2, Home: MIN - share, End: MAX - share }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  setShare(share + step);
}

// On a wide screen a row is shown here without a round trip; a phone follows the link, so Back works.
function choose(event: MouseEvent, id: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  if (!matchMedia("(min-width: 48rem)").matches) return;
  event.preventDefault();
  picked = { id, under: chosen };
}

function tick(id: string, on: boolean) {
  if (on) ticked.add(id);
  else ticked.delete(id);
}

function tickAll(on: boolean) {
  ticked.clear();
  if (on) for (const row of rows) ticked.add(row.entry.id);
}

// The lifted row: a copy of a cut-off row drawn above the detail at the row's place, whole.
type Lift = { row: Row; top: number; left: number; width: number; height: number };
let lift: Lift | undefined = $state();
let liftTimer: ReturnType<typeof setTimeout> | undefined;

function dropLift() {
  clearTimeout(liftTimer);
  lift = undefined;
}

function liftFor(row: Row, item: HTMLElement): Lift | undefined {
  const title = item.querySelector<HTMLElement>("[data-title]");
  if (title === null || title.scrollWidth <= title.clientWidth) return undefined;
  const box = item.getBoundingClientRect();
  return { row, top: box.top, left: box.left, width: box.width, height: box.height };
}

function hover(event: PointerEvent, row: Row) {
  if (event.pointerType !== "mouse" || dragging || list === undefined) return;
  const item = event.currentTarget as HTMLElement;
  if (list.getBoundingClientRect().right - event.clientX < LIFT_QUIET_PX) {
    dropLift();
    return;
  }
  if (lift?.row.entry.id === row.entry.id) return;
  dropLift();
  liftTimer = setTimeout(() => {
    lift = liftFor(row, item);
  }, LIFT_DELAY_MS);
}

function focusRow(event: FocusEvent, row: Row) {
  const item = (event.currentTarget as HTMLElement).closest("li");
  if (item !== null && (event.target as HTMLElement).matches(":focus-visible")) lift = liftFor(row, item);
}

const liftPlace: Attachment<HTMLElement> = (node) => {
  if (lift === undefined) return;
  node.style.setProperty("top", `${lift.top - 3}px`);
  node.style.setProperty("left", `${lift.left - 4}px`);
  node.style.setProperty("min-width", `${lift.width + 8}px`);
  node.style.setProperty("height", `${lift.height + 6}px`);
};

// A click on the lifted copy acts on the row under it: its checkbox, or showing it.
function liftClick(event: MouseEvent) {
  if (lift === undefined) return;
  const id = lift.row.entry.id;
  if ((event.target as HTMLElement).closest("input") !== null) {
    tick(id, !ticked.has(id));
    return;
  }
  dropLift();
  if (matchMedia("(min-width: 48rem)").matches) picked = { id, under: chosen };
  else location.assign(`${HOME}?n=${id}`);
}

// A wheel turn on the lifted copy scrolls the list under it, once. The browser would scroll what is under the copy
// when the turn began: the page in WebKit, or the list a second time in Chromium once the copy is gone.
function liftWheel(event: WheelEvent) {
  event.preventDefault();
  dropLift();
  if (list === undefined) return;
  // deltaMode: 0 pixels, 1 lines, 2 pages (https://w3c.github.io/uievents/#dom-wheelevent-deltamode).
  const unit =
    event.deltaMode === 1
      ? Number.parseFloat(getComputedStyle(list).lineHeight) || 16
      : event.deltaMode === 2
        ? list.clientHeight
        : 1;
  list.scrollBy({ top: event.deltaY * unit, left: event.deltaX * unit });
}

function liftLeave(event: PointerEvent) {
  const to = event.relatedTarget as Node | null;
  if (to === null || list === undefined || !list.contains(to)) dropLift();
}

const rowClass =
  "group relative grid min-h-13 grid-cols-[1.5rem_1.375rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-3.5 hover:bg-muted";
const chip = "shrink-0 rounded-full border px-2 text-xs text-muted-foreground";
// 24 px: the smallest target WCAG 2.2 SC 2.5.8 allows (tests/e2e/a11y.spec.ts target_size).
const checkbox = "relative z-10 size-6 accent-primary";
</script>

<!-- The copy is fixed to the window, so a page scroll would leave it beside its row. -->
<svelte:window onresize={dropLift} onscroll={dropLift} />

<section
  class="flex h-[calc(100svh-var(--site-header-height)-4rem)] min-h-[26rem] flex-col gap-3 max-md:h-auto max-md:min-h-[calc(100svh-var(--site-header-height)-4rem)]"
  aria-labelledby="notifications-title"
>
  <h1 id="notifications-title" class="text-3xl leading-tight font-semibold {detailScreen ? 'max-md:sr-only' : ''}">
    {T.title}
  </h1>
  <div class={detailScreen ? "max-md:hidden" : ""}><Tabs current="notifications" /></div>

  {#if view === undefined || view.state === "failed"}
    <p role="alert" class="text-muted-foreground">{T.failed}</p>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      {#if rows.length > 0}
        <div class="flex flex-wrap items-center gap-2 border-b bg-secondary px-3 py-2 text-sm {detailScreen ? 'max-md:hidden' : ''}">
          {#if mounted}
            <input
              type="checkbox"
              class={checkbox}
              aria-label={T.selectAll}
              checked={allTicked}
              onchange={(e) => tickAll(e.currentTarget.checked)}
            />
          {/if}
          <Button type="submit" form={FORM} variant="ghost" size="sm" disabled={mounted && ticked.size === 0}>
            <Icon name="close" size={16} />{T.dismissSelected}
          </Button>
          <span class="ml-auto text-muted-foreground">{T.count(rows.length, view.more)}</span>
          <DismissAll entries={view.entries} returnTo={HOME} variant="outline" />
        </div>
      {/if}

      {#if rows.length === 0}
        <div class="grid flex-1 place-content-center justify-items-center gap-1.5 p-12 text-center text-muted-foreground">
          <span class="grid size-13 place-items-center rounded-md bg-muted"><Icon name="notifications" size={24} /></span>
          <p class="font-medium text-foreground">{T.none}</p>
          <p>{T.noneHint}</p>
        </div>
      {:else}
        <div
          bind:this={split}
          {@attach shareStyle}
          class="grid min-h-0 flex-1 grid-cols-[minmax(0,var(--list-share,40%))_0.5625rem_minmax(0,1fr)] max-md:grid-cols-1"
        >
          <form
            bind:this={list}
            id={FORM}
            method="POST"
            action="{HOME}?/dismiss"
            class="min-h-0 overflow-auto {detailScreen ? 'max-md:hidden' : ''}"
            onscroll={dropLift}
            onpointerleave={(e) => {
              if (!(e.relatedTarget as HTMLElement | null)?.closest("[data-lift]")) dropLift();
            }}
          >
            <input type="hidden" name="return" value={HOME} />
            <ul class="m-0 list-none p-0" aria-label={T.title}>
              {#each rows as row (row.entry.id)}
                {@const { entry, screen } = row}
                <li
                  class="{rowClass} {current?.entry.id === entry.id ? 'md:bg-muted md:shadow-[inset_3px_0_0_var(--color-primary)]' : ''}"
                  onpointermove={(e) => hover(e, row)}
                >
                  <input
                    type="checkbox"
                    name="id"
                    value={entry.id}
                    class={checkbox}
                    aria-label={T.select(screen.title)}
                    checked={ticked.has(entry.id)}
                    onchange={(e) => tick(entry.id, e.currentTarget.checked)}
                  />
                  <Icon name={screen.icon as IconName} size={20} />
                  <a
                    href="{HOME}?n={entry.id}"
                    class="flex min-w-0 items-center gap-2 text-foreground no-underline outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring"
                    aria-current={current?.entry.id === entry.id ? "true" : undefined}
                    onclick={(e) => choose(e, entry.id)}
                    onfocus={(e) => focusRow(e, row)}
                    onblur={dropLift}
                  >
                    <span class="{chip} max-sm:hidden">{screen.kind}</span>
                    <span data-title class="truncate font-medium">{screen.title}</span>
                  </a>
                  <time datetime={entry.sentAt} class="text-right text-sm whitespace-nowrap text-muted-foreground"
                    >{shortTime(entry.sentAt, now)}</time
                  >
                </li>
              {/each}
            </ul>
            {#if view.more}<p class="px-3.5 py-3 text-sm text-muted-foreground">{T.more}</p>{/if}
          </form>

          {#if mounted}
            <!-- A focusable separator is the WAI-ARIA window splitter (APG "Window Splitter" pattern): it takes the
                 arrow keys and the pointer, which Svelte's check for non-interactive roles does not know. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
            <div
              role="separator"
              tabindex="0"
              aria-orientation="vertical"
              aria-label={T.resize}
              aria-valuemin={MIN}
              aria-valuemax={MAX}
              aria-valuenow={share}
              class="group/bar relative cursor-col-resize touch-none outline-none max-md:hidden"
              onpointerdown={startDrag}
              onkeydown={nudge}
              ondblclick={() => setShare(MIN)}
            >
              <span class="absolute inset-y-0 left-1 w-px bg-border group-focus-visible/bar:bg-primary"></span>
              <span
                class="absolute top-1/2 left-0.5 h-8 w-1.5 -translate-y-1/2 rounded-full bg-muted-foreground opacity-35 group-hover/bar:opacity-90 group-focus-visible/bar:opacity-90"
              ></span>
            </div>
          {:else}
            <div class="border-l max-md:hidden" aria-hidden="true"></div>
          {/if}

          {#if current !== undefined}
            {@const { entry, screen } = current}
            <section
              class="flex min-h-0 flex-col gap-3.5 overflow-auto p-7 max-md:p-4 {detailScreen ? '' : 'max-md:hidden'}"
              aria-labelledby="notification-detail-title"
            >
              <a href={HOME} class="inline-flex items-center gap-1.5 self-start text-sm md:hidden"
                ><Icon name="back" size={16} />{T.back}</a
              >
              <span class="grid size-13 place-items-center rounded-md bg-muted"
                ><Icon name={screen.icon as IconName} size={24} /></span
              >
              <h2 id="notification-detail-title" class="text-2xl leading-tight font-semibold">{screen.title}</h2>
              <dl class="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt class="text-muted-foreground">{T.when}</dt>
                <dd class="m-0"><time datetime={entry.sentAt}>{timeText(entry.sentAt, mounted)}</time></dd>
                <dt class="text-muted-foreground">{T.kind}</dt>
                <dd class="m-0">{screen.kind}</dd>
              </dl>
              <p class="max-w-[60ch] text-muted-foreground">{screen.body}</p>
              <div class="flex flex-wrap gap-2">
                <Button href={screen.href}>{screen.action}<Icon name="next" size={16} /></Button>
                <form method="POST" action="{HOME}?/dismiss">
                  <input type="hidden" name="id" value={entry.id} />
                  <input type="hidden" name="return" value={HOME} />
                  <Button type="submit" variant="outline">{T.dismiss}</Button>
                </form>
              </div>
              <p class="text-sm text-muted-foreground">{T.stays}</p>
            </section>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

{#if lift !== undefined}
  {@const { entry, screen } = lift.row}
  <!-- A copy for the pointer only: the row under it keeps its own link and checkbox for keyboards and readers. -->
  <div
    data-lift
    aria-hidden="true"
    {@attach liftPlace}
    class="fixed z-30 grid cursor-pointer grid-cols-[1.5rem_1.375rem_max-content_max-content] items-center gap-3 rounded-lg border bg-card px-3.5 whitespace-nowrap shadow-md motion-safe:animate-in motion-safe:fade-in-0"
    onclick={liftClick}
    onpointerleave={liftLeave}
    onwheel={liftWheel}
    role="presentation"
  >
    <input type="checkbox" tabindex="-1" class={checkbox} checked={ticked.has(entry.id)} />
    <Icon name={screen.icon as IconName} size={20} />
    <span class="flex items-center gap-2"><span class={chip}>{screen.kind}</span><span class="font-medium">{screen.title}</span></span>
    <span class="ml-3 text-sm text-muted-foreground">{shortTime(entry.sentAt, now)}</span>
  </div>
{/if}
