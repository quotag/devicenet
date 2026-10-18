import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ChevronUp, GripHorizontal, Home, Plus, Server, Settings } from "lucide-react";
import { useStore } from "zustand";
import type { Hub } from "@devicenet/shared";
import type { z } from "zod";
import { Badge } from "@/components/dn/Badge";
import { Banner } from "@/components/dn/Banner";
import { Button } from "@/components/dn/Button";
import { vi } from "@/i18n/vi";
import { configStore, sessionStore, uiStore } from "@/stores";
import { useHubStatus } from "@/transport/hooks";
import { EventRow } from "./EventRow";
import { hhmm, toView } from "./history";

type HubDoc = z.infer<typeof Hub>;
const m = vi.me;

function HubRow({ hub, deviceCount, siteName }: { hub: HubDoc; deviceCount: number; siteName?: string }) {
  const navigate = useNavigate();
  const status = useHubStatus(hub.id);
  const dot = status.online ? "var(--success)" : "var(--danger)";
  return (
    <button
      type="button"
      className="row"
      style={{ width: "100%", color: "var(--text)" }}
      onClick={() => void navigate({ to: "/me/hub/$hubId", params: { hubId: hub.id } })}
    >
      <Server className="ic" aria-hidden="true" />
      <span className="row-main">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="lbl">{hub.name}</span>
          <span className="dot" style={{ background: dot }} aria-hidden="true" />
          <span className="cap">{status.online ? m.online : m.offlineSince(hhmm(status.lastSeen))}</span>
        </span>
        <span className="cap dn-num">
          {[status.agentVersion ? `v${status.agentVersion}` : null, m.devicesCount(deviceCount), siteName].filter(Boolean).join(" · ")}
        </span>
      </span>
      <ChevronRight className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
    </button>
  );
}

function SiteRooms() {
  const sites = useStore(configStore, (s) => s.sites);
  const roomsBySite = useStore(configStore, (s) => s.roomsBySite);
  const devices = useStore(configStore, (s) => s.devices);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const ui = uiStore.getState();
  return (
    <div className="list">
      {sites.map((site, i) => {
        const rooms = roomsBySite[site.id] ?? [];
        const expanded = open[site.id] ?? i === 0;
        const Chev = expanded ? ChevronUp : ChevronDown;
        return (
          <div key={site.id}>
            <button
              type="button"
              className="row"
              style={{ width: "100%", color: "var(--text)" }}
              aria-expanded={expanded}
              onClick={() => setOpen((o) => ({ ...o, [site.id]: !expanded }))}
            >
              <Home className="ic" aria-hidden="true" />
              <span className="row-main">
                <span className="lbl">{site.name}</span>
                <span className="cap">{m.siteMeta(rooms.length, site.timezone)}</span>
              </span>
              <Chev className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
            </button>
            {expanded
              ? rooms.map((r) => {
                  const n = Object.values(devices).filter((d) => d.status === "active" && d.roomId === r.id).length;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="row"
                      style={{ width: "100%", paddingLeft: 48, minHeight: 40, color: "var(--text)" }}
                      onClick={() => ui.openSheet({ kind: "sh5", mode: "edit", siteId: site.id, roomId: r.id })}
                    >
                      <span className="lbl" style={{ flex: 1, textAlign: "left" }}>{r.name}</span>
                      <span className="cap dn-num">{n}</span>
                      <GripHorizontal className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
                    </button>
                  );
                })
              : null}
          </div>
        );
      })}
      <button
        type="button"
        className="row"
        style={{ width: "100%", color: "var(--accent)" }}
        onClick={() => ui.openSheet({ kind: "sh5", mode: "pick" })}
      >
        <Plus className="ic" aria-hidden="true" />
        <span className="lbl">{m.addSiteOrRoom}</span>
      </button>
    </div>
  );
}

/** S-03 Me: account card, Hub group, Site & Room, 5 latest events (replaces M-Local `MeMinimal`). */
export function MeScreen() {
  const navigate = useNavigate();
  const user = useStore(sessionStore, (s) => s.user);
  const mode = useStore(sessionStore, (s) => s.mode);
  const hubsMap = useStore(configStore, (s) => s.hubs);
  const devices = useStore(configStore, (s) => s.devices);
  const sites = useStore(configStore, (s) => s.sites);
  const events = useStore(configStore, (s) => s.events);
  const rules = useStore(configStore, (s) => s.rules);
  const scenes = useStore(configStore, (s) => s.scenes);
  const hubs = Object.values(hubsMap);
  const offlineHub = hubs.find((h) => !h.online);
  const offlineStatus = useHubStatus(offlineHub?.id);

  const title = user?.displayName || user?.email || (mode === "lan" ? m.lanAccount : "");
  const initial = (title[0] ?? "?").toUpperCase();
  const unnamed = Object.values(devices).filter((d) => d.status === "new").length;
  const latest = events.slice(0, 5).map((e) => toView(e, { rules, scenes }));
  const addHub = () => void navigate({ to: "/onboarding/hub" });

  return (
    <>
      <header className="hdr">
        <div className="hdr-l">
          <h1 className="title">{m.title}</h1>
        </div>
        <div className="hdr-r">
          <button className="ibtn" type="button" aria-label={m.settings} onClick={() => void navigate({ to: "/settings" })}>
            <Settings className="ic" aria-hidden="true" />
          </button>
        </div>
      </header>
      {offlineHub ? <Banner kind="offline">{vi.banner.hubOffline(offlineHub.name, hhmm(offlineStatus.lastSeen))}</Banner> : null}
      <div className="body" style={{ overflowY: "auto" }}>
        <div className="card" style={{ margin: "16px 16px 0", display: "flex", alignItems: "center", gap: 12 }}>
          <span className="avatar">{initial}</span>
          <span className="row-main">
            <span className="lbl">{title}</span>
            {user?.email ? <span className="cap">{m.account(user.email, sites[0]?.name)}</span> : null}
          </span>
        </div>

        <p className="sect-h">{m.hub}</p>
        {hubs.length ? (
          <div className="list">
            {hubs.map((h) => (
              <HubRow
                key={h.id}
                hub={h}
                siteName={sites.find((s) => s.id === h.siteId)?.name}
                deviceCount={Object.values(devices).filter((d) => d.status === "active" && d.siteId === h.siteId).length}
              />
            ))}
            {unnamed > 0 ? (
              <button
                type="button"
                className="row"
                style={{ width: "100%", color: "var(--text)" }}
                onClick={() => void navigate({ to: "/onboarding/device", search: { step: "name" } })}
              >
                <Badge tone="new">{m.badgeNew}</Badge>
                <span className="lbl" style={{ flex: 1, textAlign: "left" }}>{m.unnamedDevices(unnamed)}</span>
                <ChevronRight className="ic" aria-hidden="true" style={{ color: "var(--text-muted)" }} />
              </button>
            ) : null}
            {mode === "cloud" ? (
              <button type="button" className="row" style={{ width: "100%", color: "var(--accent)" }} onClick={addHub}>
                <Plus className="ic" aria-hidden="true" />
                <span className="lbl">{m.addHub}</span>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="card" style={{ margin: "0 16px", display: "flex", flexDirection: "column", gap: 12, borderStyle: "dashed" }}>
            <span className="lbl">{m.noHub}</span>
            <p className="body-t" style={{ color: "var(--text-muted)" }}>{m.noHubBody}</p>
            {mode === "cloud" ? (
              <Button variant="primary" onClick={addHub}>
                {m.addHub}
              </Button>
            ) : null}
          </div>
        )}

        <p className="sect-h">{m.siteRoom}</p>
        <SiteRooms />

        <p className="sect-h">{m.history}</p>
        <div className="list" style={{ marginBottom: 24 }}>
          {latest.map((ev) => (
            <EventRow key={ev.id} ev={ev} compact />
          ))}
          <button
            type="button"
            className="row"
            style={{ width: "100%", minHeight: 40, color: "var(--accent)" }}
            onClick={() => void navigate({ to: "/me/history" })}
          >
            <span className="lbl">{m.seeAll}</span>
          </button>
        </div>
      </div>
    </>
  );
}
