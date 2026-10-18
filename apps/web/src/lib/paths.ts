/** Firestore path helpers under `tenants/{t}` (segment arrays for doc()/collection()). */
const t = (tenantId: string) => ["tenants", tenantId];

export const paths = {
  tenant: (tenantId: string) => t(tenantId),
  members: (tenantId: string) => [...t(tenantId), "members"],
  member: (tenantId: string, uid: string) => [...t(tenantId), "members", uid],
  sites: (tenantId: string) => [...t(tenantId), "sites"],
  site: (tenantId: string, siteId: string) => [...t(tenantId), "sites", siteId],
  rooms: (tenantId: string, siteId: string) => [...t(tenantId), "sites", siteId, "rooms"],
  room: (tenantId: string, siteId: string, roomId: string) => [...t(tenantId), "sites", siteId, "rooms", roomId],
  hubs: (tenantId: string) => [...t(tenantId), "hubs"],
  hub: (tenantId: string, hubId: string) => [...t(tenantId), "hubs", hubId],
  devices: (tenantId: string) => [...t(tenantId), "devices"],
  device: (tenantId: string, deviceId: string) => [...t(tenantId), "devices", deviceId],
  rules: (tenantId: string) => [...t(tenantId), "rules"],
  rule: (tenantId: string, ruleId: string) => [...t(tenantId), "rules", ruleId],
  scenes: (tenantId: string) => [...t(tenantId), "scenes"],
  scene: (tenantId: string, sceneId: string) => [...t(tenantId), "scenes", sceneId],
  layouts: (tenantId: string) => [...t(tenantId), "layouts"],
  layout: (tenantId: string, siteId: string) => [...t(tenantId), "layouts", siteId],
  events: (tenantId: string) => [...t(tenantId), "events"],
  event: (tenantId: string, eventId: string) => [...t(tenantId), "events", eventId],
};

export const pathStr = (segs: readonly string[]) => segs.join("/");
