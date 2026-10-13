# Curriculum Tree full-window map QA

The tree now opens `curriculum.html` from the existing Hub navigation. The
standalone page fills the viewport. Its 275 positioned cards share the existing
catalog and layout source; display rectangles are expanded and separated at
runtime so cards remain readable and do not overlap. The source JSON is not
rewritten. The 335 stored relations are optional advisory lines, not official
prerequisites.

`curriculum-config.js` keeps public access **OFF**. A local preview uses
`http://127.0.0.1:<port>/index.html?curriculumPreview=1`; direct non-local
access to `curriculum.html` remains unavailable with the committed setting.

## Browser evidence

Run `node scripts/qa/curriculum-map.cjs` to repeat the isolated Chrome/CDP
check. It starts a local HTTP server, uses a disposable browser profile and
tests a public-ON response in memory without changing the committed flag. The
script closes Chrome and removes its profile after the run.

- 1440×900, 1280×800 and 390×844: viewport-sized map, initial 100% scale,
  readable subject cards, no document overflow; screenshots in
  `docs/qa/curriculum-map-fullscreen/`.
- The menu navigated to a visible 1st-, 2nd-, 3rd- and 4th-year card at each
  width. Search moved the camera to every catalog course: 275 × 3 successful
  viewport reachability checks. These inspect card geometry after camera
  motion, rather than only counting DOM nodes.
- Real Chrome pointer drag panned the map; wheel zoom, 100%, fit, touch pan and
  pinch zoom updated the camera. A touch tap opened course detail. Native card
  drag to the temporary enrollment target saved the course without opening
  its detail. Enabling reference lines drew exactly 335 paths.
- Course detail, add/remove, reload, and Hub list synchronization passed.
  The menu link returned from the standalone preview to the Hub.
  Unknown existing IDs survived; `completedClasses` and
  `fourYearSimulatorPlanV1` remained byte-for-byte unchanged. A rejected
  `localStorage` write left the saved enrollment unchanged. All test storage
  was removed with the temporary profile.
- Browser JavaScript exceptions: 0. One `net::ERR_ABORTED` request occurred
  during navigation; no critical asset failed.

## Distribution and source limits

If Netlify publishes the repository root, `_redirects` forces 404 responses
for `docs/`, `tests/`, `tmp/`, and `scripts/`, including these QA artifacts.
The actual publish directory and Deploy Preview policy still require Netlify
project settings confirmation. The official 2026 curriculum PDF was inspected
for visual structure but is not included in the repository or runtime assets.
Its public reuse permission remains unverified. No production deployment was
performed.
