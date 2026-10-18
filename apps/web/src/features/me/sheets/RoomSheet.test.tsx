import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteId } from "@devicenet/shared";
import { resetAll, uiStore } from "@/stores";
import { TransportProvider } from "@/transport/TransportProvider";
import { createFakeTransport } from "../../../../test/fakeTransport";
import { RoomSheet } from "./RoomSheet";

const siteId = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ" as SiteId;

beforeEach(() => resetAll());
afterEach(cleanup);

describe("SH-5 newRoom", () => {
  it("disables submit when empty, creates the room and reports its id", async () => {
    const onCreated = vi.fn();
    const t = createFakeTransport({
      sites: [{ id: siteId, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 } as never],
    });
    uiStore.getState().openSheet({ kind: "sh5", mode: "newRoom", siteId });
    render(
      <TransportProvider transport={t}>
        <RoomSheet mode="newRoom" siteId={siteId} onCreated={onCreated} />
      </TransportProvider>,
    );
    const submit = screen.getByRole("button", { name: "Thêm room" });
    expect(submit).toBeDisabled();
    expect(screen.getByText("Trong site Nhà")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tên room"), { target: { value: "  Phòng làm việc " } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(t.writeCalls[0]).toMatchObject({ op: "createRoom", siteId, name: "Phòng làm việc" });
    expect(uiStore.getState().sheet).toBeNull();
  });
});
