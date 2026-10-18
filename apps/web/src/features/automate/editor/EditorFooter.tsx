import type { RunProgress } from "@devicenet/shared";
import { Button } from "@/components/dn/Button";
import { Switch } from "@/components/dn/Switch";
import { vi } from "@/i18n/vi";

const t = vi.s30;

export interface EditorFooterProps {
  /** Scenes have no enable switch (and no "Khi" / "Và nếu"). */
  showEnable: boolean;
  enabled: boolean;
  /** Switch is disabled until the rule has been saved once (artboard "Bật được sau khi lưu"). */
  isNew: boolean;
  onEnabled: (v: boolean) => void;
  canTest: boolean;
  testing: boolean;
  onTest: () => void;
  run?: RunProgress;
  testError?: string;
}

export function EditorFooter(p: EditorFooterProps) {
  return (
    <>
      {p.showEnable && (
        <div className="list" style={{ margin: 0 }}>
          <div className="row">
            <span className="row-main">
              <span className="lbl">{t.enable}</span>
              <span className="cap">{p.isNew ? t.enableAfterSave : t.enableBody}</span>
            </span>
            <Switch checked={p.enabled && !p.isNew} disabled={p.isNew} label={t.enable} onChange={p.onEnabled} />
          </div>
        </div>
      )}
      <Button variant="secondary" block loading={p.testing} disabled={!p.canTest} onClick={p.onTest} style={{ width: "100%" }}>
        {t.test}
      </Button>
      {p.testError ? (
        <p className="cap" role="alert" style={{ color: "var(--warning)" }}>
          {p.testError}
        </p>
      ) : null}
      {p.run ? (
        <ul aria-label={t.test} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {p.run.steps.map((s) => (
            <li key={s.index} className="cap" data-status={s.status}>
              {t.testStep(s.index + 1, t.stepStatus[s.status])}
              {s.error ? ` · ${s.error}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="cap" style={{ textAlign: "center" }}>
        {t.footnote}
      </p>
    </>
  );
}
