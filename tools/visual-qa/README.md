# Visual QA (v9.1 review)

Playwright scripts used for the v9.1 before/after review. They drive a real match through the
`?debug` hooks (read-only, plus photo helpers: `pause`, `orbit`, `zoom`, `place`, `sprint`, and
`&deal=nation,role` for a fixed faction/role), so two builds can be shot from the same spots.

```bash
npm i -D playwright            # or use a global install; CHROME=/path/to/chrome to pick a browser
npm run build                  # then serve two builds, e.g. old on :4180, new on :4191
python3 -m http.server 4191 -d dist
mkdir -p ../qa ../perf          # the scripts write next to their folder: ../qa, ../perf
node qa.cjs   before http://localhost:4180/   # characters, line-ups, streets, time of day
node qa.cjs   after  http://localhost:4191/
node chars.cjs before http://localhost:4180/  # 2x character close-ups
node stairs.cjs after http://localhost:4191/  # stair entrances, day / night
node gp.cjs   after  http://localhost:4191/   # TRACE -> LOCK POINT, stairs, meeting (prints JSON)
BASE=http://localhost:4191/ node tour.cjs after 1366 768   # draw calls / triangles / memory per spot
python3 pair.py out.jpg "title" before after enemy-front enemy-back   # side-by-side sheet
python3 expo.py ../qa/after-shibuya-day.png                            # exposure numbers
```

Headless Chromium here renders with SwiftShader (CPU). Its fps says nothing about a real GPU;
compare draw calls, triangles and memory instead, and measure frame time on a device with
`__sangoku.frameStats()` (open the game with `?debug`, play ~10 s, run it in the console).
