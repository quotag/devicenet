import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// Routes are lazy-loaded (B25); under a parallel full-suite run the first
// dynamic import can exceed Testing Library's 1 s default for findBy*/waitFor.
configure({ asyncUtilTimeout: 5000 });
