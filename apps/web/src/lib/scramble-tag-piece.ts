// Adapted from the "scramble" piece of ascii.rest by bas3line (https://github.com/bas3line/ascii), MIT licensed.
// One left-aligned line sized to its longest phrase, starting settled on the first phrase.

import type { Piece } from "ascii.rest";

type ScrambleOptions = { phrases: string[] };

const GLYPHS = "!<>-_\\/[]{}=+*^?#%&$@0123456789abcdefxyz";
const OUT = 0.022;
const IN = 0.05;
const LEAD = 0.32;
const HOLD = 2.4;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step = {
  from: string;
  to: string;
  width: number;
  out: number[];
  settle: number[];
  end: number;
};

export function scrambleTagPiece(phrases: string[]): Piece<ScrambleOptions> {
  const cols = Math.max(1, ...phrases.map((phrase) => phrase.length));

  return {
    meta: {
      name: "scramble tag",
      category: "type",
      note: "a short line decoding left to right between phrases",
      cols,
      rows: 1,
      fps: 20,
      options: { phrases },
    },
    default() {
      const rand = mulberry32(77);
      let at = 0;
      const steps: Step[] = phrases.map((to, i) => {
        const from = phrases[(i + phrases.length - 1) % phrases.length];
        const width = Math.max(from.length, to.length);
        const out: number[] = [];
        const settle: number[] = [];
        for (let c = 0; c < width; c++) {
          out.push(at + c * OUT + rand() * 0.06);
          settle.push(at + LEAD + c * IN + rand() * 0.14);
        }
        at = Math.max(at + LEAD, ...settle) + HOLD;
        return { from, to, width, out, settle, end: at };
      });
      const period = at;
      const offset = steps[0].end - HOLD;

      return (t: number) => {
        const now = (((t + offset) % period) + period) % period;
        const step = steps.find((candidate) => now < candidate.end) ?? steps[0];
        const tick = Math.floor(now * 20);
        const line = new Array<string>(cols).fill(" ");
        for (let c = 0; c < step.width; c++) {
          const a = step.from[c] ?? " ";
          const b = step.to[c] ?? " ";
          if (now < step.out[c]) line[c] = a;
          else if (now >= step.settle[c]) line[c] = b;
          else if (a === " " && b === " ") line[c] = " ";
          else {
            let h = Math.imul(c ^ Math.imul(tick, 0x27d4eb2d), 0x9e3779b1);
            h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
            line[c] = GLYPHS[((h ^ (h >>> 13)) >>> 0) % GLYPHS.length];
          }
        }
        return line.join("");
      };
    },
  };
}
