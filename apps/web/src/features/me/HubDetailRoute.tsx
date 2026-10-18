import { useParams } from "@tanstack/react-router";
import { HubDetailScreen } from "./HubDetailScreen";

export function HubDetailRoute() {
  const { hubId } = useParams({ strict: false }) as { hubId: string };
  return <HubDetailScreen hubId={hubId} />;
}
