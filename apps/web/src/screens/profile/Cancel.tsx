// The Cancel button of a card dialog: it closes the <dialog> it sits in, with no script of ours
// (HTML Living Standard, form method="dialog").
import { Button } from "@unset/shared-ui";
import { CARD_EDIT } from "./messages.ts";

export const Cancel = () => (
  <form method="dialog">
    <Button type="submit" variant="standalone">
      {CARD_EDIT.cancel}
    </Button>
  </form>
);
