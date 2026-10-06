// Server side of an island: render it in place, mark the container, put its props beside it as JSON.
import type { ComponentType } from "react";
import { assetUrl } from "./manifest.ts";
import { type JsonValue, renderPropsTag } from "./serialiser.ts";

let next = 0;

export function Island<P extends { [k: string]: JsonValue }>(props: {
  source: string;
  component: ComponentType<P>;
  props: P;
}) {
  const { id, json } = renderPropsTag(`island-${next++}`, props.props);
  const Component = props.component;
  return (
    <>
      <div data-island={assetUrl(props.source)} data-props={id}>
        <Component {...props.props} />
      </div>
      <script type="application/json" id={id} dangerouslySetInnerHTML={{ __html: json }} />
    </>
  );
}

/** Island ids restart per page, so the same page renders the same ids. */
export function resetIslandIds(): void {
  next = 0;
}
