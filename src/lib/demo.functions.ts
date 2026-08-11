import { createServerFn } from "@tanstack/react-start";

const DEMO_EMAIL = "demo@paisa.app";
const DEMO_PASSWORD = "DemoPaisa!2026";

export const ensureDemoAccount = createServerFn({ method: "POST" }).handler(async () => {
  return { email: DEMO_EMAIL, password: DEMO_PASSWORD, seeded: false };
});
