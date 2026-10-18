import { describe, expect, it, vi as vitest } from "vitest";
import { toastStore } from "@/stores/toast";
import { announceUpdate } from "./pwa";

describe("pwa", () => {
  it("announces an update toast whose action reloads", () => {
    const reload = vitest.fn();
    announceUpdate(reload);
    const t = toastStore.getState().current!;
    expect(t.kind).toBe("update");
    expect(t.text).toBe("Có bản mới");
    t.action!.run();
    expect(reload).toHaveBeenCalled();
    toastStore.getState().reset();
  });
});
