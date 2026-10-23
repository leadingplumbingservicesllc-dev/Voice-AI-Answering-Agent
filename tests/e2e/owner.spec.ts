import { test, expect } from "@playwright/test";
test("owners can review calls, follow up, save settings, and test capture on desktop and mobile", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  const token = (await (await page.request.get("/api/session")).json()).csrf;
  const baseline = new Set([
    "DEMO-MARIA",
    "DEMO-JAMES",
    "DEMO-PARTIAL",
    "DEMO-ANA",
    "DEMO-ROBERT",
  ]);
  const previous = (await (await page.request.get("/api/calls")).json()).calls;
  for (const call of previous)
    if (!baseline.has(call.id)) {
      const result = await page.request.delete("/api/calls/" + call.id, {
        headers: { "x-csrf-token": token },
      });
      expect(result.status()).toBe(200);
    }
  await page.request.patch("/api/calls/DEMO-MARIA", {
    headers: { "x-csrf-token": token },
    data: { status: "New" },
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Call inbox." }),
  ).toBeVisible();
  await expect(
    page.getByText("Calls and text deliveries are simulated."),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/screenshots/inbox-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: /Maria Gonzalez/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Maria Gonzalez" }),
  ).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Call back" })).toHaveAttribute(
    "href",
    "tel:+15555550142",
  );
  await expect(dialog.getByText("SIMULATED CALL")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Mark contacted" }).click();
  await expect(dialog.getByText("Contacted", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Service area", { exact: true })
    .fill("Palm Beach and Broward counties");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await page.screenshot({
    path: `docs/screenshots/settings-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Setup & Health", exact: true })
    .click();
  await expect(page.getByText("Writable · WAL")).toBeVisible();
  await page
    .getByRole("button", { name: "Abandoned call", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Unknown caller" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Callback number unknown"),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("delivered", { exact: true }),
  ).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Setup & Health", exact: true })
    .click();
  await page.screenshot({
    path: `docs/screenshots/health-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a fictional caller can correct a number and finish an interactive request", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo workspace" }).click();
  await page.getByRole("button", { name: "Try a demo call" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/SIMULATED CALL: I am/)).toBeVisible();
  for (const text of [
    "Fictional Sam",
    "+15555550111",
    "+15555550122",
    "yes",
    "12 Example Lane, Lake Worth Beach",
    "Residential",
    "The outdoor faucet is dripping",
    "Routine, no active leak",
    "Tomorrow morning",
    "yes",
  ]) {
    await dialog.getByRole("textbox", { name: "Your reply" }).fill(text);
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/demo-call/") &&
          r.request().method() === "POST",
      ),
      dialog.getByRole("button", { name: "Send reply", exact: true }).click(),
    ]);
    expect(response.status()).toBe(200);
    const result = await response.json();
    if (result.ended)
      await expect(
        dialog.getByRole("button", { name: "View captured call" }),
      ).toBeEnabled();
    else
      await expect(
        dialog.getByRole("textbox", { name: "Your reply" }),
      ).toBeEnabled();
  }
  await dialog.getByRole("button", { name: "View captured call" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Fictional Sam" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Call back" }),
  ).toHaveAttribute("href", "tel:+15555550122");
  await expect(
    page
      .getByRole("dialog")
      .getByText("The outdoor faucet is dripping", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("delivered", { exact: true }),
  ).toHaveCount(2);
});
