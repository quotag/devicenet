import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/base.css";
import { env } from "@/env";
import { App } from "@/app/providers";
import { registerPwa } from "@/app/pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App mode={env.mode} />
  </StrictMode>,
);

registerPwa();
