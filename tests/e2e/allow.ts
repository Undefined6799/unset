// axe disables nothing unless a rule, a selector, a reason and an unexpired date say so (P1.26).

export type AxeAllowance = {
  readonly id: string;
  readonly selector: string;
  readonly reason: string;
  readonly expires: string;
};

/**
 * One false positive. Pagination's inactive step is a span (`Pagination.tsx` Step), which
 * WCAG 2.2 SC 1.4.3 exempts as an inactive user interface component. axe-core 4.13.0 still
 * reports color-contrast on its `line-strong` colour. The selector is scopedName("off") for
 * Pagination.module.css.
 */
export const AXE_ALLOWANCE: readonly AxeAllowance[] = [
  {
    id: "color-contrast",
    selector: ".off_cd8c1da0",
    reason: "Inactive pagination step. WCAG 2.2 SC 1.4.3 exempts it; axe-core 4.13.0 does not.",
    expires: "2027-04-17",
  },
];

const DATED = /^\d{4}-\d{2}-\d{2}$/;

export function expiredAllowances(allowance: readonly AxeAllowance[], today: string): readonly AxeAllowance[] {
  return allowance.filter((entry) => !DATED.test(entry.expires) || entry.expires < today);
}

type AxeNode = { readonly target: readonly unknown[] };
export type AxeViolation = { readonly id: string; readonly nodes: readonly AxeNode[] };

/** Violations that no unexpired allowance covers. An allowance hides one rule on one selector. */
export function unallowedViolations(
  violations: readonly AxeViolation[],
  allowance: readonly AxeAllowance[],
  today: string,
): AxeViolation[] {
  const active = allowance.filter((entry) => DATED.test(entry.expires) && entry.expires >= today);
  return violations.flatMap((violation) => {
    const nodes = violation.nodes.filter((node) => {
      const target = JSON.stringify(node.target);
      return !active.some((entry) => entry.id === violation.id && target.includes(entry.selector));
    });
    return nodes.length === 0 ? [] : [{ id: violation.id, nodes }];
  });
}
