/** The class attribute of a component: its own classes and the caller's, skipping the ones not set. */
export function classNames(...names: readonly (string | false | undefined)[]): string {
  return names.filter((name) => typeof name === "string" && name !== "").join(" ");
}
