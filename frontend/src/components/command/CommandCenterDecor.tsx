"use client";

import { type ReactNode } from "react";
import type { OfficeTextures } from "@/hooks/useOfficeTextures";
import { CANVAS_WIDTH } from "@/constants/canvas";
import { EmployeeOfTheMonth } from "../game/EmployeeOfTheMonth";
import { EXIT_DOOR_X, TOP_WALL_H, FLOOR_DECOR_Y } from "./layout";

interface CommandCenterDecorProps {
  textures: OfficeTextures;
}

/**
 * Open-plan decor using the existing office sprites: a framed wall photo,
 * a water cooler near the elevator, and a small floor plant.
 */
export function CommandCenterDecor({
  textures: t,
}: CommandCenterDecorProps): ReactNode {
  const floorY = FLOOR_DECOR_Y + 40;

  return (
    <pixiContainer>
      {/* ---- Top wall: framed photo, outlet, and water cooler. ---- */}
      <pixiContainer x={50} y={50}>
        <EmployeeOfTheMonth />
      </pixiContainer>
      {t.wallOutlet && (
        <pixiSprite
          texture={t.wallOutlet}
          anchor={0.5}
          x={905}
          y={TOP_WALL_H - 32}
          scale={0.045}
        />
      )}
      {t.waterCooler && (
        <pixiSprite
          texture={t.waterCooler}
          anchor={0.5}
          x={EXIT_DOOR_X + 120}
          y={TOP_WALL_H - 50}
          scale={0.19}
        />
      )}

      {/* ---- Bottom floor furniture (base on the floor) ---- */}
      {t.plant && (
        <pixiSprite
          texture={t.plant}
          anchor={{ x: 0.5, y: 1 }}
          x={CANVAS_WIDTH - 60}
          y={floorY}
          scale={0.11}
        />
      )}
    </pixiContainer>
  );
}
