import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubId, HubStatus, SiteId } from "@devicenet/shared";
import { connectionStore, resetAll, sessionStore } from "@/stores";
import { TransportProvider } from "@/transport/TransportProvider";
import { createFakeTransport } from "../../../../test/fakeTransport";
import { StepCode } from "./StepCode";
import { StepConnect } from "./StepConnect";
import { StepInstall } from "./StepInstall";

const site = "site_01HZZZZZZZZZZZZZZZZZZZZZZZ" as SiteId;
const hubId = "hub_01HZZZZZZZZZZZZZZZZZZZZZZZ" as HubId;
const CODE = "K7M2X9A4";
const ApiError = class extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
};

const wrap = (ui: React.ReactNode, t = createFakeTransport({ sites: [{ id: site, name: "Nhà", timezone: "Asia/Ho_Chi_Minh", order: 0, createdAt: 1 }] })) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    t,
    ...render(
      <QueryClientProvider client={qc}>
        <TransportProvider transport={t}>{ui}</TransportProvider>
      </QueryClientProvider>,
    ),
  };
};

function typeCode(code: string) {
  const first = screen.getAllByRole("textbox")[0]!;
  fireEvent.paste(first, { clipboardData: { getData: () => code } });
}

beforeEach(() => resetAll());
afterEach(cleanup);

describe("StepInstall", () => {
  it("switches OS command and copies", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const next = vi.fn();
    render(<StepInstall onNext={next} />);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép lệnh" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${window.location.origin}/agent/install.ps1`));
    fireEvent.click(screen.getByText("Linux"));
    fireEvent.click(screen.getByRole("button", { name: "Sao chép lệnh" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`${window.location.origin}/agent/install.sh`));
    fireEvent.click(screen.getByText("Tôi đã cài"));
    expect(next).toHaveBeenCalled();
  });
});

describe("StepCode", () => {
  it("claims with code/siteId/name and reports hubId", async () => {
    const claim = vi.fn().mockResolvedValue(hubId);
    const onClaimed = vi.fn();
    wrap(<StepCode siteId={site} siteName="Nhà" claim={claim} onClaimed={onClaimed} />);
    expect(screen.getByRole("button", { name: "Kết nối" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quét QR trên trang setup" })).toBeEnabled();
    typeCode(CODE);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));
    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith(hubId));
    expect(claim).toHaveBeenCalledWith({ code: CODE, siteId: site, name: "Hub Nhà" });
  });

  it("400 → invalid state keeps the code; retry resubmits", async () => {
    const claim = vi.fn().mockRejectedValueOnce(new ApiError(400, "EXPIRED", "x")).mockResolvedValue(hubId);
    const onClaimed = vi.fn();
    wrap(<StepCode siteId={site} siteName="Nhà" claim={claim} onClaimed={onClaimed} />);
    typeCode(CODE);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));
    expect(await screen.findByText("Mã không đúng hoặc đã hết hạn")).toBeInTheDocument();
    expect(screen.getByText("Lấy mã mới ở hub")).toBeInTheDocument();
    expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("K");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(onClaimed).toHaveBeenCalled());
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("'Tôi đã có mã mới' clears the code", async () => {
    const claim = vi.fn().mockRejectedValue(new ApiError(400, "EXPIRED", "x"));
    wrap(<StepCode siteId={site} siteName="Nhà" claim={claim} onClaimed={vi.fn()} />);
    typeCode(CODE);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tôi đã có mã mới" }));
    expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Mã không đúng hoặc đã hết hạn")).toBeNull();
  });

  it("409 → belongs-to-other-account explanation", async () => {
    const claim = vi.fn().mockRejectedValue(new ApiError(409, "HUB_BELONGS_TO_OTHER_TENANT", "x"));
    wrap(<StepCode siteId={site} siteName="Nhà" claim={claim} onClaimed={vi.fn()} />);
    typeCode(CODE);
    fireEvent.click(screen.getByRole("button", { name: "Kết nối" }));
    expect(await screen.findByText("Hub này thuộc tài khoản khác. Reset hub rồi lấy mã mới.")).toBeInTheDocument();
    expect(screen.getByText("devicenet-agent reset")).toBeInTheDocument();
  });
});

describe("StepConnect", () => {
  const online = { v: 1, ts: 1, seq: 1, online: true, agentVersion: "1.2.0", z2m: "online", lanUrl: "http://192.168.1.20:8080" } as HubStatus;

  it("waits, then goes online from MQTT status and renames hub on finish", async () => {
    sessionStore.setState({ mode: "cloud", status: "ready" });
    const onDone = vi.fn();
    const { t } = wrap(<StepConnect hubId={hubId} initialSiteId={site} onDone={onDone} />);
    expect(screen.getByText("Đang chờ hub")).toBeInTheDocument();
    expect(screen.queryByText("Hoàn tất")).toBeNull();
    act(() => connectionStore.getState().setHubStatus(hubId, online));
    expect(await screen.findByText("Hub đã online")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.20:8080")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tất" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("home"));
    expect(t.writeCalls.some((c) => c.op === "renameHub" && c.name === "Hub Nhà")).toBe(true);
  });

  it("shows a hint after 60 s offline", async () => {
    vi.useFakeTimers();
    try {
      wrap(<StepConnect hubId={hubId} initialSiteId={site} onDone={vi.fn()} slowMs={60_000} />);
      expect(screen.queryByRole("alert")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(60_001);
      });
      expect(screen.getByRole("alert")).toHaveTextContent("60 giây");
    } finally {
      vi.useRealTimers();
    }
  });
});
