"""Writes the replay's icons from one 16×16 pixel rover: app/icon.svg, app/favicon.ico (16/32/48), app/apple-icon.png."""
from pathlib import Path

from PIL import Image

ROVER = [
    "................",
    "................",
    ".........*****..",
    ".........*****..",
    "...........#....",
    "...........#....",
    "..############..",
    "..#.##.##.##.#..",
    "..############..",
    "..############..",
    "................",
    "...###....###...",
    "..#####..#####..",
    "..#####..#####..",
    "...###....###...",
    "................",
]
COLORS = {".": "#0a0a0a", "#": "#f2ede3", "*": "#ff6a13"}
APP = Path(__file__).resolve().parent.parent / "app"
assert len(ROVER) == 16 and all(len(r) == 16 for r in ROVER)


def png(scale: int, pad: int = 0) -> Image.Image:
    size = 16 * scale + 2 * pad
    img = Image.new("RGBA", (size, size), COLORS["."])  # RGBA: Next decodes ICO frames only as RGBA PNGs
    for y, row in enumerate(ROVER):
        for x, c in enumerate(row):
            if c != ".":
                img.paste(COLORS[c], (pad + x * scale, pad + y * scale, pad + (x + 1) * scale, pad + (y + 1) * scale))
    return img


rects = "".join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{COLORS[c]}"/>'
                for y, row in enumerate(ROVER) for x, c in enumerate(row) if c != ".")
(APP / "icon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">'
                              f'<rect width="16" height="16" fill="{COLORS["."]}"/>{rects}</svg>\n')
png(3).save(APP / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
png(11, pad=2).save(APP / "apple-icon.png")
print("wrote icon.svg, favicon.ico, apple-icon.png")
