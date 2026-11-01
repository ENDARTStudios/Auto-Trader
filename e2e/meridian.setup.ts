import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = ".auth/meridian.json";

setup("autentica uma vez e reaproveita o storage state", async ({ request }) => {
  const res = await request.post("/api/auth/login", {
    data: { email: "admin@local", password: "Admin123!" },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.ok(), `login falhou com ${res.status()}`).toBeTruthy();
  await request.storageState({ path: AUTH_FILE });
});
