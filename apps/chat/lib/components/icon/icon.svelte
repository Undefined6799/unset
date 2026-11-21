<!--
  Icon (P1.20c; decision 33, ADR 0055 point 4): one of our Iconoir 7.12.1 icons, drawn inline from the copied, pinned
  data in shared/ui/icons/icons.json, as the React Icon (gone at P1.20k) drew it. The drawing is always aria-hidden;
  meaning comes from a word beside it or from `label`, a visually hidden span (never role="img").
  `class` passes through so a shadcn-svelte component's own size and colour classes still apply.
-->
<script lang="ts" module>
import data from "@unset/shared-ui/icons.json";

export type IconName = keyof typeof data.drawings;
</script>

<script lang="ts">
  import type { SVGAttributes } from "svelte/elements";

  // The attributes the icon build admits (shared/ui-build/icons.ts), with Iconoir's own values.
  type Path = {
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    strokeLinecap?: SVGAttributes<SVGPathElement>["stroke-linecap"];
    strokeLinejoin?: SVGAttributes<SVGPathElement>["stroke-linejoin"];
  };

  let {
    name,
    size = 20,
    label,
    class: className,
  }: {
    name: IconName;
    /** 20 (default), 16 inside small text, or 24 on its own in a bar. */
    size?: 16 | 20 | 24;
    /** Hidden text read by screen readers; leave out only when a visible word beside it says the same. */
    label?: string;
    class?: string;
  } = $props();

  const paths = $derived((data.drawings as Record<IconName, readonly Path[]>)[name]);
</script>

<svg
  class={className}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke-width="1.5"
  aria-hidden="true"
  focusable="false"
>
  {#each paths as path, index (index)}
    <path
      d={path.d}
      fill={path.fill}
      stroke={path.stroke}
      stroke-width={path.strokeWidth}
      stroke-linecap={path.strokeLinecap}
      stroke-linejoin={path.strokeLinejoin}
    />
  {/each}
</svg>
{#if label !== undefined}<span class="sr-only">{label}</span>{/if}
