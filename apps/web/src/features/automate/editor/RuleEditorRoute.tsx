import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { RuleEditorScreen } from "./RuleEditorScreen";
import { getCurrentTarget } from "./editorNav";

/** Lazy route component for `/automate/editor`. */
export default function RuleEditorRoute() {
  const navigate = useNavigate();
  const target = getCurrentTarget();
  const close = () => void navigate({ to: "/automate" });
  useEffect(() => {
    if (!target) void navigate({ to: "/automate" });
  }, [target, navigate]);
  if (!target) return null;
  return (
    <div className="ph" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <RuleEditorScreen target={target} onClose={close} />
    </div>
  );
}
