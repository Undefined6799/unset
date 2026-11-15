// The age step (P2.12). Three empty fields and no hint of a threshold. The server stores the outcome, never the date.
// P2.12e: every valid date is shown back once before it counts, whatever it is, so a slip of the keyboard can be
// corrected and the question still tells nobody which answers pass.
import { Button, Input, Link, safeHref } from "@unset/shared-ui";
import { WELCOME } from "./messages.ts";

export type AgeProps = {
  /** The date the person entered, to confirm. Absent on the first view. It lives only in this page's form. */
  readonly confirm?: { readonly year: number; readonly month: number; readonly day: number };
};

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function Age({ confirm }: AgeProps) {
  if (confirm === undefined) {
    return (
      <>
        <h1>{WELCOME.ageTitle}</h1>
        <form method="post" action="/welcome/age">
          <Input label={WELCOME.day} name="day" type="text" inputMode="numeric" autoComplete="off" />
          <Input label={WELCOME.month} name="month" type="text" inputMode="numeric" autoComplete="off" />
          <Input label={WELCOME.year} name="year" type="text" inputMode="numeric" autoComplete="off" />
          <Button type="submit">{WELCOME.continue}</Button>
        </form>
      </>
    );
  }
  const change = safeHref("/welcome/age", ["path"]);
  const entered = LONG_DATE.format(new Date(Date.UTC(confirm.year, confirm.month - 1, confirm.day)));
  return (
    <>
      <h1>{WELCOME.ageConfirmTitle}</h1>
      <p>{`${WELCOME.ageConfirmLead} ${entered}.`}</p>
      <form method="post" action="/welcome/age">
        <input type="hidden" name="day" value={confirm.day} />
        <input type="hidden" name="month" value={confirm.month} />
        <input type="hidden" name="year" value={confirm.year} />
        <input type="hidden" name="confirmed" value="yes" />
        <Button type="submit">{WELCOME.ageConfirm}</Button>
      </form>
      {change === null ? null : (
        <p>
          <Link href={change} variant="standalone">
            {WELCOME.ageChange}
          </Link>
        </p>
      )}
    </>
  );
}
