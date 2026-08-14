import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const baseUrl = (process.argv[2] ?? "http://127.0.0.1:4321").replace(/\/+$/, "");
const executablePath = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
]
  .filter(Boolean)
  .find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error("Chrome or Edge is required for the Moments audit.");
}

const fixturePath = fileURLToPath(
  new URL("../public/assets/moments/mock/table-details-thumb.webp", import.meta.url),
);

if (!existsSync(fixturePath)) {
  throw new Error(`Moments upload fixture is missing: ${fixturePath}`);
}

const routeUrl = (route = "") => `${baseUrl}/${route.replace(/^\/+/, "")}`;
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu", "--hide-scrollbars"],
});
const browserErrors = [];
const layoutResults = [];

try {
  const page = await browser.newPage();
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });

  const auditGuest = `Moments Audit ${Date.now().toString().slice(-6)}`;
  const auditCaption = "A browser-local moment shared by the automated guest flow.";

  await page.goto(routeUrl("moments/capture/"), { waitUntil: "networkidle0" });
  await page.waitForSelector('input[name="gallery"]');

  const galleryInput = await page.$('input[name="gallery"]');
  if (!galleryInput) {
    throw new Error("The gallery file input did not render.");
  }

  await galleryInput.uploadFile(fixturePath);
  await page.waitForSelector('button[aria-label^="Remove "]');
  await page.type('input[name="guestName"]', auditGuest);
  await page.type('textarea[name="caption"]', auditCaption);
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => document.body.textContent?.includes("joined our story"),
    { timeout: 10_000 },
  );

  const captureResult = await page.evaluate(() => ({
    success: document.body.textContent?.includes("joined our story") ?? false,
    mockDisclosure:
      document.body.textContent?.includes("only in this browser") ?? false,
  }));

  if (!captureResult.success || !captureResult.mockDisclosure) {
    throw new Error(`Capture result was incomplete: ${JSON.stringify(captureResult)}`);
  }

  await page.goto(routeUrl("moments/admin/"), { waitUntil: "networkidle0" });
  await page.waitForFunction(
    (guestName) => document.body.textContent?.includes(guestName),
    { timeout: 10_000 },
    auditGuest,
  );

  const approveClicked = await page.evaluate((guestName) => {
    const card = [...document.querySelectorAll("article")].find((candidate) =>
      candidate.textContent?.includes(guestName),
    );
    const button = card
      ? [...card.querySelectorAll("button")].find((candidate) =>
          candidate.textContent?.trim().startsWith("Approve"),
        )
      : undefined;

    button?.click();
    return Boolean(button);
  }, auditGuest);

  if (!approveClicked) {
    throw new Error("The uploaded moment did not expose an Approve action.");
  }

  await page.waitForFunction(
    (guestName) =>
      document.body.textContent?.includes(`${guestName}'s moment was approved.`),
    { timeout: 10_000 },
    auditGuest,
  );

  await page.goto(routeUrl("moments/gallery/"), { waitUntil: "networkidle0" });
  await page.waitForFunction(
    (guestName) => document.body.textContent?.includes(guestName),
    { timeout: 10_000 },
    auditGuest,
  );

  const uploadedCardOpened = await page.evaluate((guestName) => {
    const card = [...document.querySelectorAll("article")].find((candidate) =>
      candidate.textContent?.includes(guestName),
    );
    const button = card?.querySelector("button");
    button?.click();
    return Boolean(button);
  }, auditGuest);

  if (!uploadedCardOpened) {
    throw new Error("The approved upload did not appear in the guest gallery.");
  }

  await page.waitForSelector('[role="dialog"][aria-modal="true"]');
  const firstViewerTitle = await page.$eval(
    '[role="dialog"] h2',
    (heading) => heading.textContent?.trim() ?? "",
  );
  await page.keyboard.press("ArrowRight");
  await wait(180);
  const secondViewerTitle = await page.$eval(
    '[role="dialog"] h2',
    (heading) => heading.textContent?.trim() ?? "",
  );

  if (firstViewerTitle === secondViewerTitle) {
    throw new Error("ArrowRight did not move the lightbox to another moment.");
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"][aria-modal="true"]'),
  );

  const restoredViewerState = await page.evaluate(() => ({
    bodyPosition: document.body.style.position,
    bodyOverflow: document.body.style.overflow,
    rootOverflow: document.documentElement.style.overflow,
  }));

  if (
    restoredViewerState.bodyPosition ||
    restoredViewerState.bodyOverflow ||
    restoredViewerState.rootOverflow
  ) {
    throw new Error(
      `Lightbox scroll styles were not restored: ${JSON.stringify(restoredViewerState)}`,
    );
  }

  const viewports = [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ];
  const routes = [
    "moments/",
    "moments/capture/",
    "moments/gallery/",
    "moments/admin/",
    "moments/live/",
  ];

  for (const viewport of viewports) {
    await page.setViewport({
      ...viewport,
      deviceScaleFactor: 1,
      isMobile: viewport.width < 768,
      hasTouch: viewport.width < 768,
    });

    for (const route of routes) {
      await page.goto(routeUrl(route), { waitUntil: "networkidle0" });
      await wait(120);
      const metrics = await page.evaluate(() => ({
        hasMain: Boolean(document.querySelector("main#main-content")),
        headingCount: document.querySelectorAll("main h1").length,
        overflow: Math.max(
          0,
          document.documentElement.scrollWidth - window.innerWidth,
          document.body.scrollWidth - window.innerWidth,
        ),
      }));

      layoutResults.push({ route, ...viewport, ...metrics });

      if (!metrics.hasMain || metrics.headingCount !== 1 || metrics.overflow > 1) {
        throw new Error(`Layout audit failed: ${JSON.stringify(layoutResults.at(-1))}`);
      }
    }
  }

  await page.goto(routeUrl("moments/"), { waitUntil: "networkidle0" });
  const pathResult = await page.evaluate(() => ({
    capturePath: new URL(
      [...document.querySelectorAll("a")].find((link) =>
        link.textContent?.includes("Capture a Moment"),
      )?.href ?? location.href,
    ).pathname,
    galleryPath: new URL(
      [...document.querySelectorAll("a")].find((link) =>
        link.textContent?.includes("Explore the Gallery"),
      )?.href ?? location.href,
    ).pathname,
    journeyPath: new URL(
      [...document.querySelectorAll("a")].find((link) =>
        link.textContent?.includes("Our Journey"),
      )?.href ?? location.href,
    ).pathname,
  }));
  const configuredBasePath = new URL(`${baseUrl}/`).pathname.replace(/\/+$/, "");
  const expectedCapturePath = `${configuredBasePath}/moments/capture/`.replace(
    /\/{2,}/g,
    "/",
  );
  const expectedGalleryPath = `${configuredBasePath}/moments/gallery/`.replace(
    /\/{2,}/g,
    "/",
  );
  const expectedJourneyPath = `${configuredBasePath}/`.replace(/\/{2,}/g, "/");

  if (
    pathResult.capturePath !== expectedCapturePath ||
    pathResult.galleryPath !== expectedGalleryPath ||
    pathResult.journeyPath !== expectedJourneyPath
  ) {
    throw new Error(
      `Base-aware links were incorrect: ${JSON.stringify({ pathResult, expectedCapturePath, expectedGalleryPath, expectedJourneyPath })}`,
    );
  }

  if (browserErrors.length > 0) {
    throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        capture: captureResult,
        approvedGuest: auditGuest,
        viewer: { firstViewerTitle, secondViewerTitle, restoredViewerState },
        basePaths: pathResult,
        layoutsChecked: layoutResults.length,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
