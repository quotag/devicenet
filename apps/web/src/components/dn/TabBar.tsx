import { House, User, Zap } from "lucide-react";
import { vi } from "@/i18n/vi";
import "./ds2.css";

export type TabId = "home" | "automate" | "me";

export interface TabBarProps {
  value: TabId;
  onChange?: (tab: TabId) => void;
  /** Red dot per tab. */
  dots?: Partial<Record<TabId, boolean>>;
  /** Disabled tabs. */
  disabled?: Partial<Record<TabId, boolean>>;
  className?: string;
}

const TABS: { id: TabId; icon: typeof House }[] = [
  { id: "home", icon: House },
  { id: "automate", icon: Zap },
  { id: "me", icon: User },
];

export function TabBar({ value, onChange, dots, disabled, className }: TabBarProps) {
  return (
    <nav className={["tabbar", className].filter(Boolean).join(" ")} aria-label={vi.dn2.nav}>
      {TABS.map(({ id, icon: Icon }) => {
        const isDisabled = Boolean(disabled?.[id]);
        return (
          <button
            key={id}
            type="button"
            className={["tab", id === value && "tab-on"].filter(Boolean).join(" ")}
            aria-current={id === value ? "page" : undefined}
            aria-disabled={isDisabled ? "true" : undefined}
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange?.(id)}
          >
            <Icon className="ic" aria-hidden="true" />
            {vi.dn2.tabs[id]}
            {dots?.[id] ? <span className="tab-dot" data-testid={`tab-dot-${id}`} /> : null}
          </button>
        );
      })}
    </nav>
  );
}
