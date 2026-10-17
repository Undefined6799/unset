// The chat placeholder (P2.12). Continuing marks onboarding done. P6.17 replaces this screen; the state value stays.
import { Button } from "@unset/shared-ui";
import { WELCOME } from "./messages.ts";

export function ChatLater() {
  return (
    <>
      <h1>{WELCOME.chatTitle}</h1>
      <p>{WELCOME.chatLead}</p>
      <form method="post" action="/welcome/chat">
        <Button type="submit">{WELCOME.continue}</Button>
      </form>
    </>
  );
}
