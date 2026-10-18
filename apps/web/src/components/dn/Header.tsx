import type { ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import "./ds2.css";

export interface HeaderProps {
  /** Site switcher label (left). Omit to render only `left`. */
  siteName?: string;
  siteLabel?: string;
  onSiteClick?: () => void;
  siteDisabled?: boolean;
  /** Replaces the site switcher (e.g. back button / title). */
  left?: ReactNode;
  /** Replaces the default "+" button. */
  right?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  addDisabled?: boolean;
  /** Hide the default "+" button. */
  hideAdd?: boolean;
  className?: string;
}

/** 56px header: left and right action zones, no centre title. */
export function Header({
  siteName,
  siteLabel,
  onSiteClick,
  siteDisabled,
  left,
  right,
  onAdd,
  addLabel = "Thêm",
  addDisabled,
  hideAdd,
  className,
}: HeaderProps) {
  return (
    <header className={["hdr", className].filter(Boolean).join(" ")}>
      <div className="hdr-l">
        {left ??
          (siteName ? (
            <button
              type="button"
              className="sitesw"
              aria-label={siteLabel ?? `Đổi site: ${siteName}`}
              disabled={siteDisabled}
              onClick={onSiteClick}
            >
              {siteName}
              <ChevronDown className="ic" aria-hidden="true" />
            </button>
          ) : null)}
      </div>
      <div className="hdr-r">
        {right ??
          (hideAdd ? null : (
            <button type="button" className="ibtn" aria-label={addLabel} disabled={addDisabled} onClick={onAdd}>
              <Plus className="ic" aria-hidden="true" />
            </button>
          ))}
      </div>
    </header>
  );
}
