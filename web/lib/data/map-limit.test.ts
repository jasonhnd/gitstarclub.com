import { describe, expect, test } from "bun:test";
import { mapLimit } from "./map-limit";

describe("mapLimit", () => {
  test("preserves order and returns immediately for an empty list", async () => {
    expect(await mapLimit([], 4, async (item: number) => item)).toEqual([]);
    const values = await mapLimit([3, 2, 1], 2, async (item, index) => {
      await new Promise((resolve) => setTimeout(resolve, item));
      return `${index}:${item}`;
    });
    expect(values).toEqual(["0:3", "1:2", "2:1"]);
  });

  test("never runs more than the requested concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapLimit(Array.from({ length: 12 }, (_, index) => index), 3, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item;
    });
    expect(maxInFlight).toBe(3);
  });
});
