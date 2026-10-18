import { useStore } from "zustand";
import { AutomateMenuSheet } from "@/features/automate/AutomateMenuSheet";
import { ItemMenuSheet } from "@/features/automate/ItemMenuSheet";
import { AddMenuSheetHost } from "@/features/home/AddMenuSheet";
import { SiteSheet } from "@/features/home/SiteSheet";
import { RoomSheetHost } from "@/features/me/sheets/RoomSheet";
import { uiStore } from "@/stores";

/**
 * Renders `ui.sheet` (SH-1..SH-6 are not routes). Each sheet renders its own `Sheet`/dialog; an unknown kind
 * renders nothing. SH-3 / SH-4 are mounted by the S-20 screen itself (they need the device and navigation).
 */
export function SheetHost() {
  const sheet = useStore(uiStore, (s) => s.sheet);
  if (!sheet) return null;
  if (sheet.kind === "sh1") return <SiteSheet />; // B21
  if (sheet.kind === "sh2" && sheet.ctx === "automate") return <AutomateMenuSheet />; // B17
  if (sheet.kind === "sh2") return <AddMenuSheetHost />; // B14
  if (sheet.kind === "sh5") return <RoomSheetHost sheet={sheet as { mode: string; [k: string]: unknown }} />; // B13 + B21
  if (sheet.kind === "sh6") return <ItemMenuSheet key={`${sheet.type}:${sheet.id}`} type={sheet.type as "scene" | "rule"} id={sheet.id as string} initialStep={sheet.step === "confirm" ? "confirm" : "menu"} />; // B21
  return null;
}
