import { describe, expect, test } from "bun:test";
import { LatestRequestController } from "./latest-request";

describe("LatestRequestController", () => {
  test("aborts obsolete work and rejects a stale completion", () => {
    const requests = new LatestRequestController();
    const first = requests.begin();
    const second = requests.begin();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(requests.isCurrent(first.id)).toBe(false);
    expect(requests.isCurrent(second.id)).toBe(true);
  });

  test("an old cleanup cannot cancel a newer request", () => {
    const requests = new LatestRequestController();
    const first = requests.begin();
    const second = requests.begin();

    requests.cancel(first.id);
    expect(second.signal.aborted).toBe(false);
    expect(requests.isCurrent(second.id)).toBe(true);

    requests.cancel(second.id);
    expect(second.signal.aborted).toBe(true);
    expect(requests.isCurrent(second.id)).toBe(false);
  });

  test("a late stale response cannot overwrite the accepted newer response", async () => {
    const requests = new LatestRequestController();
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    const firstResponse = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    let accepted = "";

    const first = requests.begin();
    const applyFirst = firstResponse.then((value) => {
      if (requests.isCurrent(first.id)) accepted = value;
    });
    const second = requests.begin();
    const applySecond = secondResponse.then((value) => {
      if (requests.isCurrent(second.id)) accepted = value;
    });

    resolveSecond("newer");
    await applySecond;
    resolveFirst("stale");
    await applyFirst;

    expect(accepted).toBe("newer");
  });
});
