import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const registryRoot = resolve(repoRoot, "registry");

const uiPrimitives = [
  "accordion",
  "alert-dialog",
  "blur-in",
  "button",
  "caret",
  "checkbox",
  "combobox",
  "command-menu",
  "context-menu",
  "cursor",
  "dialog",
  "drawer",
  "dropdown-menu",
  "input",
  "popover",
  "progress",
  "radio",
  "resizable",
  "select",
  "sheet",
  "skeleton",
  "slider",
  "spinner",
  "stepper",
  "switch",
  "tabs",
  "toast",
  "toggle-group",
  "tooltip",
] as const;

const transitionPrimitives = [
  "badge-pop",
  "card-resize",
  "input-feedback",
  "menu-morph",
  "micro-transitions",
  "page-slide",
  "text-stagger",
  "tilt-card",
] as const;

const uiFlows = [
  "ai-prompt-flow",
  "checkout-flow",
  "onboarding-stepper-flow",
  "settings-toggle-flow",
  "signup-flow",
] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function expectRegisteredComponents(names: readonly string[], expectedTags: string[]): void {
  const registry = readJson<{ items: { name: string; type: string }[] }>(
    resolve(registryRoot, "registry.json"),
  );
  const componentEntries = new Map(
    registry.items
      .filter((item) => item.type === "hyperframes:component")
      .map((item) => [item.name, item]),
  );

  for (const name of names) {
    expect(componentEntries.has(name)).toBe(true);

    const componentDir = resolve(registryRoot, "components", name);
    const manifest = readJson<{
      type: string;
      tags?: string[];
      files?: { path: string; target: string; type: string }[];
    }>(resolve(componentDir, "registry-item.json"));

    expect(manifest.type).toBe("hyperframes:component");
    for (const tag of expectedTags) {
      expect(manifest.tags).toContain(tag);
    }
    expect(manifest.files).toEqual([
      {
        path: `${name}.html`,
        target: `compositions/components/${name}.html`,
        type: "hyperframes:snippet",
      },
    ]);
    expect(existsSync(resolve(componentDir, `${name}.html`))).toBe(true);
    expect(existsSync(resolve(componentDir, "demo.html"))).toBe(true);
  }
}

describe("remocn UI primitives catalog slice", () => {
  it("registers shadcn-style UI primitives as installable HyperFrames components", () => {
    expectRegisteredComponents(uiPrimitives, ["ui-primitive", "remocn-port"]);
  });

  it("ports transitions.dev-style microinteractions as deterministic transition primitives", () => {
    expectRegisteredComponents(transitionPrimitives, [
      "transition-primitive",
      "transitions-dev-port",
    ]);
  });

  it("registers composed Remocn UI flows as reusable agent building blocks", () => {
    expectRegisteredComponents(uiFlows, ["ui-flow", "remocn-port"]);
  });
});
