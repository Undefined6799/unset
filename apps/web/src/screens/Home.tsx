// The landing page's placeholder (P1.25): its real content is not booked yet.
import { HOME } from "../shell/messages.ts";

export function Home() {
  return (
    <>
      <h1>{HOME.heading}</h1>
      <p>{HOME.lead}</p>
    </>
  );
}
