import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "../ui/dialog";
import "./ds2.css";

export interface SheetItem {
  label: ReactNode;
  onClick?: () => void;
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  items?: SheetItem[];
  children?: ReactNode;
  /** Render as a centred modal dialog instead of a bottom sheet (desktop >= 900). */
  asDialog?: boolean;
  className?: string;
}

/** Bottom sheet on Radix Dialog: handle, title, optional 44px item rows, body. */
export function Sheet({ open, onOpenChange, title, items, children, asDialog, className }: SheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="dn-scrim" />
        <DialogContent
          aria-describedby={undefined}
          className={["dn-sheet", asDialog ? "dn-sheet-dialog" : "dn-sheet-bottom", className]
            .filter(Boolean)
            .join(" ")}
        >
          {!asDialog && <div className="dn-sheet-handle" aria-hidden="true" />}
          <DialogTitle className={title ? "dn-sheet-title" : "dn-sr-only"}>{title ?? "Sheet"}</DialogTitle>
          {items?.map((it, i) => (
            <button key={i} type="button" className="dn-sheet-item dn-sheet-item-btn" onClick={it.onClick}>
              {it.label}
            </button>
          ))}
          {children ? <div className="dn-sheet-body">{children}</div> : null}
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
