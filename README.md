<h1 align="center">Omnia Pathology AI</h1>

<p align="center">
  <b>An offline desktop application that grades prostate biopsy slides with a trained
  attention-MIL model — and is built so a pathologist, not the model, is accountable
  for every result.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/QWK-0.7996-success" alt="Quadratic weighted kappa 0.7996"/>
  <img src="https://img.shields.io/badge/tests-132%20passing-brightgreen" alt="132 tests passing"/>
  <img src="https://img.shields.io/badge/runs-100%25%20offline-informational" alt="Runs fully offline"/>
  <img src="https://img.shields.io/badge/use-research%20only-critical" alt="Research use only"/>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT licence"/>
</p>

<p align="center">
  <a href="#the-problem">Problem</a> •
  <a href="#performance">Performance</a> •
  <a href="#engineering-worth-reading">Engineering</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#run-it">Run it</a> •
  <a href="#limitations">Limitations</a>
</p>

<p align="center">
  <img src="assets/screenshots/07-ai-analysis.png" width="100%"
       alt="AI analysis of a whole-slide image with an attention overlay showing which tissue drove the grade"/>
</p>
<p align="center">
  <sub>A real 60.9 MB whole-slide image graded by the bundled model — Gleason 4+5=9, ISUP grade group 5,
  82.3% confidence. The overlay shades the 32 sampled regions by how much each drove the grade.
  Fields the model does not produce read <i>“Not assessed”</i> rather than being filled in.</sub>
</p>

---

## The problem

A pathology core lab running a multi-site prostate cancer trial has to grade thousands
of biopsy slides consistently, keep a regulator-grade record of who decided what, and
never let an automated result reach a report unless a person signed it.

Two constraints shape everything here. Whole-slide images are **gigapixel files** — a
single slide is 15,374 × 17,497 px and 60 MB compressed, so nothing can be loaded
naively into memory. And patient data **cannot leave the building**, which rules out
every cloud inference API and means the model has to run acceptably on the laptop a
clinic already owns.

Omnia is the full workflow — upload, grade, review, sign, audit, report — around a
model that runs locally in ~42 s per slide on CPU.

---

## Highlights

| | |
|---|---|
| **Trained model, not an API call** | Gated attention-MIL over EfficientNet-B0, trained on PANDA to **QWK 0.7996** — inside the range published for pathologist-to-pathologist agreement |
| **Explains itself** | Per-tile attention weights are surfaced as an overlay, so a pathologist can see *which tissue* produced the grade instead of being handed a number |
| **Fine-tuning that can't make things worse** | The model adapts to a site's own signed slides, and is promoted **only** if it beats the current model on a held-out split it never trained on. Verified in both directions |
| **Identifiers that reject typos** | Generated patient IDs carry a Luhn mod-32 check character: **0 undetected single-character substitutions across 74,400 mutations** |
| **Tested against its own dishonesty** | Of 132 integration tests, several exist purely to fail if fabricated data, simulated training, or unsupported efficacy claims ever return |
| **Ships on two platforms, verified** | CI builds macOS and Windows installers and **runs the bundled backend** on a Windows runner, failing the build if OpenSlide, torch or the model didn't load |

~6,500 lines of Python, ~7,900 of TypeScript, no cloud services, no telemetry.

---

## Performance

**Quadratic weighted kappa: 0.7996** on a held-out split of PANDA
(Prostate cANcer graDe Assessment).

| | |
|---|---|
| **Metric** | Quadratic weighted kappa (QWK) |
| **Score** | **0.7996** |
| **Task** | ISUP grade group 0–5 from a whole-slide image |
| **Dataset** | PANDA — ~10,600 prostate biopsy WSIs (Radboud + Karolinska) |
| **Evaluation** | Held-out split, single fold |
| **Inference** | ~42 s/slide, CPU only (Apple M5, no dedicated GPU) |

QWK is the metric prostate grading is scored on, because grades are **ordinal**:
calling a grade 5 slide “grade 1” is far worse than calling it “grade 4”, and plain
accuracy treats those as the same mistake. QWK weights each error by the square of how
far off it is. 1.0 is perfect; 0 is chance.

**Where 0.7996 sits.** Gleason grading is genuinely hard to agree on — published
inter-observer studies typically report kappa of **0.6–0.8 between pathologists on the
same slides**, and this model is inside that band. Top PANDA challenge entries reached
roughly 0.9 using large ensembles and far more training compute. This is a strong
single-model baseline, not state of the art, and it is described that way on purpose.

**What has and hasn't been measured.** One fold, one dataset, no external validation on
slides from a different scanner or lab. That is a statement about the extent of the
evaluation, not a hedge about the number: 0.7996 is this model's real measured
performance on that split. External-cohort validation is the work required before any
clinical claim.

### See the output yourself

| File | What it is |
|---|---|
| [`JP2K-33003-1_analysis.json`](assets/sample-output/JP2K-33003-1_analysis.json) | Complete analysis of a 60.9 MB slide — grade, confidence, timing, and all 32 per-tile attention weights with coordinates |
| [`..._Baseline_report.pdf`](assets/sample-output/OMN-PC-301_OMN-7K45-KGKM_Baseline_report.pdf) | The signed pathology report generated from that analysis |

Genuine model output on a public slide — the overlay at the top of this page is the
same analysis, rendered.

---

## Engineering worth reading

The parts of this codebase where a real decision had to be made, and why it went the
way it did.

<details>
<summary><b>A fine-tune that is allowed to fail</b> — <code>backend/finetune.py</code></summary>

<br/>

Sites want the model adapted to their own scanner and stain. The naive version of that
feature ships a model that is quietly worse than the one it replaced.

Two decisions:

**The backbone stays frozen.** A site with a few dozen signed slides has a few dozen
labels. EfficientNet-B0's backbone has ~4M parameters; fitting it to that many examples
memorises them. Only the attention and classifier heads train — a few hundred thousand
parameters over pre-computed features, which is honest at that data scale and runs on a
clinic's CPU.

**Promotion is gated on measured improvement.** Training runs on part of the signed
slides and is scored on a held-out part it never saw. The new model goes live *only* if
it agrees with the pathologist better than the current one on those held-back slides.
Verified both ways:

```
learnable signal → QWK 0.7317 → 0.8710   promoted ✓   (best epoch selected on held-out, not last)
random labels    → QWK 0.0    → 0.0      rejected ✓   (no checkpoint written, model unchanged)
```

The QWK implementation was checked against an independent implementation across 3,000
random cases before promotion was allowed to depend on it.
</details>

<details>
<summary><b>Identifiers where the dangerous failure isn't "not found"</b> — <code>backend/patients.py</code></summary>

<br/>

Patients were originally keyed on a hand-typed string, so `PT-001`, `PT001` and
`pt 001` were three subjects to the system and one to the person entering them — which
silently corrupts every longitudinal analysis built on top.

IDs are now generated server-side over a **Crockford Base32** alphabet with a **Luhn
mod-32 check character**. The failure that matters isn't "ID not found", it's "ID found,
wrong person" — so a mistyped identifier is rejected rather than resolved.

The first implementation used a 31-character alphabet and left **4 of 240 substitutions
undetected**. Luhn mod-N only catches every single-character substitution when N is
*even* — with odd N the doubling step collides (values 1 and 16 both map to 2). Moving
to 32 symbols fixed it:

```
single-character substitutions : 74,400 tested,  0 undetected
adjacent transpositions        :  2,025 tested,  2 undetected  (~0.1%, the known Luhn limit)
```
</details>

<details>
<summary><b>Gigapixel images on a laptop</b> — <code>backend/grading_model.py</code></summary>

<br/>

A whole-slide image cannot be decoded into memory. OpenSlide reads tiles lazily from the
image pyramid; the model samples 32 tissue-bearing tiles at 128 px and only those regions
are ever decoded.

Supporting decisions: Macenko stain normalisation to reduce scanner/protocol variation,
8-way dihedral test-time augmentation, deterministic tile sampling seeded from a hash of
the file path (so the same slide always yields the same result and features can be
cached), a semaphore bounding concurrent analyses, and `torch.set_num_threads` tuned so
two simultaneous analyses don't oversubscribe the CPU and make each other slower.
</details>

<details>
<summary><b>Background workers that own the failures nobody owned</b> — <code>backend/workers.py</code></summary>

<br/>

Several failure modes had no owner: a training run left `running` by a crash blocking all
future runs, `.part` files from interrupted writes, caches growing until the disk filled,
a model that failed to load at boot and stayed broken until restart. Each was handled — if
at all — at the moment a user happened to hit it, meaning the user discovered it.

Five supervised workers now run on a schedule with crash isolation, exponential backoff,
and health reported at `/api/system/workers`. A worker that throws keeps retrying; one
that fails persistently is reported unhealthy with its real error preserved.

The subtle part: recovery of interrupted runs must exclude the run *live in this process*.
At startup that distinction never mattered. On a schedule, without it, a live training run
gets marked "interrupted" two minutes into its first epoch.
</details>

<details>
<summary><b>Tests that fail if the software starts lying</b> — <code>tests/integration_api_test.py</code></summary>

<br/>

132 integration tests that spin up a real server against a throwaway data directory.
Beyond the usual coverage, some exist specifically to catch regressions of *honesty*:

- fail if the training loop contains simulated output (`random.`, `time.sleep`)
- fail if promotion stops being gated on a held-out comparison
- fail if the drug panel ever returns an efficacy verdict the data cannot support
- fail if unassessed clinical fields come back as confident values instead of `null`
- fail if a mistyped patient ID resolves to a real record

An earlier build fabricated loss curves with `rng.uniform()` and reported them as
training. These tests exist so that cannot come back unnoticed.
</details>

<details>
<summary><b>Build and CI failures that reported success</b> — <code>scripts/build-desktop.sh</code></summary>

<br/>

Every build step was piped through `tail`, and a pipeline's exit status is its *last*
command's — so `set -e` only ever saw `tail` succeed. A failed packaging step printed
“✅ Build complete” over an empty output directory.

Fixing it surfaced a subtlety worth knowing: reading `$?` after `if cmd; then … fi` gives
the status of the *if statement*, not of `cmd`. The first version of the fix aborted with
**exit 0**, which would have let CI publish a broken release.

That fix then exposed a shipped bug it had been hiding: `extraResources` pointed at
`dist/omnia-backend` on all platforms, but PyInstaller emits `omnia-backend.exe` on
Windows. electron-builder only *warns* for a missing source — so the Windows installer
built cleanly **containing no backend at all**. CI's check confirmed the file had a PE
header, which that broken installer passed happily.

Windows CI now launches the bundled backend and queries `/api/system/preflight`, failing
the build unless OpenSlide, torch and the model checkpoint all loaded.
</details>

---

## Architecture

```
┌─ Electron shell ─────────────────────────────────────────────┐
│  supervises both servers, reclaims orphaned ports,           │
│  guarantees child cleanup on quit                            │
│                                                              │
│  ┌─ Next.js 15 · React 19 ──┐   ┌─ FastAPI ───────────────┐  │
│  │  App Router, Tailwind    │──▶│  routes/ · deps · audit │  │
│  └──────────────────────────┘   └────────────┬────────────┘  │
│                                              │               │
│         ┌────────────────────────────────────┼────────────┐  │
│         ▼                    ▼               ▼            ▼  │
│  grading_model.py      finetune.py      workers.py    patients│
│  AttentionMIL          head training    ×5 supervised  registry│
│  openslide · torch     promotion gate                        │
│         │                    │                                │
│         ▼                    ▼                                │
│  JSON store + per-patient containers on local disk            │
└──────────────────────────────────────────────────────────────┘
```

**Model.** Gated attention multiple-instance learning ([Ilse et al., 2018](https://arxiv.org/abs/1802.04712))
over EfficientNet-B0. A slide is sampled into 32 tiles; the backbone embeds each; a gated
attention head learns which tiles matter and pools them into one slide-level embedding;
parallel regression and classification heads produce the grade. MIL is the right fit
because labels exist at slide level only — nobody annotates 20,000 tiles per slide.

**Stack.** Python 3.12 · FastAPI · PyTorch · OpenSlide · RDKit · Next.js 15 · React 19 ·
TypeScript · Tailwind · Electron · PyInstaller · GitHub Actions.

---

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="assets/screenshots/01-dashboard.png" alt="Trial dashboard"/><br/>
      <sub><b>Trial dashboard</b> — what's done, what needs a pathologist, portfolio totals</sub></td>
    <td width="50%"><img src="assets/screenshots/05-model-training.png" alt="On-site fine-tuning"/><br/>
      <sub><b>Fine-tuning</b> — real hardware detection, and a promotion gate explained in plain language</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/03-patient-registry.png" alt="Patient registry"/><br/>
      <sub><b>Patient registry</b> — generated IDs, pseudonymised by design</sub></td>
    <td width="50%"><img src="assets/screenshots/04-patient-container.png" alt="Patient record"/><br/>
      <sub><b>Patient record</b> — every trial, visit, slide and report for one person</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/screenshots/06-audit-trail.png" alt="Audit trail"/><br/>
      <sub><b>Audit trail</b> — append-only, 21 CFR Part 11 style, exportable</sub></td>
    <td width="50%"><img src="assets/screenshots/02-trial-detail.png" alt="Trial detail"/><br/>
      <sub><b>Trial detail</b> — RDKit chemistry from structure, and what the data <i>cannot</i> establish</sub></td>
  </tr>
</table>

---

## Run it

### Download

Installers are on the [latest release](https://github.com/mishel-0/Omnia-AI/releases/latest):
macOS (Apple Silicon) `.dmg` and Windows 10/11 `.exe`.

Both are built on their native platform and **verified by actually grading a slide**
before the release publishes — CI opens a slide through OpenSlide, runs the model, and
fails the build unless a valid grade, confidence and attention map come out. A build
whose OpenSlide or model did not load never ships.

| Platform | Backend starts | Slide opened | Model runs | Result |
|---|---|---|---|---|
| macOS 14 (arm64) | ✓ | ✓ | ✓ | grade group returned in 13.0 s |
| Windows Server 2022 (x64) | ✓ | ✓ | ✓ | grade group returned in 2.0 s |

Nothing is downloaded at runtime: the model, OpenSlide and PyTorch are all inside the
installer, so a clinic with no internet access can install and grade.

First launch takes ~45 s while the analysis engine unpacks; subsequent launches are quick.
The app runs on a **60-day evaluation licence**, issued by the setup wizard on first run.

> The licence check is deterrence, not access control — the validator ships with the app,
> so it can be bypassed. Real enforcement needs server-side activation. Documented rather
> than dressed up.

### From source

```bash
git clone https://github.com/mishel-0/Omnia-AI.git && cd Omnia-AI

python3 -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
npm install

npm run dev                 # frontend  → :3000
python3 -m backend.main     # backend   → :8000
```

Python 3.12 and Node 20+. OpenSlide comes from `openslide-bin` via pip — no system package
needed.

```bash
python3 tests/integration_api_test.py     # 132 tests; starts its own server
```

---

## Limitations

Stated plainly, because a medical tool that oversells itself is worse than one that does
less.

- **Research use only.** Not a certified or cleared diagnostic device. Not for clinical
  decision-making.
- **Prostate histology only.** Registering a trial with another indication is allowed and
  warned about — no grade is produced.
- **One fold, one dataset, no external validation.** QWK 0.7996 is measured performance
  on a held-out PANDA split; it does not support a clinical claim.
- **The model reads pixels and nothing else.** It cannot assess whether a drug is working,
  why it isn't, or where in a mechanism a problem lies — those need a control arm, dosing
  and PK/PD, and biomarker data this system does not hold. The interface says so where it
  would otherwise be tempting to infer.
- **Grade change ≠ treatment response.** Serial biopsies are confounded by sampling; the
  longitudinal view reports change and refuses to interpret it.

---

<p align="center">
  <sub>MIT licensed — see <a href="LICENSE.txt">LICENSE.txt</a> ·
  built by <a href="https://github.com/mishel-0">@mishel-0</a></sub>
</p>
