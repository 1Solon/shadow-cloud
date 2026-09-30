"""Build the Shadow Cloud icon masters from source-art.png.

Outputs, next to this script:
  app-icon.png  1024px dark rounded tile, the desktop app icon
  icon.ico      head silhouette, 16-256px, for Windows and the web favicon

Regenerate everything (needs Pillow and numpy):
  python3 apps/desktop/icon-source/build.py
  (cd apps/desktop && pnpm tauri icon icon-source/app-icon.png)
  cp apps/desktop/icon-source/icon.ico apps/desktop/src-tauri/icons/icon.ico
  cp apps/desktop/icon-source/icon.ico apps/web/src/app/favicon.ico

`tauri icon` overwrites src-tauri/icons/icon.ico, so the copies must come after it.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
ORANGE = (232, 110, 20)
GLOW = (255, 140, 40)
TILE = (22, 18, 16)
INK = (14, 12, 11)
S = 2048  # working canvas size
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]

# Jackal head outline in source-art.png's 512px coordinates.
HEAD = [
    (183, 80), (214, 158), (256, 146), (298, 158), (329, 80), (352, 185),
    (344, 214), (378, 238), (374, 300), (330, 372), (272, 430), (256, 442),
    (240, 430), (182, 372), (138, 300), (134, 238), (168, 214), (160, 185),
]  # fmt: skip


def stroke_mask():
    """Orange strokes of the source art as an alpha mask, with the glow removed."""
    red = np.array(Image.open(HERE / "source-art.png").convert("RGB"))[..., 0].astype(float)
    alpha = Image.fromarray((np.clip((red - 125) / 45, 0, 1) * 255).astype("uint8"))
    left, top, right, bottom = alpha.point(lambda v: 255 if v > 60 else 0).getbbox()
    pad = 20  # room for the glow and head outline
    return alpha, (left - pad, top - pad, right + pad, bottom + pad)


def head_mask():
    mask = Image.new("L", (512 * 4, 512 * 4))
    ImageDraw.Draw(mask).polygon([(x * 4, y * 4) for x, y in HEAD], fill=255)
    return mask.filter(ImageFilter.GaussianBlur(1.5))


def colored(mask, color):
    layer = Image.new("RGBA", mask.size, color + (0,))
    layer.putalpha(mask)
    return layer


def place(canvas, layer, scale):
    """Centre layer on canvas at scale * canvas height."""
    h = int(canvas.height * scale)
    w = int(layer.width * h / layer.height)
    canvas.alpha_composite(
        layer.resize((w, h), Image.LANCZOS), ((canvas.width - w) // 2, (canvas.height - h) // 2)
    )
    return canvas


def main():
    alpha, box = stroke_mask()
    alpha = alpha.crop(box)
    # Work at 4x, re-sharpening edges softened by the upscale.
    strokes = (
        alpha.resize((alpha.width * 4, alpha.height * 4), Image.LANCZOS)
        .filter(ImageFilter.GaussianBlur(3))
        .point(lambda v: max(0, min(255, int((v - 128) * 2.2 + 128))))
    )

    # App icon: strokes with a soft glow on a dark rounded tile.
    tile = Image.new("RGBA", (S, S))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, S - 1, S - 1), int(S * 0.22), fill=TILE + (255,))
    glow = colored(strokes.filter(ImageFilter.GaussianBlur(40)), GLOW)
    glow.putalpha(glow.getchannel("A").point(lambda v: int(v * 0.55)))
    symbol = Image.new("RGBA", strokes.size)
    symbol.alpha_composite(glow)
    symbol.alpha_composite(colored(strokes, ORANGE))
    place(tile, symbol, 0.86).resize((1024, 1024), Image.LANCZOS).save(HERE / "app-icon.png")

    # .ico: strokes on a jackal head silhouette, no container.
    head = Image.new("RGBA", strokes.size)
    head.alpha_composite(colored(head_mask().crop(tuple(v * 4 for v in box)), INK))
    head.alpha_composite(colored(strokes, ORANGE))
    ico = place(Image.new("RGBA", (S, S)), head, 1.0)
    ico.resize((256, 256), Image.LANCZOS).save(HERE / "icon.ico", sizes=ICO_SIZES)


if __name__ == "__main__":
    main()
