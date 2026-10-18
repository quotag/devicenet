import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { HubId } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { Chip } from "@/components/dn/Chip";
import { Input } from "@/components/dn/Input";
import { vi } from "@/i18n/vi";
import { useConfigWrites, useHubStatus, useSites } from "@/transport/hooks";

const t = vi.s10;
const SLOW_MS = 60_000;

export interface StepConnectProps {
  hubId: string;
  initialSiteId: string;
  onDone: (next: "home" | "device") => void;
  slowMs?: number;
}

export function StepConnect({ hubId, initialSiteId, onDone, slowMs = SLOW_MS }: StepConnectProps) {
  const hub = useHubStatus(hubId as HubId);
  const sites = useSites();
  const writes = useConfigWrites();
  const [slow, setSlow] = useState(false);
  const [siteId, setSiteId] = useState(initialSiteId);
  const siteName = sites.find((s) => s.id === siteId)?.name ?? "";
  const [name, setName] = useState(t.defaultHubName(siteName));
  const [nameTouched, setNameTouched] = useState(false);
  const [addingSite, setAddingSite] = useState(false);
  const [newSite, setNewSite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (hub.online) return;
    const id = setTimeout(() => setSlow(true), slowMs);
    return () => clearTimeout(id);
  }, [hub.online, slowMs]);

  useEffect(() => {
    if (!nameTouched) setName(t.defaultHubName(siteName));
  }, [siteName, nameTouched]);

  const addSite = async () => {
    const n = newSite.trim();
    if (!n || !writes) return;
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh";
      const id = await writes.createSite(n, tz, sites.length);
      setSiteId(id);
      setAddingSite(false);
      setNewSite("");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const finish = async (next: "home" | "device") => {
    setBusy(true);
    setError(false);
    try {
      await writes?.renameHub(hubId as HubId, name.trim() || t.defaultHubName(siteName), siteId);
      onDone(next);
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  const lines = t.statusLines;
  const lanHost = hub.lanUrl?.replace(/^https?:\/\//, "");

  return (
    <>
      <div className="body" style={{ gap: 20, padding: "16px 16px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "12px 0" }}>
          {hub.online ? (
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 999,
                background: "var(--success-tint)",
                color: "var(--success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Check className="ic ic-lg" aria-hidden="true" />
            </div>
          ) : (
            <span className="dn-spin" aria-hidden="true" />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
            <span className="lbl" style={{ fontSize: 20, lineHeight: "26px", fontWeight: 600 }} role="status">
              {hub.online ? t.online : lines[1]}
            </span>
            <p className="cap">{lines.join(" → ")}</p>
            {!hub.online && slow && (
              <p className="cap" role="alert">
                {t.slowHint}
              </p>
            )}
          </div>
        </div>
        {hub.online && (
          <>
            <div className="list" style={{ margin: 0 }}>
              <div className="kv">
                <span className="cap">{t.agentVersion}</span>
                <span className="lbl dn-num">{hub.agentVersion ?? "—"}</span>
              </div>
              <div className="kv">
                <span className="cap">{t.lanAddress}</span>
                <span className="lbl dn-num">{lanHost ?? "—"}</span>
              </div>
              <div className="kv">
                <span className="cap">{t.z2m}</span>
                <span className="lbl dn-num">{hub.z2m ?? "—"}</span>
              </div>
            </div>
            <Input
              label={t.hubName}
              value={name}
              maxLength={60}
              onChange={(v) => {
                setNameTouched(true);
                setName(v);
              }}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="lbl">{t.site}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {sites.map((s) => (
                  <Chip key={s.id} selected={s.id === siteId} onClick={() => setSiteId(s.id)}>
                    {s.name}
                  </Chip>
                ))}
                {writes && (
                  <Chip add onClick={() => setAddingSite(true)}>
                    {t.newSite}
                  </Chip>
                )}
              </div>
              {addingSite && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <Input label={t.newSiteName} value={newSite} onChange={setNewSite} style={{ flex: 1 }} />
                  <Button variant="secondary" disabled={!newSite.trim() || busy} onClick={() => void addSite()}>
                    {t.addSite}
                  </Button>
                </div>
              )}
            </div>
            {error && (
              <p className="cap" style={{ color: "var(--danger)" }} role="alert">
                {t.saveError}
              </p>
            )}
          </>
        )}
      </div>
      {hub.online && (
        <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Button variant="primary" block disabled={busy} onClick={() => void finish("device")}>
            {t.addDeviceNow}
          </Button>
          <Button variant="ghost" block disabled={busy} onClick={() => void finish("home")}>
            {t.done}
          </Button>
        </div>
      )}
    </>
  );
}
