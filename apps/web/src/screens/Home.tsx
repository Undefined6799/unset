// The core homepage is deliberately bare. Its heading remains available to assistive technology.
import { HOME } from "../shell/messages.ts";

export function Home() {
  return <h1 className="visually-hidden">{HOME.heading}</h1>;
}
