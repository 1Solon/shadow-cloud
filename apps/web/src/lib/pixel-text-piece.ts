import type { Piece } from "ascii.rest";
import { bitmap } from "@/lib/glitch-title-piece";

const ROWS = 9;

export function pixelTextPiece(
  text: () => string,
  widest: string,
): Piece<Record<string, never>> {
  const cols = bitmap(widest)[0].length;

  return {
    meta: {
      name: "pixel text",
      category: "type",
      note: "a line of still pixel lettering",
      cols,
      rows: ROWS,
      fps: 1,
      clock: true,
    },
    default() {
      return () => {
        const px = bitmap(text());
        const lines = [" ".repeat(cols)];
        for (const row of px) {
          const line = row.map((on) => (on ? "█" : " ")).join("");
          lines.push(line.padStart(cols).slice(-cols));
        }
        lines.push(" ".repeat(cols));
        return lines.join("\n");
      };
    },
  };
}
