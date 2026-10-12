// The edge image tests' cleanup (P1.11r): every tag is tried even after one removal fails or is killed, and each
// failure names its tag.
import { describe, expect, test } from "vitest";
import { removeEveryTag } from "./image-cleanup.ts";

describe("edge test image cleanup", () => {
  test("every_tag_is_tried_and_each_failure_named", () => {
    const removed: string[] = [];
    const remove = (tag: string) => {
      if (tag !== "unset-edge-test-b") throw new Error("docker rmi killed after 50000 ms");
      removed.push(tag);
    };
    let thrown: unknown;
    try {
      removeEveryTag(["unset-edge-test-a", "unset-edge-test-b", "unset-edge-test-c"], remove);
    } catch (error) {
      thrown = error;
    }
    expect(removed).toEqual(["unset-edge-test-b"]);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "docker rmi unset-edge-test-a failed: docker rmi killed after 50000 ms",
      "docker rmi unset-edge-test-c failed: docker rmi killed after 50000 ms",
    ]);
  });

  test("no_failure_throws_nothing", () => {
    const removed: string[] = [];
    removeEveryTag(["unset-edge-test-a"], (tag) => void removed.push(tag));
    expect(removed).toEqual(["unset-edge-test-a"]);
  });
});
