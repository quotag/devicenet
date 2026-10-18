import { Building2, Check, Home, Plus } from "lucide-react";
import { useStore } from "zustand";
import type { SiteId } from "@devicenet/shared";
import { Sheet } from "@/components/dn/Sheet";
import { sheetsVi } from "@/i18n/sheets";
import { configStore, uiStore } from "@/stores";
import { useHubStatus } from "@/transport/hooks";

const rowStyle = {
  border: 0,
  background: "transparent",
  color: "var(--text)",
  padding: "8px 0",
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
} as const;

function SiteRow({ site, index, selected }: { site: { id: SiteId; name: string }; index: number; selected: boolean }) {
  const s = sheetsVi.sh1;
  const hub = useStore(configStore, (st) => Object.values(st.hubs).find((h) => h.siteId === site.id));
  const count = useStore(configStore, (st) => Object.values(st.devices).filter((d) => d.siteId === site.id && d.status === "active").length);
  const status = useHubStatus(hub?.id);
  const Icon = index === 0 ? Home : Building2;
  return (
    <button
      type="button"
      className="row"
      style={rowStyle}
      aria-pressed={selected}
      onClick={() => {
        uiStore.getState().setSiteId(site.id);
        uiStore.getState().closeSheet();
      }}
    >
      <Icon className="ic" aria-hidden="true" />
      <span className="row-main">
        <span className="lbl">{site.name}</span>
        <span className="cap">{hub ? s.hubLine(hub.name, count, status.online) : s.noHub}</span>
      </span>
      {selected ? <Check className="ic" aria-hidden="true" style={{ color: "var(--accent)" }} /> : null}
    </button>
  );
}

/** SH-1 site picker (from the Home header) + "Thêm site" → SH-5 newSite. */
export function SiteSheet() {
  const s = sheetsVi.sh1;
  const sites = useStore(configStore, (st) => st.sites);
  const uiSite = useStore(uiStore, (st) => st.siteId);
  const current = sites.find((x) => x.id === uiSite) ?? sites[0];
  const ordered = [...sites].sort((a, b) => a.order - b.order);
  return (
    <Sheet open title={s.title} onOpenChange={(o) => !o && uiStore.getState().closeSheet()}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {ordered.map((site, i) => (
          <SiteRow key={site.id} site={site} index={i} selected={site.id === current?.id} />
        ))}
        <button
          type="button"
          className="row"
          style={rowStyle}
          onClick={() => uiStore.getState().openSheet({ kind: "sh5", mode: "newSite" })}
        >
          <Plus className="ic" aria-hidden="true" />
          <span className="row-main">
            <span className="lbl">{s.addSite}</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}
