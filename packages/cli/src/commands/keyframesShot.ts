// Onion-skin motion screenshot: seek the LIVE timeline at N equal-time steps and
// project the REAL element at each step, so an agent can SELF-VERIFY motion (the
// rendered result — every channel: position, rotation, scale, opacity, colour),
// not just the authored x/y numbers. Reuses the headless-Chrome + static-server
// pattern from layout.ts.
//
// 3D is captured for free: zero-size marker children at the element's corners are
// projected by the browser, so a tilted/edge-on element renders as a real quad.
// Framing controls (samples / time window / fit / filmstrip) let the agent frame
// exactly what it's editing. All geometry + SVG live in ./keyframesShotLayout.ts
// (pure, tested); this file only drives the browser and SAMPLES.

import { writeFileSync } from "node:fs";
import {
  buildOnionSvg,
  parseAngle,
  sampleTimes,
  type OnionElement,
} from "./keyframesShotLayout.js";

export interface ShotRequest {
  /** CSS selector of the moving element to sample (e.g. "#dot"). */
  selector: string;
}

export interface ShotOptions {
  /** Equal-time samples across the (windowed) timeline. Default 9. */
  samples?: number;
  /** "path" = ghosts at real positions + path; "strip" = filmstrip by time. */
  layout?: "path" | "strip";
  /** Zoom the motion to fill the frame. Default true. */
  fit?: boolean;
  /** Sample only this time window (seconds) — dense inspection of one phase. */
  from?: number | null;
  to?: number | null;
  /** Orbit camera: a preset (front|iso|top|side) or "yaw,pitch" degrees. */
  angle?: string;
}

interface PageSample {
  t: number;
  q: Array<{ x: number; y: number }>;
  c: { x: number; y: number };
  color: string;
  opacity: number;
}

/** Render `projectDir`'s index headless, sample each element's motion as a 3D
 *  onion-skin, screenshot to `outPath` (PNG). Returns the saved path. */
export async function captureMotionPathShot(
  projectDir: string,
  requests: ShotRequest[],
  outPath: string,
  opts: ShotOptions = {},
): Promise<string> {
  const samples = Math.max(1, Math.min(60, opts.samples ?? 9));
  const layout = opts.layout ?? "path";
  const fit = opts.fit ?? true;
  const camera = parseAngle(opts.angle);

  const { ensureBrowser } = await import("../browser/manager.js");
  const { serveStaticProjectHtml } = await import("../utils/staticProjectServer.js");
  const puppeteer = await import("puppeteer-core");
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");

  const html = await bundleToSingleHtml(projectDir);
  const server = await serveStaticProjectHtml(
    projectDir,
    html,
    "Failed to bind keyframes shot server",
  );
  let browserInstance: import("puppeteer-core").Browser | undefined;
  try {
    const browser = await ensureBrowser();
    browserInstance = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    });
    const page = await browserInstance.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10000 });

    const size = await page.evaluate(() => {
      const root = document.querySelector("[data-composition-id][data-width][data-height]");
      const w = root ? parseInt(root.getAttribute("data-width") ?? "", 10) : 0;
      const h = root ? parseInt(root.getAttribute("data-height") ?? "", 10) : 0;
      return {
        width: Number.isFinite(w) && w > 0 ? Math.min(w, 4096) : 1920,
        height: Number.isFinite(h) && h > 0 ? Math.min(h, 4096) : 1080,
      };
    });
    await page.setViewport(size);
    await page.goto(server.url, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page
      .waitForFunction(() => !!(window as unknown as { __timelines?: unknown }).__timelines, {
        timeout: 10000,
      })
      .catch(() => {});
    try {
      await page.evaluate(async () => {
        const d = document as unknown as { fonts?: { ready?: Promise<unknown> } };
        if (d.fonts?.ready) await d.fonts.ready;
      });
    } catch {
      // fonts API not present — proceed
    }

    const dur = await page.evaluate(() => {
      const tls = Object.values(
        (
          window as unknown as {
            __timelines?: Record<string, { duration?: () => number; totalDuration?: () => number }>;
          }
        ).__timelines ?? {},
      );
      let d = 0;
      for (const tl of tls) {
        try {
          d = Math.max(d, (tl.totalDuration?.() ?? tl.duration?.() ?? 0) as number);
        } catch {
          // skip
        }
      }
      return d;
    });

    const times = sampleTimes(dur, samples, opts.from ?? null, opts.to ?? null);

    // Sample: seek to each time, read every element's projected corners. Marker
    // children (zero-size) inherit the element's full transform chain, so their
    // screen positions ARE the 3D projection of each corner.
    const elements = (await page.evaluate(
      (selectors: string[], ts: number[], cam: { yaw: number; pitch: number }) => {
        const tls = Object.values(
          (
            window as unknown as {
              __timelines?: Record<string, { pause?: () => void; seek?: (t: number) => void }>;
            }
          ).__timelines ?? {},
        );
        const seekAll = (t: number) =>
          tls.forEach((tl) => {
            try {
              tl.pause?.();
              tl.seek?.(t);
            } catch {
              // best-effort
            }
          });

        // Orbit camera: make the whole ancestor chain of each element preserve-3d
        // and strip any intermediate perspective, then put one perspective on the
        // composition root's parent (the lens) and rotate the root. The element's
        // own 3D survives and is viewed from the requested angle — works on any
        // composition shape (no #stage assumption).
        if (cam.yaw !== 0 || cam.pitch !== 0) {
          const first = document.querySelector(selectors[0] ?? "");
          const root =
            (first?.closest("[data-composition-id]") as HTMLElement | null) ??
            (document.querySelector("#stage") as HTMLElement | null) ??
            (document.body.firstElementChild as HTMLElement | null) ??
            document.body;
          for (const sel of selectors) {
            let n = document.querySelector(sel) as HTMLElement | null;
            while (n && n !== root) {
              n.style.transformStyle = "preserve-3d";
              if (getComputedStyle(n).perspective !== "none") n.style.perspective = "none";
              n = n.parentElement;
            }
          }
          root.style.transformStyle = "preserve-3d";
          root.style.perspective = "none";
          root.style.transformOrigin = "50% 50%";
          root.style.transform = `rotateX(${cam.pitch}deg) rotateY(${cam.yaw}deg)`;
          const lens = root.parentElement ?? document.body;
          lens.style.perspective = "1600px";
          lens.style.perspectiveOrigin = "50% 50%";
        }

        const rigs = selectors.map((sel) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return null;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const local: Array<[number, number]> = [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
            [w / 2, h / 2],
          ];
          const markers = local.map(([lx, ly]) => {
            const m = document.createElement("div");
            m.style.cssText = `position:absolute;left:${lx}px;top:${ly}px;width:0;height:0;pointer-events:none`;
            el.appendChild(m);
            return m;
          });
          return { el, markers };
        });
        const out = selectors.map((selector) => ({ selector, samples: [] as PageSample[] }));
        for (const t of ts) {
          seekAll(t);
          rigs.forEach((rig, i) => {
            if (!rig) return;
            const pts = rig.markers.map((m) => {
              const r = m.getBoundingClientRect();
              return { x: r.left, y: r.top };
            });
            const cs = getComputedStyle(rig.el);
            out[i]!.samples.push({
              t: Math.round(t * 1000) / 1000,
              q: pts.slice(0, 4),
              c: pts[4]!,
              color: cs.backgroundColor,
              opacity: parseFloat(cs.opacity) || 0,
            });
          });
        }
        rigs.forEach((rig) => {
          if (rig) rig.el.style.visibility = "hidden";
        });
        return out.filter((o) => o.samples.length > 0);
      },
      requests.map((r) => r.selector),
      times,
      camera,
    )) as OnionElement[];

    const windowStr =
      opts.from != null || opts.to != null ? `  ·  t ${times[0]}–${times[times.length - 1]}s` : "";
    const camLabel =
      camera.yaw === 0 && camera.pitch === 0
        ? "front"
        : `yaw ${camera.yaw}° pitch ${camera.pitch}°`;
    const label = `${camLabel}  ·  ${layout === "strip" ? "filmstrip" : fit ? "zoom-fit" : "1:1"}  ·  ${times.length} frames${windowStr}`;
    const svg = buildOnionSvg(elements, {
      layout,
      fit,
      width: size.width,
      height: size.height,
      label,
    });

    await page.evaluate((markup: string) => {
      document.body.insertAdjacentHTML("beforeend", markup);
    }, svg);
    await new Promise((r) => setTimeout(r, 60));

    const buf = await page.screenshot({ type: "png" });
    if (!buf) throw new Error("screenshot returned no data");
    writeFileSync(outPath, buf as Uint8Array);
    return outPath;
  } finally {
    await browserInstance?.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
