import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Server } from "lucide-react";
import { useStore } from "zustand";
import type { HubId } from "@devicenet/shared";
import { Banner } from "@/components/dn/Banner";
import { Button } from "@/components/dn/Button";
import { Input } from "@/components/dn/Input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { relativeTime } from "@/lib/format";
import { vi } from "@/i18n/vi";
import { configStore, toastStore } from "@/stores";
import { useConfigWrites, useHubStatus } from "@/transport/hooks";
import { hhmm } from "./history";

const m = vi.me;

/** `DELETE /v1/hubs/{hubId}` (204). Lazy import keeps env parsing out of module load. */
export async function removeHubApi(hubId: string): Promise<void> {
  const { getApi } = await import("@/lib/api");
  await getApi().DELETE("/v1/hubs/{hubId}", { params: { path: { hubId } } });
}

const dlgStyle = {
  position: "fixed",
  left: 24,
  right: 24,
  top: "50%",
  transform: "translateY(-50%)",
  zIndex: 60,
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 16,
} as const;

export interface HubDetailScreenProps {
  hubId: string;
  removeHub?: (hubId: string) => Promise<void>;
  now?: () => number;
}

/** S-03 Chi tiet hub: info, LAN address, versions, Doi ten, Go hub (confirm + checkbox). */
export function HubDetailScreen({ hubId, removeHub = removeHubApi, now = Date.now }: HubDetailScreenProps) {
  const navigate = useNavigate();
  const hub = useStore(configStore, (s) => s.hubs[hubId as HubId]);
  const siteName = useStore(configStore, (s) => s.sites.find((x) => x.id === hub?.siteId)?.name);
  const deviceCount = useStore(configStore, (s) =>
    Object.values(s.devices).filter((d) => d.status === "active" && d.siteId === hub?.siteId).length,
  );
  const ruleCount = useStore(configStore, (s) => Object.keys(s.rules).length);
  const sceneCount = useStore(configStore, (s) => Object.keys(s.scenes).length);
  const status = useHubStatus(hub?.id);
  const writes = useConfigWrites();
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

  const back = () => void navigate({ to: "/me" });
  const header = (title: string) => (
    <header className="hdr">
      <div className="hdr-l">
        <button className="ibtn" type="button" aria-label={m.back} onClick={back}>
          <ArrowLeft className="ic" aria-hidden="true" />
        </button>
        <h1 className="title" style={{ fontSize: 17 }}>{title}</h1>
      </div>
      <div className="hdr-r" />
    </header>
  );
  if (!hub) return header(m.hub);

  const online = status.online;
  const lanUrl = status.lanUrl;
  const doRemove = async () => {
    if (!ack || busy) return;
    setBusy(true);
    try {
      await removeHub(hub.id);
      setConfirm(false);
      back();
    } catch {
      toastStore.getState().show({ kind: "error", text: m.removeError });
    } finally {
      setBusy(false);
    }
  };
  const doRename = async () => {
    const n = name.trim();
    if (!n || !writes || busy) return;
    setBusy(true);
    try {
      await writes.renameHub(hub.id, n);
      setRenaming(false);
    } catch {
      toastStore.getState().show({ kind: "error", text: m.renameError });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {header(hub.name)}
      {!online ? <Banner kind="offline">{vi.banner.hubOffline(hub.name, hhmm(status.lastSeen))}</Banner> : null}
      <div className="body" style={{ gap: 20, padding: "24px 16px 0", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{ width: 56, height: 56, borderRadius: 16, background: "var(--on-tint)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}
          >
            <Server className="ic" aria-hidden="true" style={{ width: 32, height: 32 }} />
          </span>
          <div className="row-main">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot" style={{ background: online ? "var(--success)" : "var(--danger)", width: 8, height: 8 }} aria-hidden="true" />
              <span style={{ fontSize: 24, lineHeight: "28px", fontWeight: 600 }}>{online ? m.hubOnline : m.hubOffline}</span>
            </span>
            <span className="cap dn-num">
              {online ? m.updatedAgo(status.lastSeen ? relativeTime(status.lastSeen, now()) : "") : m.lastSeen(hhmm(status.lastSeen))}
            </span>
          </div>
        </div>

        <div>
          <p className="cap" style={{ margin: "0 0 8px" }}>{m.info}</p>
          <div className="list" style={{ margin: 0 }}>
            <div className="kv"><span className="cap">{m.name}</span><span className="lbl">{hub.name}</span></div>
            <div className="kv"><span className="cap">{m.site}</span><span className="lbl">{siteName ?? ""}</span></div>
            <div className="kv"><span className="cap">{m.devices}</span><span className="lbl dn-num">{deviceCount}</span></div>
            <div className="kv"><span className="cap">{m.automationScene}</span><span className="lbl dn-num">{`${ruleCount} · ${sceneCount}`}</span></div>
          </div>
        </div>

        <div>
          <p className="cap" style={{ margin: "0 0 8px" }}>{m.connection}</p>
          <div className="list" style={{ margin: 0 }}>
            <div className="row">
              <span className="row-main">
                <span className="lbl">{m.lanAddress}</span>
                <span className="cap dn-num">{lanUrl ? `${lanUrl} · ${m.lanNote}` : m.lanNone}</span>
              </span>
              <Button variant="secondary" disabled={!lanUrl} onClick={() => lanUrl && window.open(lanUrl, "_blank")}>
                {m.open}
              </Button>
            </div>
          </div>
        </div>

        <div>
          <p className="cap" style={{ margin: "0 0 8px" }}>{m.versions}</p>
          <div className="list" style={{ margin: 0 }}>
            <div className="kv"><span className="cap">{m.agent}</span><span className="lbl dn-num">{status.agentVersion ? `v${status.agentVersion}` : "-"}</span></div>
            <div className="kv"><span className="cap">{m.z2m}</span><span className="lbl dn-num">{hub.z2mVersion ?? status.status?.z2mVersion ?? "-"}</span></div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 32 }}>
          <Button
            variant="secondary"
            block
            disabled={!writes}
            onClick={() => {
              setName(hub.name);
              setRenaming(true);
            }}
          >
            {m.rename}
          </Button>
          <Button variant="danger" block onClick={() => { setAck(false); setConfirm(true); }}>
            {m.remove}
          </Button>
        </div>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogPortal>
          <DialogOverlay className="scrim" />
          <DialogContent className="card" style={dlgStyle}>
            <DialogTitle className="lbl" style={{ fontSize: 20, lineHeight: "26px", fontWeight: 600, whiteSpace: "normal" }}>{m.renameTitle}</DialogTitle>
            <DialogDescription className="sr-only">{m.renameTitle}</DialogDescription>
            <Input label={m.renameLabel} value={name} onChange={setName} maxLength={60} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" style={{ flex: 1 }} onClick={() => setRenaming(false)}>{m.keep}</Button>
              <Button variant="primary" style={{ flex: 1 }} disabled={!name.trim()} loading={busy} onClick={() => void doRename()}>{m.save}</Button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogPortal>
          <DialogOverlay className="scrim" />
          <DialogContent className="card" style={{ ...dlgStyle, background: "var(--danger-tint)", borderColor: "var(--danger)" }}>
            <DialogTitle className="lbl" style={{ fontSize: 20, lineHeight: "26px", fontWeight: 600, whiteSpace: "normal" }}>{m.removeTitle(hub.name)}</DialogTitle>
            <DialogDescription className="body-t">{m.removeBody(deviceCount, ruleCount)}</DialogDescription>
            <label style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, cursor: "pointer" }}>
              <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} aria-label={m.removeAck} />
              <span className="body-t">{m.removeAck}</span>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" style={{ flex: 1 }} onClick={() => setConfirm(false)}>{m.keep}</Button>
              <Button variant="danger" style={{ flex: 1 }} disabled={!ack} loading={busy} onClick={() => void doRemove()}>{m.remove}</Button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}
