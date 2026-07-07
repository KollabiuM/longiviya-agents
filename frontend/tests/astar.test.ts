/**
 * Characterization tests for the A* pathfinding stack.
 *
 * `findPath`, `gridPathToWorld`, and `findWorldPath` each accept an injectable
 * `PathGrid`, so no canvas/Pixi is required — we drive them with a small stub
 * grid that mirrors `NavigationGrid`'s contract (8-directional neighbors with
 * diagonal corner-cutting prevented, exactly like
 * `NavigationGrid.getNeighbors`).
 *
 * These tests pin the CURRENT path output shape (optimal-or-shortest per the
 * existing implementation) so the ARC-005 refactor cannot silently reroute
 * agents. Add tests only — no source changes.
 */

import { describe, expect, it } from "vitest";
import { findPath, findWorldPath, gridPathToWorld } from "@/systems/astar";
import type { GridPosition, PathGrid } from "@/systems/navigationGrid";
import type { Position } from "@/types";

// ---------------------------------------------------------------------------
// STUB GRID
// ---------------------------------------------------------------------------

const TILE = 1; // keep world↔grid transform trivial so tests read like grids

/**
 * Build a PathGrid from a 2D walkability mask. `mask[gy][gx] === true` means
 * walkable. `getNeighbors` mirrors NavigationGrid exactly: 8-directional with
 * diagonal corner-cutting blocked (both adjacent cardinals must be walkable).
 */
function makeGrid(mask: boolean[][]): PathGrid {
  const height = mask.length;
  const width = height === 0 ? 0 : mask[0].length;
  const inBounds = (gx: number, gy: number) =>
    gx >= 0 && gx < width && gy >= 0 && gy < height;
  const isWalkable = (gx: number, gy: number) =>
    inBounds(gx, gy) && mask[gy][gx];

  return {
    worldToGrid: (x, y) => ({
      gx: Math.floor(x / TILE),
      gy: Math.floor(y / TILE),
    }),
    gridToWorld: (gx, gy) => ({
      x: gx * TILE + TILE / 2,
      y: gy * TILE + TILE / 2,
    }),
    isWalkable: (gx: number, gy: number) => isWalkable(gx, gy),
    getCost: () => 1.0,
    getNeighbors: (gx: number, gy: number) => {
      const out: GridPosition[] = [];
      const dirs = [
        { dx: 0, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: -1 },
        { dx: 1, dy: 1 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: -1 },
      ];
      for (const { dx, dy } of dirs) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (!inBounds(nx, ny)) continue;
        // Mirror NavigationGrid: no cutting through diagonal wall seams.
        if (dx !== 0 && dy !== 0) {
          if (!isWalkable(gx + dx, gy) || !isWalkable(gx, gy + dy)) continue;
        }
        out.push({ gx: nx, gy: ny });
      }
      return out;
    },
  };
}

/** Helper: convert a grid coord into the world coord our stub expects. */
function w(gx: number, gy: number): Position {
  return { x: gx, y: gy };
}

/** Helper: check that every consecutive path step is adjacent (Chebyshev ≤ 1). */
function assertContiguous(path: GridPosition[]): void {
  for (let i = 1; i < path.length; i++) {
    const ddx = Math.abs(path[i].gx - path[i - 1].gx);
    const ddy = Math.abs(path[i].gy - path[i - 1].gy);
    expect(ddx).toBeLessThanOrEqual(1);
    expect(ddy).toBeLessThanOrEqual(1);
    expect(ddx + ddy).toBeGreaterThan(0); // no self-loops
  }
}

/** all-walkable NxN mask. */
function openMask(n: number): boolean[][] {
  return Array.from({ length: n }, () => Array(n).fill(true));
}

// ---------------------------------------------------------------------------
// findPath
// ---------------------------------------------------------------------------

describe("findPath", () => {
  it("returns a single-element path when start === end (already there)", () => {
    const grid = makeGrid(openMask(10));
    const path = findPath(w(3, 3), w(3, 3), undefined, grid);
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual({ gx: 3, gy: 3 });
  });

  it("returns a cardinal straight line for an unobstructed horizontal move", () => {
    const grid = makeGrid(openMask(10));
    const path = findPath(w(0, 0), w(5, 0), undefined, grid);

    // With dy=0 there is no diagonal progress to be made, so every step is
    // the cardinal (+1, 0). The path is unique and minimal: 6 tiles.
    expect(path).toHaveLength(6);
    expect(path[0]).toEqual({ gx: 0, gy: 0 });
    expect(path[5]).toEqual({ gx: 5, gy: 0 });
    assertContiguous(path);
  });

  it("uses a diagonal step when both dx and dy are nonzero (octile-optimal)", () => {
    const grid = makeGrid(openMask(10));
    const path = findPath(w(0, 0), w(3, 3), undefined, grid);

    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[0]).toEqual({ gx: 0, gy: 0 });
    expect(path[path.length - 1]).toEqual({ gx: 3, gy: 3 });
    assertContiguous(path);
    // Optimal diagonal path = 3 diagonal steps + 1 start = 4 tiles.
    expect(path).toHaveLength(4);
    // Every interior step should be a diagonal (+1,+1) — that's what makes
    // the octile heuristic optimal here.
    for (let i = 1; i < path.length; i++) {
      expect(path[i].gx - path[i - 1].gx).toBe(1);
      expect(path[i].gy - path[i - 1].gy).toBe(1);
    }
  });

  it("routes around a vertical wall through the only gap", () => {
    // 10x10 with a vertical wall at gx=5 covering gy=0..8, leaving a gap at gy=9.
    const mask = openMask(10);
    for (let gy = 0; gy <= 8; gy++) mask[gy][5] = false;
    const grid = makeGrid(mask);

    const path = findPath(w(2, 4), w(8, 4), undefined, grid);

    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual({ gx: 2, gy: 4 });
    expect(path[path.length - 1]).toEqual({ gx: 8, gy: 4 });
    // No tile of the path may sit on the wall.
    for (const p of path) {
      if (p.gx === 5) expect(p.gy).toBe(9); // only the gap is allowed
    }
    assertContiguous(path);
  });

  it("refuses to cut a diagonal corner between two walls", () => {
    // Two adjacent walls forming an L; the diagonal between their shared corner
    // must not be used. Agent goes around cardinally.
    // Layout (3x3), S=start, E=end, #=wall:
    //   S . .
    //   # # .
    //   . . E
    const mask = [
      [true, true, true],
      [false, false, true],
      [true, true, true],
    ];
    const grid = makeGrid(mask);

    const path = findPath(w(0, 0), w(2, 2), undefined, grid);
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual({ gx: 0, gy: 0 });
    expect(path[path.length - 1]).toEqual({ gx: 2, gy: 2 });
    // The (0,0)→(1,1) diagonal is blocked because both (1,0) is walkable but
    // (0,1) is not — corner-cutting prevention forces a cardinal detour.
    assertContiguous(path);
  });

  it("returns [] when the start tile is unwalkable and nothing is reachable", () => {
    // Fully-walled grid → findNearestWalkable spiral finds nothing.
    const mask = [
      [false, false, false],
      [false, false, false],
      [false, false, false],
    ];
    const grid = makeGrid(mask);

    const path = findPath(w(1, 1), w(2, 2), undefined, grid);
    expect(path).toEqual([]);
  });

  it("returns [] when start and end are in disconnected regions", () => {
    // 5x5 with a full vertical wall at gx=2 splitting the grid in two.
    // Start on the left, end on the right → unreachable without snapping.
    const mask = openMask(5);
    for (let gy = 0; gy < 5; gy++) mask[gy][2] = false;
    const grid = makeGrid(mask);

    const path = findPath(w(0, 2), w(4, 2), undefined, grid);
    expect(path).toEqual([]);
  });

  it("ignores an `ignoreAgentId` argument (stub has no agent obstacles)", () => {
    const grid = makeGrid(openMask(10));
    const a = findPath(w(0, 0), w(3, 0), undefined, grid);
    const b = findPath(w(0, 0), w(3, 0), "agent-42", grid);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// gridPathToWorld
// ---------------------------------------------------------------------------

describe("gridPathToWorld", () => {
  it("converts each grid tile to the center of its world tile", () => {
    const grid = makeGrid(openMask(5));
    const world = gridPathToWorld(
      [
        { gx: 0, gy: 0 },
        { gx: 1, gy: 0 },
        { gx: 1, gy: 1 },
      ],
      grid,
    );
    expect(world).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: 0.5 },
      { x: 1.5, y: 1.5 },
    ]);
  });

  it("returns [] for an empty grid path", () => {
    const grid = makeGrid(openMask(5));
    expect(gridPathToWorld([], grid)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findWorldPath
// ---------------------------------------------------------------------------

describe("findWorldPath", () => {
  it("equals the composition findPath → gridPathToWorld for a routable move", () => {
    const grid = makeGrid(openMask(10));
    const world = findWorldPath(w(0, 0), w(3, 2), undefined, grid);

    const expected = gridPathToWorld(
      findPath(w(0, 0), w(3, 2), undefined, grid),
      grid,
    );
    expect(world).toEqual(expected);
    expect(world.length).toBeGreaterThan(0);
  });

  it("returns [] when no path exists (does NOT fall back to a straight line)", () => {
    const grid = makeGrid([
      [true, true, true],
      [false, false, false],
      [true, true, true],
    ]);
    // The codebase comment is explicit: "DO NOT return direct path as it may
    // go through obstacles." Pin that contract.
    expect(findWorldPath(w(0, 0), w(2, 2), undefined, grid)).toEqual([]);
  });
});
