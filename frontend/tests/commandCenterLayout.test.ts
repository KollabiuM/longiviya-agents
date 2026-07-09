import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOP_WALL_H } from "@/components/command/layout";

const layoutSource = readFileSync(
  new URL("../src/components/command/layout.ts", import.meta.url),
  "utf8",
);

const decorSource = readFileSync(
  new URL("../src/components/command/CommandCenterDecor.tsx", import.meta.url),
  "utf8",
);

const boardSource = readFileSync(
  new URL("../src/components/command/CommandCenterBoard.tsx", import.meta.url),
  "utf8",
);

const furnitureSource = readFileSync(
  new URL(
    "../src/components/command/CommandCenterFurniture.tsx",
    import.meta.url,
  ),
  "utf8",
);

const exitingPeerSource = readFileSync(
  new URL("../src/components/command/ExitingPeer.tsx", import.meta.url),
  "utf8",
);

describe("Command Center wall layout", () => {
  it("matches the normal office back wall height", () => {
    expect(TOP_WALL_H).toBe(250);
    expect(layoutSource).toContain("export const TOP_WALL_H = 250;");
  });

  it("uses a single wall photo", () => {
    const photoSprites = decorSource.match(/texture={t\.employeeOfMonth}/g);

    expect(photoSprites).toHaveLength(1);
  });

  it("keeps the summary whiteboard readable", () => {
    expect(boardSource).toContain("const W = 320;");
    expect(boardSource).toContain("const H = 116;");
  });

  it("places the command center elevator on the back wall", () => {
    expect(layoutSource).toContain(
      "export const EXIT_DOOR_BASE_Y = TOP_WALL_H;",
    );
    expect(furnitureSource).not.toContain("zone.y + 150");
    expect(exitingPeerSource).not.toContain("zone.y + 150");
  });
});
