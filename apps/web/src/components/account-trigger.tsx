"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ChevronDownIcon } from "lucide-react";
import { bitmap } from "@/lib/glitch-title-piece";
import { cn } from "@/lib/utils";

type AccountTriggerProps = ComponentProps<"button"> & {
  name: string;
  image?: string | null;
  overrideEnabled?: boolean;
};

const SIZE = 30;
const LEVELS = [0.1, 0.28, 0.46, 0.64, 0.82, 1];

function initialLevels(name: string): number[][] {
  const px = bitmap(name.slice(0, 1) || "?");
  const scale = 3;
  const left = (SIZE - px[0].length * scale) >> 1;
  const top = (SIZE - px.length * scale) >> 1;
  return Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) =>
      px[Math.floor((y - top) / scale)]?.[Math.floor((x - left) / scale)]
        ? 1
        : 0.18,
    ),
  );
}

function useAvatarLevels(name: string, image: string | null | undefined) {
  const [photo, setPhoto] = useState<{
    src: string;
    levels: number[][];
  } | null>(null);
  const initial = useMemo(() => initialLevels(name), [name]);

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    const img = new Image();
    img.src = `/_next/image?url=${encodeURIComponent(image)}&w=64&q=75`;
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(img, 0, 0, SIZE, SIZE);
      const { data } = context.getImageData(0, 0, SIZE, SIZE);
      const light: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        light.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
      const lo = Math.min(...light);
      const span = Math.max(1, Math.max(...light) - lo);
      setPhoto({
        src: image,
        levels: Array.from({ length: SIZE }, (_, y) =>
          Array.from(
            { length: SIZE },
            (_, x) =>
              LEVELS[
                Math.min(
                  LEVELS.length - 1,
                  Math.floor(
                    ((light[y * SIZE + x] - lo) / span) * LEVELS.length,
                  ),
                )
              ],
          ),
        ),
      });
    };
    return () => {
      cancelled = true;
    };
  }, [image]);

  return photo && photo.src === image ? photo.levels : initial;
}

export function AccountTrigger({
  name,
  image,
  overrideEnabled = false,
  className,
  ...props
}: AccountTriggerProps) {
  const levels = useAvatarLevels(name, image);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, SIZE, SIZE);
    context.fillStyle = getComputedStyle(canvas).color;
    levels.forEach((row, y) =>
      row.forEach((level, x) => {
        context.globalAlpha = level;
        context.fillRect(x, y, 1, 1);
      }),
    );
  }, [levels, overrideEnabled]);

  return (
    <button
      type="button"
      className={cn(
        "group flex min-w-0 flex-col items-end gap-1 pr-[4ch] text-[4px] text-terminal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:text-[5px]",
        className,
      )}
      {...props}
    >
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
        className="size-[9em] [image-rendering:pixelated] transition-opacity group-hover:opacity-80 group-data-[state=open]:opacity-80"
      />
      <span className="flex items-center gap-1 py-0.5 text-xs leading-4 text-terminal-300/70 transition-colors group-hover:text-terminal-300 group-data-[state=open]:text-terminal-300">
        <span className="max-w-40 truncate">{name}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
        />
      </span>
    </button>
  );
}
