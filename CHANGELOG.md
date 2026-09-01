# Changelog

All notable changes to Omnia Pathology AI are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** — a change that breaks stored data or an existing integration
- **MINOR** — new capability, backwards compatible
- **PATCH** — fixes only

Releases are cut by tagging `vX.Y.Z`, which triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml) to build,
smoke-test and publish the macOS and Windows installers.

---

## [1.3.0] — 2026-09-01

### Added

- **Batch analysis.** Queue every unanalysed slide in a trial and work through
  them one at a time behind the interactive path — a sponsor handing over 1,500
  subjects is tens of thousands of slides, and clicking each one is not a
  workflow. The queue is persisted, so a restart mid-cohort resumes: anything
  left running by a dead process returns to pending rather than being dropped.
  Progress counts every settled item including failures, so a bar does not
  stall on a cohort where some slides cannot be read, and failures are named
  rather than only counted.
- **The Omnia Network.** A site can contribute its locally fine-tuned heads —
  never the backbone, never patient data — to a shared model. Consent is
  required and checked server-side, not merely gated by a disabled button, and
  both the consent and the contribution are written to the audit trail.
- **A light/dark switch inside the app.** The toggle existed but lived on the
  setup screen, so once a pathologist reached the dashboard there was no way to
  reach it — on software people sit in front of for a full shift, in rooms
  whose lighting is not up to them.

### Changed

- **Analysis progress reports elapsed time instead of a fabricated
  percentage.** The bar was driven by a 600 ms timer, not by the backend, and
  its captions ("Segmenting tissue regions", "Assessing biomarkers") described
  work the model does not do — grading is attention-MIL over sampled tiles. A
  minimum delay also held finished results back so the captions could play. The
  row now shows an indeterminate bar and the real elapsed seconds, and results
  appear as soon as they exist.
- Release publishing moved to a single job that runs after both platforms
  build. The macOS and Windows jobs each created the same GitHub release in
  parallel, which raced; worse, a Windows failure still left the macOS
  installer published on its own.
- Removed `OMNIA_MODEL_PATH`, which pointed every launch at
  `aria_model_dicom.pth` — a checkpoint from the retired DICOM product, read by
  nothing.

- **Clinical sky blue replaces the iOS navy**, through tokens rather than the
  literal hex that was hardcoded in 98 places and made the product
  unrethemeable. Each theme carries the shade that reads on its own ground, and
  the app icon is regenerated to match — including the .icns and .ico the
  installers embed, not only the PNG.
- **The dashboard and the patient profile are card-based.** The trial list was
  a nine-column table needing horizontal scroll on a laptop; the patient page
  was a nested list. Both now carry the same fields in cards, with an area
  chart for review progress and pill controls for search and filtering. Logs
  and the audit trail stay as tables, which is the right form for them.
- **No press animations.** Buttons no longer shrink when clicked. Feedback is a
  colour change; hover lift applies only to cards that are genuinely controls.
- **Loading states mirror the layout they replace** rather than showing a
  centred spinner that says nothing and then moves the page when data lands.

### Fixed

- **A fine-tune could be promoted on noise.** The held-out set chose which
  epoch to keep *and* then judged whether that epoch beat the current model.
  Taking the best of a dozen epochs on as few as six slides and reporting that
  maximum as held-out agreement measures the luckiest epoch, not the model.
  Epoch selection now uses a split carved out of the training data, and the
  held-out set is scored exactly twice — once for the baseline, once for the
  finished model — so the promotion figure is an estimate of the model rather
  than of the selection. The optimistic selection score is still recorded, as
  `selection_qwk`, so the gap between the two is visible.
- **A benign slide's report said its grade group was not assessed.** ISUP grade
  group 0 was tested for truthiness, so the one grade group that is legitimately
  zero rendered as "—" beside "Gleason Grade: Benign" on the same signed page.
  A genuine 0% confidence, 0 regions analysed and 0.0 s processing time were
  blanked the same way.
- **A doctor-corrected grade carried the model's confidence.** The report
  printed "Doctor-Corrected Grade" above the confidence of the prediction the
  pathologist had just overruled, reading as though the correction itself were
  82% confident.
- **Signed reports misstated their own provenance.** The footer hardcoded
  "Omnia AI v1.0" while the application was 1.2.3, and labelled a local
  timestamp as UTC — hours out on any machine east of Greenwich. Both now come
  from the real source. The report ID was `os.urandom(4)`, so reissuing a stored
  report produced a different identifier every time, contradicting the guarantee
  that an issued report can be produced again unchanged; it is now derived from
  the report's own identifying content.
- **Quitting left the backend and frontend running.** The `SIGKILL` escalation
  was scheduled with `setTimeout`, which Electron never waits for on quit, so
  the escalation was dead code and the leaked servers it existed to prevent
  kept happening — which is what made the *next* launch report a port conflict.
  Shutdown now waits for the children and signals the whole process group, so
  the PyInstaller bootstrap's own child is included.
- **Startup could force-kill unrelated software.** Port reclamation matched
  process names against `/omnia|next-server|node/i` and `SIGKILL`ed anything
  that matched on ports 3000 or 8000 — the default port for most local
  development servers — with no prompt and no visible message. Ownership is now
  established by PIDs recorded when the children are spawned.
- **A corrupt data file could fill the disk.** The quarantine copied the file
  and left the unreadable original in place, so every subsequent read
  quarantined it again under a new timestamp. With the dashboard polling, that
  is a fresh full copy roughly every second until the disk fills.
- **Accounts and sessions were the only data written without the store lock.**
  Every other stateful module used `transaction()`; `users.py` did not, so a
  login racing the session cleanup could be 401'd immediately after signing in
  successfully, and simultaneous registrations could drop a user record.
- Feature cache keys now include the feature extractor's identity. Cached tile
  embeddings are only reusable by the network that produced them, and shipping
  a retrained backbone would otherwise have silently reused the old ones.
- `write_json` fsyncs the directory as well as the file, so the rename is as
  durable as the contents — which is what this module claims to provide.
- The health check no longer leaks its abort timer on the failure path, which
  is the path taken continuously while the backend is down.
- "Try Again" on the port-conflict dialog no longer re-enters startup without
  bound.

### Security

- **The backend no longer publishes itself to the local network.** It bound
  `0.0.0.0`, so a hospital LAN or guest Wi‑Fi could reach the clinical API —
  verified against a shipped build from another address on the network. Nothing
  needs off-machine access: the desktop shell health-checks `127.0.0.1` and the
  bundled frontend was already pinned to loopback. It now binds `127.0.0.1`
  unless `OMNIA_BIND_HOST` is set deliberately, which logs a warning. This
  also closed the window in which `POST /api/users/bootstrap` — unauthenticated
  by necessity, since it creates the *first* account — was reachable by anyone
  on the network before the pathologist finished setup.
- **CORS no longer accepts every origin.** `allow_origins=["*"]` with
  credentials meant any web page the user had open could call the endpoints
  that do not require a session. Restricted to the app's own frontend.
- **`/api/system/preflight` requires a session once setup is complete.** It
  returns absolute filesystem paths and a per-dependency map of the machine. It
  stays open only while no account exists, because the setup wizard genuinely
  cannot authenticate.
- **`OMNIA_TEST_FAKE_GRADING` is refused in a packaged build.** The flag makes
  grading return a fixed result without running the model, for the test suite.
  It was honoured identically in the clinical build and surfaced nowhere — a
  fabricated grade reached a signed PDF indistinguishable from a real one. It
  is now ignored in a frozen build, and where it is honoured it is reported by
  `/health`, fails preflight as fatal, and is logged.
- **Session tokens are stored hashed, not in the clear.** Read access to the
  data directory was previously direct account access. Expired sessions are
  also pruned on every write instead of only when re-presented, which had let
  `sessions.json` grow for the life of an installation. Existing sessions are
  invalidated once by this change; users sign in again.

### Internal

- Integration suite grown to **148 tests**, including seven that read a
  generated PDF back and assert on what it renders, and seven covering the
  batch queue. The promotion-gate guard now tests the behaviour rather than
  grepping `finetune.py` for a literal line of source, which failed for the
  refactor that fixed the gate's real defect.
- A `/preview` route renders the dashboard's cards against synthetic data with
  no API calls, so a visual change can be reviewed without a backend, an
  account and seeded trials. It returns 404 in a production build.

## [1.2.3] — 2026-08-28

### Added

- **End-to-end inference smoke test**, run on macOS and Windows before a
  release publishes and on every push. The Windows check previously confirmed
  the bundled backend started and its dependencies imported — which is not the
  same as grading a slide. OpenSlide reporting a version proves the DLL
  loaded, not that its driver can open a slide and read tiles; importing torch
  is not a forward pass. The test now generates a tiled TIFF, opens it through
  OpenSlide, runs the model, and requires a valid ISUP grade group, confidence
  and attention weights.

## [1.2.2] — 2026-08-27

### Added

- **Sample model output in the repository** — the full analysis of a 60.9 MB
  whole-slide image (Gleason 4+5=9, ISUP grade group 5, 82.3% confidence, 32
  per-tile attention weights) and the signed pathology report generated from
  it. Genuine model output, not synthetic examples.

### Changed

- The README presents QWK 0.7996 as what it is: **measured performance**, with
  the evaluation setup, what the metric means, and where it sits relative to
  inter-pathologist agreement and the PANDA leaderboard. The previous wording
  ("not a performance claim") was simply wrong — QWK *is* a performance
  measurement. The accurate statement is that it has not been externally
  validated, which is a statement about scope, not about the score.

### Fixed

- **A signed pathology report could contradict itself.** Review state was
  inferred from whether a correction existed, so a slide the pathologist
  confirmed *unchanged* printed "Awaiting Review" in one table and
  "✓ Reviewed" in another, in the same document.
- **An unreviewed slide's report claimed it had been reviewed.** The status
  read `"✓ Reviewed" if doctor_correction or True else "⏳ Pending"` — the
  `or True` made the alternative unreachable, so the document asserted a review
  that had not happened. Review state is now passed in explicitly.

## [1.2.1] — 2026-08-27

### Fixed

- **The Windows installer shipped without a backend.** `extraResources`
  pointed at `dist/omnia-backend` on every platform; PyInstaller emits
  `omnia-backend.exe` on Windows, so the entry matched nothing. electron-builder
  only warns for a missing source and continues, so the installer built
  successfully and contained no backend — it would have installed and failed on
  launch. The backend now has per-platform entries and `desktop/main.js`
  resolves the matching filename at runtime.
- electron-builder no longer auto-publishes on seeing a git tag, which failed
  the build for a missing `GH_TOKEN`. Release assets are attached explicitly by
  the workflow.

## [1.2.0] — 2026-08-27

### Added

- **Patient registry and per-patient containers.** A patient is now a durable
  entity rather than a row on a visit. Identifiers are generated by the server
  and carry a Luhn mod-32 check character over a Crockford Base32 alphabet, so
  a mistyped ID is rejected instead of resolving to a different person.
  Measured: 0 undetected single-character substitutions in 74,400 mutations.
  Each patient gets a directory holding their slides and issued reports, and a
  view spanning every trial they are enrolled in.
- **Real on-site model fine-tuning**, replacing the simulated loop. Trains the
  attention and classifier heads on pathologist-signed slides with the backbone
  frozen, and promotes the result **only** when it agrees with the pathologist
  better than the current model on a held-out split it never trained on.
  Reverting to the shipped model is one click.
- **Supervised background workers** with crash isolation, exponential backoff
  and health reporting: recovery of interrupted training runs, removal of
  partial writes, cache size limits, model reload after a failed load, and a
  low-disk guard. Surfaced at `/api/system/workers` and in the dashboard.
- **Stored reports.** Generated PDFs are filed into the patient's container, so
  an issued report can be produced again unchanged.
- **Trial protocol identifier and phase**, validated against a closed
  vocabulary and searchable from the dashboard.
- **60-day evaluation licences** with an edition field, days-remaining display
  and an expiry warning.

### Changed

- **Corrections are now a grade-group selection, not free text.** A correction
  is a training label; `4+3=7`, `Gleason 4+3` and typos were all accepted and
  none resolved reliably to a grade.
- Training time estimates model the actual algorithm. The previous estimate
  assumed the whole network was retrained on every epoch and overstated
  duration by roughly two orders of magnitude.
- The fine-tuning screen shows the settings a run will actually use. It
  previously advertised a tile size and batch size that the training path
  never read.
- Start-up and failure screens speak in product terms. The launch screen no
  longer shows a host and port; the service address moved behind a technical
  details disclosure for support.
- `openslide-bin` supplies the OpenSlide native library on all platforms,
  which is what makes a Windows build able to read slides at all.

### Fixed

- **Every table clipped its trailing columns.** `overflow-hidden` on the card
  hid them with no way to scroll, and the page body scrolled sideways instead.
  On the patient registry, Sex, Site and Registered were unreachable.
- **The patient container reported zero analysed and zero signed slides** for
  patients that had both. It read the grade from a nested `analysis` object
  that slide records do not have.
- Recovery of interrupted training runs no longer marks a *live* run as
  interrupted when it runs on a schedule.
- A saturated analysis engine (`503 Retry-After`) is retried automatically
  instead of surfacing to the pathologist as a hard failure.
- The dashboard rendered its empty state for zero trials, hiding the greeting,
  figures and overview cards entirely on a fresh install.
- The review-progress chart rendered as one solid block with a single trial.
- Duplicate "Model Training" entry in the account menu.

### Security

- **Removed an unauthenticated licence-minting endpoint.** `POST
  /api/license/generate-dev-key` would issue a valid key to any caller. Key
  generation is now a build-time operation, available only when
  `OMNIA_DEV_TOOLS=true`.
- The licence signing secret moved to `OMNIA_LICENSE_SECRET`. When unset, the
  published development secret is used and `check_status()` reports the build
  as insecurely signed rather than implying enforcement it does not have.
- Runtime clinical data (`data/`), licence keys and `*.svs` files are
  explicitly excluded from version control.

### Internal

- Integration suite grown to **132 tests**, including guards that fail if
  fabricated data, simulated training or efficacy claims return.
- The build script no longer reports success over a failed build. Every step
  was piped through `tail`, so `set -e` only ever saw `tail`'s exit code; a
  packaging failure printed "Build complete" over an empty output directory.
- Windows CI now runs the bundled backend and checks every grading-critical
  dependency through `/api/system/preflight`. The previous check confirmed only
  that the file had a PE header, which a backend with no working OpenSlide
  passes.

---

## [1.1.3] — 2026-08

### Added

- Real prostate grading model (attention-MIL over EfficientNet-B0, QWK 0.7996)
  replacing mock analysis, with an attention overlay and whole-slide viewer.
- Longitudinal per-subject timelines and cohort analytics.
- Investigational-product profiles with RDKit-computed chemistry.
- Desktop packaging: Electron shell with a PyInstaller-bundled backend.
- Audit trail, electronic signatures and role-based access.

[1.3.0]: https://github.com/mishel-0/Omnia-AI/releases/tag/v1.3.0
[1.2.3]: https://github.com/mishel-0/Omnia-AI/releases/tag/v1.2.3
[1.2.2]: https://github.com/mishel-0/Omnia-AI/releases/tag/v1.2.2
[1.2.1]: https://github.com/mishel-0/Omnia-AI/releases/tag/v1.2.1
[1.2.0]: https://github.com/mishel-0/Omnia-AI/releases/tag/v1.2.0
[1.1.3]: https://github.com/mishel-0/Omnia-AI/releases/tag/v1.1.3
