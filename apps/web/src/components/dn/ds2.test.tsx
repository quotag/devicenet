import { useState } from "react";
import { describe, it, expect, vi as vitest, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeInput, sanitizeCode } from "./CodeInput";
import { Toast } from "./Toast";
import { DeviceTile } from "./DeviceTile";
import { Stepper } from "./Stepper";
import { TabBar } from "./TabBar";
import { toastStore } from "@/stores/toast";

afterEach(() => {
  cleanup();
  toastStore.getState().reset();
});

function Harness({ onComplete }: { onComplete?: (c: string) => void }) {
  const [v, setV] = useState("");
  return <CodeInput value={v} onChange={setV} onComplete={onComplete} />;
}
const cells = () => screen.getAllByRole("textbox") as HTMLInputElement[];
const code = () => cells().map((c) => c.value).join("");

describe("CodeInput", () => {
  it("sanitizes: uppercase, only [A-HJ-NP-Z2-9]", () => {
    expect(sanitizeCode("ab-i0o1l 9z")).toBe("ABL9Z");
  });

  it("renders 8 cells, uppercases, rejects excluded chars, auto-advances", () => {
    render(<Harness />);
    expect(cells()).toHaveLength(8);
    fireEvent.change(cells()[0]!, { target: { value: "k" } });
    expect(code()).toBe("K");
    expect(document.activeElement).toBe(cells()[1]);
    fireEvent.change(cells()[1]!, { target: { value: "0" } }); // excluded
    fireEvent.change(cells()[1]!, { target: { value: "O" } }); // excluded
    fireEvent.change(cells()[1]!, { target: { value: "7" } });
    expect(code()).toBe("K7");
    expect(document.activeElement).toBe(cells()[2]);
  });

  it("pastes a whole code and fires onComplete", () => {
    const done = vitest.fn();
    render(<Harness onComplete={done} />);
    fireEvent.paste(cells()[3]!, { clipboardData: { getData: () => "k7m2-9pqr" } });
    expect(code()).toBe("K7M29PQR");
    expect(done).toHaveBeenCalledWith("K7M29PQR");
  });

  it("backspace removes the previous char when the cell is empty", () => {
    render(<Harness />);
    fireEvent.paste(cells()[0]!, { clipboardData: { getData: () => "ABC" } });
    fireEvent.keyDown(cells()[3]!, { key: "Backspace" });
    expect(code()).toBe("AB");
  });

  it("invalid state marks cells and shakes", () => {
    const { container } = render(<CodeInput value="ABCDEFGH" onChange={() => {}} invalid />);
    expect(container.querySelector(".dn-shake")).toBeTruthy();
    expect(container.querySelectorAll(".codecell-bad")).toHaveLength(8);
  });
});

describe("Toast", () => {
  beforeEach(() => vitest.useFakeTimers());
  afterEach(() => vitest.useRealTimers());

  it("is a status region and auto-hides after 4 s", () => {
    render(<Toast />);
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => toastStore.getState().show({ kind: "timeout", text: "Không nhận được phản hồi từ Quạt" }));
    expect(screen.getByText("Không nhận được phản hồi từ Quạt")).toBeTruthy();
    act(() => void vitest.advanceTimersByTime(3900));
    expect(screen.queryByText("Không nhận được phản hồi từ Quạt")).toBeTruthy();
    act(() => void vitest.advanceTimersByTime(200));
    expect(screen.queryByText("Không nhận được phản hồi từ Quạt")).toBeNull();
  });

  it("with an action stays 8 s and runs the action", () => {
    const run = vitest.fn();
    render(<Toast />);
    act(() => toastStore.getState().show({ kind: "update", text: "Có bản mới", action: { label: "Tải lại", run } }));
    act(() => void vitest.advanceTimersByTime(7900));
    expect(screen.getByText("Có bản mới")).toBeTruthy();
    fireEvent.click(screen.getByText("Tải lại"));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByText("Có bản mới")).toBeNull();
  });

  it("shows one at a time: a new toast replaces the current", () => {
    render(<Toast />);
    act(() => toastStore.getState().show({ kind: "error", text: "A" }));
    act(() => toastStore.getState().show({ kind: "error", text: "B" }));
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.getByText("B")).toBeTruthy();
  });
});

describe("DeviceTile", () => {
  it("on: shows Bật, switch checked, labelled with the action", () => {
    const onToggle = vitest.fn();
    const { container } = render(<DeviceTile name="Đèn khách" on onToggle={onToggle} />);
    expect(screen.getByText("Bật")).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Tắt Đèn khách" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector(".dn-tile-on")).toBeTruthy();
    fireEvent.click(sw);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("off: Tắt and label to turn on", () => {
    render(<DeviceTile name="Đèn khách" room="Phòng khách" />);
    expect(screen.getByText("Tắt")).toBeTruthy();
    expect(screen.getByText("Phòng khách")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Bật Đèn khách" }).getAttribute("aria-checked")).toBe("false");
  });

  it("pending: busy and disabled", () => {
    render(<DeviceTile name="Quạt" kind="mixed" value={0} unit="W" pending />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-busy")).toBe("true");
    expect((sw as HTMLButtonElement).disabled).toBe(true);
  });

  it("offline: Offline + last seen, no toggle", () => {
    render(<DeviceTile name="Quạt" on offline lastSeen="12:40" />);
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("lần cuối 12:40")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("sensor: value, no toggle; 2x1 shows extras; highlight and arranging classes", () => {
    const { container } = render(
      <DeviceTile
        name="Nhiệt ẩm"
        kind="sensor"
        value="27,5"
        unit="°C"
        size="2x1"
        extras={[{ value: 228, unit: "V" }]}
        highlight
        arranging
      />,
    );
    expect(screen.getByText("27,5")).toBeTruthy();
    expect(screen.getByText("228")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(container.querySelector(".dn-tile-2x1.dn-tile-highlight.dn-tile-arranging")).toBeTruthy();
  });
});

describe("Stepper / TabBar", () => {
  it("marks done, current and upcoming steps", () => {
    const { container } = render(<Stepper steps={["Nhập mã", "Kết nối", "Xong"]} current={1} />);
    expect(container.querySelector(".dn-step-done .dn-step-dot")?.textContent).toBe("✓");
    expect(container.querySelector("[aria-current='step']")?.textContent).toContain("Kết nối");
  });

  it("TabBar highlights the current tab and shows red dots", () => {
    const onChange = vitest.fn();
    render(<TabBar value="home" onChange={onChange} dots={{ me: true }} disabled={{ automate: true }} />);
    expect(screen.getByText("Home").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("tab-dot-me")).toBeTruthy();
    const automateBtn = screen.getByText("Automate").closest("button");
    expect(automateBtn).toBeDisabled();
    expect(automateBtn?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByText("Automate"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Me"));
    expect(onChange).toHaveBeenCalledWith("me");
  });
});
