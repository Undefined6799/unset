<!--
  A carousel's scrolling area (staging walkthrough 2026-11-18, finding 5; Alex's staging report the same day). With no
  script it is a named stop the keyboard reaches, and its arrow keys scroll it (WCAG 2.1.1; axe
  scrollable-region-focusable). Once the page's script runs, Previous and Next buttons as in the profile-card mockup
  scroll it by one tile; each is off at its own end, and neither shows while every tile fits.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { CARD_TEXT } from "../../profile/messages.ts";
import { Icon } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";

let { title, list }: { title: string; list: Snippet } = $props();

let region = $state<HTMLElement>();
/** Whether the page runs script: false while the server renders and until the first effect runs in the browser. */
let hydrated = $state(false);
let atStart = $state(true);
let atEnd = $state(true);

$effect(() => {
  hydrated = true;
  const node = region;
  if (node === undefined) return;
  measure();
  const resized = new ResizeObserver(measure);
  resized.observe(node);
  // An edit in place can add entries without the region changing size; its scroll width then changes unseen.
  const edited = new MutationObserver(measure);
  edited.observe(node, { childList: true, subtree: true, characterData: true });
  node.addEventListener("scroll", measure, { passive: true });
  for (const kind of TAKE_OVER) node.addEventListener(kind, forget, { passive: true });
  return () => {
    resized.disconnect();
    edited.disconnect();
    node.removeEventListener("scroll", measure);
    for (const kind of TAKE_OVER) node.removeEventListener(kind, forget);
  };
});

/** Where the last press is scrolling to, so presses made before the smooth scroll ends add up instead of restarting. */
let target: number | undefined;
/** The person's own scrolling, which takes over from a press still under way, so the next press starts from there. */
const TAKE_OVER = ["pointerdown", "wheel", "touchstart", "keydown"] as const;
function forget() {
  target = undefined;
}

/** The ends, with a pixel to spare for the rounding snap scrolling leaves. */
function measure() {
  if (region === undefined) return;
  atStart = region.scrollLeft <= 1;
  atEnd = region.scrollLeft + region.clientWidth >= region.scrollWidth - 1;
  if (target !== undefined && Math.abs(region.scrollLeft - target) <= 1) target = undefined;
}

/** Moves by one tile and the gap after it, from the tile the last press was heading to. */
function step(direction: -1 | 1) {
  const tile = region?.querySelector("li");
  if (region === undefined || tile == null) return;
  const gap = Number.parseFloat(getComputedStyle(tile.parentElement ?? tile).columnGap) || 0;
  const pitch = tile.getBoundingClientRect().width + gap;
  if (pitch <= 0) return;
  const from = Math.round((target ?? region.scrollLeft) / pitch);
  const end = region.scrollWidth - region.clientWidth;
  target = Math.min(Math.max((from + direction) * pitch, 0), end);
  // An explicit smooth scroll overrides the reduced-motion rule in app.css, so honour the preference here too.
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  region.scrollTo({ left: target, behavior: still ? "instant" : "smooth" });
}

const regionId = $props.id();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={region}
  id={regionId}
  role="region"
  aria-label={CARD_TEXT.carousel(title)}
  tabindex="0"
  class="snap-x snap-mandatory overflow-x-auto rounded-sm pb-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
>
  {@render list()}
</div>
{#if hydrated && !(atStart && atEnd)}
  <div class="flex justify-end gap-1">
    <Button
      variant="outline"
      size="icon-sm"
      aria-controls={regionId}
      disabled={atStart}
      onclick={() => step(-1)}><Icon name="back" size={16} label={CARD_TEXT.previous(title)} /></Button
    >
    <Button variant="outline" size="icon-sm" aria-controls={regionId} disabled={atEnd} onclick={() => step(1)}
      ><Icon name="next" size={16} label={CARD_TEXT.next(title)} /></Button
    >
  </div>
{/if}
