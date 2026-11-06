# README banner in the replay site's pixel style. Make it: python3 scripts/readme/banner.py /tmp/b.html, then
#   google-chrome --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=1600,440 \
#     --virtual-time-budget=10000 --screenshot=docs/rover/media/rover-hire-banner.png file:///tmp/b.html
CHALK, DIM, ACCENT, RULE, NIGHT = "#f2ede3", "#a39d90", "#ff6a13", "#2b2b2b", "#0a0a0a"
SPR = {  # from apps/replay/lib/pixels.ts and components/scene.tsx
  "rover": [".........", "......**.", "......#..", ".#######.", ".#.#.#.#.", ".#######.", "..##.##..", "..##.##..", "........."],
  "parcel": [".........", ".#######.", ".#..*..#.", ".#######.", ".#.....#.", ".#.###.#.", ".#.....#.", ".#######.", "........."],
  "coin": [".###.", "#####", "##.##", "#####", ".###."],
  "lock": ["...###...", "..#...#..", "..#...#..", ".#######.", ".###*###.", ".###*###.", ".#######.", ".........", "........."],
  "chip": [".........", ".#.#.#.#.", "#########", ".#.....#.", "##.***.##", ".#.....#.", "#########", ".#.#.#.#.", "........."],
}
def sprite(rows, x, y, cell, ink=CHALK, star=ACCENT):
    out = []
    for j, r in enumerate(rows):
        for i, c in enumerate(r):
            if c in "#*":
                out.append(f'<rect x="{x + i*cell}" y="{y + j*cell}" width="{cell}" height="{cell}" fill="{star if c == "*" else ink}"/>')
    return "".join(out)
def icon(name, cell=3, ink=CHALK):
    rows = SPR[name]; w = len(rows[0]) * cell; h = len(rows) * cell
    return f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" shape-rendering="crispEdges">{sprite(rows, 0, 0, cell, ink)}</svg>'

# Scene on the right: a dotted orbit round the parcel, the rover on it, coins paid along the way.
W, H = 640, 440
scene = [f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" shape-rendering="crispEdges">']
cx, cy, rx, ry = 330, 225, 200, 140
import math
for k in range(48):
    a = 2 * math.pi * k / 48
    px, py = round((cx + rx * math.cos(a)) / 6) * 6, round((cy + ry * math.sin(a)) / 6) * 6
    scene.append(f'<rect x="{px}" y="{py}" width="6" height="6" fill="{RULE if k % 2 else DIM}"/>')
scene.append(sprite(SPR["parcel"], cx - 54, cy - 54, 12))
scene.append(sprite(SPR["rover"], cx - rx - 45, cy - 45, 10))
for k, (dx, dy) in enumerate([(-150, -128), (-40, -150), (80, -146), (190, -100)]):
    scene.append(sprite(SPR["coin"], cx + dx, cy + dy, 7, ink=ACCENT, star=ACCENT))
scene.append("</svg>")

chips = "".join(f'<div class="chip">{icon(n)}<span>{t}</span></div>' for n, t in
                [("coin", "No pay, no move"), ("chip", "No brain, no move"), ("lock", "No proof, no move")])
html = f'''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist+Pixel&family=Geist+Mono:wght@400&family=Silkscreen&display=block" rel="stylesheet">
<style>
  html, body {{ margin: 0; background: {NIGHT}; }}
  .b {{ width: 1600px; height: 440px; position: relative; overflow: hidden; background: {NIGHT};
        background-image: radial-gradient({RULE} 1.2px, transparent 1.3px); background-size: 24px 24px; }}
  .l {{ position: absolute; left: 72px; top: 64px; }}
  .tag {{ font: 15px Silkscreen; letter-spacing: .32em; color: {DIM}; text-transform: uppercase; }}
  .tag b {{ color: {ACCENT}; font-weight: 400; }}
  h1 {{ margin: 22px 0 0; font: 400 136px/1 'Geist Pixel'; color: {CHALK}; letter-spacing: .02em; }}
  h1 span {{ color: {ACCENT}; }}
  p {{ margin: 22px 0 0; font: 25px 'Geist Mono'; color: {CHALK}; }}
  .chips {{ display: flex; gap: 14px; margin-top: 34px; }}
  .chip {{ display: flex; align-items: center; gap: 12px; border: 2px solid {RULE}; padding: 10px 16px 10px 12px;
           font: 15px Silkscreen; letter-spacing: .18em; color: {CHALK}; text-transform: uppercase; background: {NIGHT}; }}
  .r {{ position: absolute; right: 30px; top: 0; }}
  .rule {{ position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: {ACCENT}; }}
</style></head><body><div class="b">
  <div class="l">
    <div class="tag">ETHGlobal Mumbai 2026 <b>·</b> 0G <b>×</b> Hedera</div>
    <h1>ROVER<span>/</span>HIRE</h1>
    <p>An AI that rents a robot body, and pays for every move.</p>
    <div class="chips">{chips}</div>
  </div>
  <div class="r">{"".join(scene)}</div>
  <div class="rule"></div>
</div></body></html>'''
open(__import__("sys").argv[1], "w").write(html)
