import { useParams } from "@tanstack/react-router";
import type { DeviceId } from "@devicenet/shared";
import { DeviceDetailScreen } from "./DeviceDetailScreen";

/** Route component for `/device/$deviceId`. */
export function DeviceDetailRoute() {
  const { deviceId } = useParams({ strict: false }) as { deviceId: string };
  return <DeviceDetailScreen deviceId={deviceId as DeviceId} />;
}
