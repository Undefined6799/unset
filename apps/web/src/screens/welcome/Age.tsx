// The age step (P2.12). Three empty fields and no hint of a threshold. The server stores the outcome, never the date.
import { Button, Input } from "@unset/shared-ui";
import { WELCOME } from "./messages.ts";

export function Age() {
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
