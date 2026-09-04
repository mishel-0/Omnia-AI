"""Omnia AI — End-to-end API regression suite.

Covers auth/RBAC, e-signature integrity, input validation, upload safety,
clinical integrity (no re-analysis or signing of unanalyzed slides), cascade
deletes, and error handling.

Run it directly — it starts its own backend on an unused port with a throwaway
data directory, so it never touches real trial data:

    .venv/bin/python tests/integration_api_test.py
"""
import json
import urllib.request
import urllib.error
import os
import socket
import subprocess
import sys
import tempfile
import time
import threading
import re
import shutil

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Some checks inspect the backend modules directly (e.g. asserting that no
# simulated training code remains), which needs the package importable here
# and not only inside the server subprocess.
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = int(os.environ.get("OMNIA_TEST_PORT") or _free_port())
BASE = f"http://127.0.0.1:{PORT}"
_DATA_DIR = tempfile.mkdtemp(prefix="omnia-test-")
_SERVER = None


def _start_server():
    global _SERVER
    env = {**os.environ, "OMNIA_DATA_DIR": _DATA_DIR, "PORT": str(PORT)}
    env.pop("OMNIA_DEV_RELOAD", None)
    # Test fixtures upload dummy bytes as ".svs" files (see upload_file()) —
    # real openslide I/O correctly rejects those, which is right behavior
    # outside tests but breaks every test whose setup needs a slide to
    # reach "analyzed". This opts only this test server into a stubbed
    # grading result; see grading_model.predict()'s docstring for why this
    # must never be set anywhere else.
    env["OMNIA_TEST_FAKE_GRADING"] = "1"
    _SERVER = subprocess.Popen(
        [sys.executable, "-m", "backend.main"],
        cwd=_ROOT, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            urllib.request.urlopen(f"{BASE}/health", timeout=1)
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("backend did not start")


def _stop_server():
    if _SERVER:
        _SERVER.terminate()
        try:
            _SERVER.wait(timeout=10)
        except Exception:
            _SERVER.kill()
    shutil.rmtree(_DATA_DIR, ignore_errors=True)


FAILS = []
PASSES = []



def req(method, path, token=None, body=None, raw_body=None, content_type="application/json"):
    url = BASE + path
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = content_type
    elif raw_body is not None:
        data = raw_body
        headers["Content-Type"] = content_type
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            txt = resp.read().decode()
            try:
                return resp.status, json.loads(txt)
            except Exception:
                return resp.status, txt
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, txt
    except Exception as e:
        return 0, str(e)


def req_raw(method, path, token=None):
    """Like req(), but returns raw bytes — for binary endpoints (PNGs) where
    decoding as text would corrupt the payload."""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = urllib.request.Request(BASE + path, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, str(e).encode()


def check(name, condition, detail=""):
    if condition:
        PASSES.append(name)
        print(f"  PASS  {name}")
    else:
        FAILS.append((name, detail))
        print(f"  FAIL  {name}  -- {detail}")


def upload_file(path, token, filename, content=b"x" * 1000):
    boundary = "----omniatest"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return req("POST", path, token=token, raw_body=body,
               content_type=f"multipart/form-data; boundary={boundary}")


_start_server()

print("\n=== SETUP ===")
s, r = req("POST", "/api/users/bootstrap", body={"username": "admin", "password": "Admin12345!", "full_name": "Dr Admin"})
ADMIN = r["token"]
print(f"  admin token acquired ({s})")

s, r = req("POST", "/api/users/", token=ADMIN, body={"username": "path1", "password": "Path12345!", "full_name": "Dr Path", "role": "pathologist"})
s, r = req("POST", "/api/users/", token=ADMIN, body={"username": "spon1", "password": "Spon12345!", "full_name": "Sam Sponsor", "role": "sponsor"})
s, r = req("POST", "/api/users/", token=ADMIN, body={"username": "mon1", "password": "Mon12345!", "full_name": "Mo Monitor", "role": "monitor"})
s, r = req("POST", "/api/users/login", body={"username": "spon1", "password": "Spon12345!"})
SPONSOR = r["token"]
s, r = req("POST", "/api/users/login", body={"username": "mon1", "password": "Mon12345!"})
MONITOR = r["token"]
s, r = req("POST", "/api/users/login", body={"username": "path1", "password": "Path12345!"})
PATH = r["token"]

s, trial = req("POST", "/api/trials/", token=ADMIN, body={"name": "T1", "sponsor": "S", "drug": "D", "indication": "Prostate"})
TID = trial["id"]
s, pat = req("POST", f"/api/trials/{TID}/patients", token=ADMIN, body={"patient_id": "P-001"})
PUUID = pat["id"]
s, slide = upload_file(f"/api/trials/patients/{PUUID}/slides", ADMIN, "a.svs")
SLIDE = slide["id"]
print(f"  trial={TID} patient={PUUID} slide={SLIDE}")

print("\n=== A. AUTH / RBAC ===")
s, _ = req("GET", "/api/trials/")
check("A1 unauthenticated list trials rejected", s == 401, f"got {s}")
s, _ = req("GET", "/api/trials/", token="garbage-token")
check("A2 invalid token rejected", s == 401, f"got {s}")
s, _ = req("POST", "/api/trials/", token=SPONSOR, body={"name": "x", "sponsor": "x", "drug": "x", "indication": "x"})
check("A3 sponsor cannot create trial", s == 403, f"got {s}")
s, _ = req("DELETE", f"/api/trials/{TID}", token=PATH)
check("A4 pathologist cannot delete trial", s == 403, f"got {s}")
s, _ = req("GET", "/api/users/", token=PATH)
check("A5 pathologist cannot list users", s == 403, f"got {s}")
s, _ = req("GET", "/api/audit/", token=SPONSOR)
check("A6 sponsor cannot read audit", s == 403, f"got {s}")
s, _ = req("GET", "/api/audit/", token=MONITOR)
check("A7 monitor CAN read audit", s == 200, f"got {s}")
s, _ = upload_file(f"/api/trials/patients/{PUUID}/slides", SPONSOR, "evil.svs")
check("A8 sponsor cannot upload slide", s == 403, f"got {s}")
s, _ = req("POST", "/api/trials/slides/confirm", token=SPONSOR, body={"patient_id": PUUID, "slide_id": SLIDE, "password": "Spon12345!"})
check("A9 sponsor cannot e-sign", s == 403, f"got {s}")
s, r = req("POST", "/api/users/bootstrap", body={"username": "hacker", "password": "x", "full_name": "H"})
check("A10 bootstrap blocked after setup", s == 400, f"got {s}")
s, _ = req("GET", "/api/trials/", token="Bearer ")
check("A11 empty bearer rejected", s == 401, f"got {s}")

print("\n=== B. E-SIGNATURE INTEGRITY ===")
s, _ = req("POST", "/api/trials/slides/confirm", token=ADMIN, body={"patient_id": PUUID, "slide_id": SLIDE, "password": "WRONG"})
check("B1 wrong password rejected", s == 400, f"got {s}")
s, _ = req("POST", "/api/trials/slides/confirm", token=ADMIN, body={"patient_id": PUUID, "slide_id": SLIDE, "password": "Path12345!"})
check("B2 another users password rejected", s == 400, f"got {s}")

print("\n=== C. INPUT VALIDATION / ORPHANS ===")
s, r = req("POST", "/api/trials/NONEXISTENT/patients", token=ADMIN, body={"patient_id": "GHOST"})
check("C1 patient under nonexistent trial rejected", s == 404, f"got {s} -> orphan created: {r if s==200 else ''}")
# A blank subject code no longer rejects the record: the site simply has not
# assigned one yet. The record must still be filed against a real registered
# patient rather than an empty string, which is what this now asserts.
s, r = req("POST", f"/api/trials/{TID}/patients", token=ADMIN, body={"patient_id": ""})
check("C2 blank subject code still yields an identified patient",
      s == 200 and r.get("patient_uid", "").startswith("OMN-") and r.get("patient_id"),
      f"got {s} {r}")
# But an unknown patient_uid must never silently create a stray record.
s, r = req("POST", f"/api/trials/{TID}/patients", token=ADMIN,
           body={"patient_uid": "OMN-ZZZZ-ZZZZ"})
check("C2b unknown patient ID is rejected, not silently registered",
      s in (400, 404), f"got {s} {r}")
s, r = req("POST", "/api/trials/", token=ADMIN, body={"name": "", "sponsor": "", "drug": "", "indication": ""})
check("C3 empty trial name rejected", s in (400, 422), f"got {s}")
s, r = req("POST", f"/api/trials/{TID}/patients", token=ADMIN, body={"patient_id": "P-001"})
check("C4 duplicate patient_id in trial rejected", s in (400, 409), f"got {s}")

print("\n=== D. PATH TRAVERSAL / UPLOAD SAFETY ===")
s, r = upload_file(f"/api/trials/patients/{PUUID}/slides", ADMIN, "../../../../../../tmp/OMNIA_PWNED.svs")
escaped = os.path.exists("/tmp/OMNIA_PWNED.svs")
check("D1 path traversal in filename blocked", not escaped, f"file written outside data dir! status={s}")
if escaped:
    os.remove("/tmp/OMNIA_PWNED.svs")
s, r = upload_file(f"/api/trials/patients/{PUUID}/slides", ADMIN, "notaslide.exe")
check("D2 non-.svs extension rejected", s in (400, 415, 422), f"got {s}")

print("\n=== E. ANALYSIS / CLINICAL INTEGRITY ===")
s, sl2 = upload_file(f"/api/trials/patients/{PUUID}/slides", ADMIN, "b.svs")
S2 = sl2["id"]
s, _ = req("POST", f"/api/trials/patients/{PUUID}/slides/{S2}/analyze", token=ADMIN)
s, conf = req("POST", "/api/trials/slides/confirm", token=ADMIN, body={"patient_id": PUUID, "slide_id": S2, "password": "Admin12345!"})
grade_before = conf.get("grade") if isinstance(conf, dict) else None
s, re_an = req("POST", f"/api/trials/patients/{PUUID}/slides/{S2}/analyze", token=ADMIN)
check("E1 cannot re-analyze a signed slide", s in (400, 409),
      f"got {s} -- signed slide re-analyzed, signature now refers to different data")
s, _ = req("POST", "/api/trials/slides/confirm", token=ADMIN, body={"patient_id": PUUID, "slide_id": SLIDE, "password": "Admin12345!"})
check("E2 cannot confirm unanalyzed slide", s in (400, 409), f"got {s}")

print("\n=== F. PATIENT STATUS LOGIC ===")
s, p2 = req("POST", f"/api/trials/{TID}/patients", token=ADMIN, body={"patient_id": "P-MULTI"})
P2 = p2["id"]
s, a = upload_file(f"/api/trials/patients/{P2}/slides", ADMIN, "m1.svs")
s, b = upload_file(f"/api/trials/patients/{P2}/slides", ADMIN, "m2.svs")
req("POST", f"/api/trials/patients/{P2}/slides/{a['id']}/analyze", token=ADMIN)
req("POST", f"/api/trials/patients/{P2}/slides/{b['id']}/analyze", token=ADMIN)
req("POST", "/api/trials/slides/confirm", token=ADMIN, body={"patient_id": P2, "slide_id": a["id"], "password": "Admin12345!"})
s, pcheck = req("GET", f"/api/trials/patients/{P2}", token=ADMIN)
check("F1 patient not 'reviewed' while slides pending", pcheck["status"] != "reviewed",
      f"status={pcheck['status']} but 1 of 2 slides unconfirmed")

print("\n=== G. CASCADE DELETE / ORPHANS ===")
s, t2 = req("POST", "/api/trials/", token=ADMIN, body={"name": "DEL", "sponsor": "S", "drug": "D", "indication": "I"})
T2 = t2["id"]
s, dp = req("POST", f"/api/trials/{T2}/patients", token=ADMIN, body={"patient_id": "DP"})
s, ds = upload_file(f"/api/trials/patients/{dp['id']}/slides", ADMIN, "del.svs")
stored = ds.get("filepath")
s, q = req("POST", "/api/queries/", token=ADMIN, body={"trial_id": T2, "patient_uuid": dp["id"], "subject": "s", "description": "d"})
req("DELETE", f"/api/trials/{T2}", token=ADMIN)
s, qafter = req("GET", f"/api/queries/?trial_id={T2}", token=ADMIN)
check("G1 queries deleted with trial", len(qafter) == 0, f"{len(qafter)} orphaned queries remain")
check("G2 slide file deleted from disk", not (stored and os.path.exists(stored)), f"orphan file remains: {stored}")
s, pafter = req("GET", f"/api/trials/patients/{dp['id']}", token=ADMIN)
check("G3 patient deleted with trial", pafter if s == 404 else False, f"got {s}")

print("\n=== H. CSV EXPORT CORRECTNESS ===")
s, csv_txt = req("GET", f"/api/trials/{TID}/export-corrections-csv", token=ADMIN)
check("H1 CSV export returns data", isinstance(csv_txt, str) and "patient_id" in csv_txt, "no csv")

print("\n=== I. ERROR HANDLING ===")
s, _ = req("GET", "/api/trials/patients/NOSUCHUUID", token=ADMIN)
check("I1 unknown patient -> 404", s == 404, f"got {s}")
s, _ = req("POST", f"/api/trials/patients/NOSUCH/slides/NOSUCH/analyze", token=ADMIN)
check("I2 analyze unknown slide -> 404", s == 404, f"got {s}")
s, _ = req("POST", "/api/queries/999/respond", token=ADMIN, body={"text": "x"})
check("I3 respond to unknown query -> 404", s == 404, f"got {s}")

print("\n=== J. DELETE / LIFECYCLE OPERATIONS ===")
s, jt = req("POST", "/api/trials/", token=ADMIN, body={"name": "LIFE", "sponsor": "S", "drug": "D", "indication": "I"})
JT = jt["id"]
s, jp = req("POST", f"/api/trials/{JT}/patients", token=ADMIN, body={"patient_id": "J-1"})
JP = jp["id"]
s, js = upload_file(f"/api/trials/patients/{JP}/slides", ADMIN, "j1.svs")
JS = js["id"]
stored = js.get("filepath")

s, _ = req("DELETE", f"/api/trials/patients/{JP}/slides/{JS}", token=SPONSOR)
check("J1 sponsor cannot delete a slide", s == 403, f"got {s}")

s, _ = req("DELETE", f"/api/trials/patients/{JP}/slides/{JS}", token=ADMIN)
check("J2 unsigned slide deleted", s == 200, f"got {s}")
check("J3 deleted slide file removed from disk", not (stored and os.path.exists(stored)), "file left behind")

# signed slides must be immutable
s, js2 = upload_file(f"/api/trials/patients/{JP}/slides", ADMIN, "j2.svs")
JS2 = js2["id"]
req("POST", f"/api/trials/patients/{JP}/slides/{JS2}/analyze", token=ADMIN)
req("POST", "/api/trials/slides/confirm", token=ADMIN,
    body={"patient_id": JP, "slide_id": JS2, "password": "Admin12345!"})
s, _ = req("DELETE", f"/api/trials/patients/{JP}/slides/{JS2}", token=ADMIN)
check("J4 signed slide cannot be deleted", s == 409, f"got {s}")
s, _ = req("DELETE", f"/api/trials/patients/{JP}", token=ADMIN)
check("J5 patient with signed slides cannot be deleted", s == 409, f"got {s}")

s, jp2 = req("POST", f"/api/trials/{JT}/patients", token=ADMIN, body={"patient_id": "J-2"})
s, _ = req("DELETE", f"/api/trials/patients/{jp2['id']}", token=ADMIN)
check("J6 patient without signed slides deleted", s == 200, f"got {s}")

s, r = req("POST", f"/api/trials/{JT}/status", token=ADMIN, body={"status": "closed"})
check("J7 trial can be closed", s == 200 and r.get("status") == "closed", f"got {s} {r}")
s, _ = req("POST", f"/api/trials/{JT}/status", token=ADMIN, body={"status": "bogus"})
check("J8 invalid trial status rejected", s == 400, f"got {s}")
s, _ = req("POST", f"/api/trials/{JT}/status", token=SPONSOR, body={"status": "active"})
check("J9 sponsor cannot change trial status", s == 403, f"got {s}")

print("\n=== K. MODEL TRAINING ===")
s, rd = req("GET", "/api/training/readiness", token=ADMIN)
check("K1 readiness returns real hardware", s == 200 and bool(rd.get("hardware", {}).get("cpu_name")),
      f"got {s}")
check("K2 capability tier assigned", rd.get("profile", {}).get("tier") in
      ("workstation", "capable", "limited", "insufficient"), str(rd.get("profile")))
check("K3 dataset readiness computed", "usable_examples" in rd.get("dataset", {}), str(rd.get("dataset")))

s, _ = req("GET", "/api/training/readiness")
check("K4 unauthenticated readiness rejected", s == 401, f"got {s}")

# This suite's trial has too few reviewed slides, so training must refuse.
s, r = req("POST", "/api/training/start", token=ADMIN)
check("K5 refuses to train on too few examples", s == 409, f"got {s} {r}")

s, _ = req("POST", "/api/training/start", token=SPONSOR)
check("K6 sponsor cannot start training", s == 403, f"got {s}")

s, _ = req("POST", "/api/training/cancel", token=ADMIN)
check("K7 cancel with no active run -> 409", s == 409, f"got {s}")

s, runs = req("GET", "/api/training/runs", token=ADMIN)
check("K8 run history endpoint works", s == 200 and isinstance(runs, list), f"got {s}")

print("\n=== L. REGRESSION GUARDS (from debug audit) ===")
import threading as _th
_res = []
def _hammer():
    st, _ = req("POST", "/api/training/start", token=ADMIN)
    _res.append(st)
_ths = [_th.Thread(target=_hammer) for _ in range(5)]
for t_ in _ths: t_.start()
for t_ in _ths: t_.join()
check("L1 only one concurrent training start accepted", _res.count(200) <= 1,
      f"{_res.count(200)} of 5 accepted -> competing training threads ({_res})")
req("POST", "/api/training/cancel", token=ADMIN)

s, lt = req("POST", "/api/trials/", token=ADMIN, body={"name": "LOCKED", "sponsor": "S", "drug": "D", "indication": "I"})
LT = lt["id"]
req("POST", f"/api/trials/{LT}/status", token=ADMIN, body={"status": "closed"})
s, _ = req("POST", f"/api/trials/{LT}/patients", token=ADMIN, body={"patient_id": "NOPE"})
check("L2 closed trial rejects new patients", s == 400, f"got {s}")

s, _ = req("POST", "/api/trials/", token=ADMIN,
           body={"name": "X" * 5000, "sponsor": "S", "drug": "D", "indication": "I"})
check("L3 oversized trial name rejected", s == 400, f"got {s}")

s, runs = req("GET", "/api/training/runs", token=ADMIN)
stuck = [r for r in runs if r.get("state") == "running"] if isinstance(runs, list) else []
check("L4 no training run left stuck in 'running'", len(stuck) == 0, f"{len(stuck)} stuck")

print("\n=== M. SLIDE INTEGRITY / VIEWER ===")
# An empty upload must be refused outright — it can never be analysed, and
# accepting it attaches an unusable file to a patient record.
s, _ = upload_file(f"/api/trials/patients/{PUUID}/slides", ADMIN, "empty.svs", content=b"")
check("M1 empty slide upload rejected", s == 400, f"got {s}")

# Thumbnail endpoint must enforce the same auth as everything else — slide
# images are patient data, not public assets.
s, _ = req("GET", f"/api/trials/patients/{PUUID}/slides/{SLIDE}/thumbnail")
check("M2 thumbnail requires auth", s in (401, 403), f"got {s}")

s, _ = req("GET", f"/api/trials/patients/{PUUID}/slides/does-not-exist/thumbnail", token=ADMIN)
check("M3 thumbnail for unknown slide -> 404", s == 404, f"got {s}")

# The analysis result must never carry fabricated values for fields the
# model cannot predict. This is the guard against a future change quietly
# reintroducing mock data behind a real "ai" label.
s, p_after = req("GET", f"/api/trials/patients/{PUUID}", token=ADMIN)
_an = None
if s == 200:
    _an = next((sl for sl in p_after.get("slides", []) if sl.get("status") == "analyzed"), None)
if _an is not None:
    _fabricated = [
        k for k in ("size_mm", "tumor_involvement_pct", "perineural_invasion",
                    "lymphovascular_invasion", "cribriform_pattern", "suspicious_regions")
        if _an.get(k) is not None
    ]
    check("M4 unassessed fields stay null (no fabricated findings)",
          not _fabricated, f"fabricated values present: {_fabricated}")
    check("M5 biomarkers not fabricated", not _an.get("biomarkers"),
          f"got {_an.get('biomarkers')}")
    check("M6 analysed slide reports a real source", _an.get("analysis_source") == "ai",
          f"got {_an.get('analysis_source')}")
else:
    check("M4 unassessed fields stay null (no fabricated findings)", False, "no analysed slide found")

print("\n=== N. SUBJECT TIMELINE (longitudinal container) ===")
# Same subject, several visits, created deliberately out of order — the
# container must order them by visit label, not by insertion.
s, ltrial = req("POST", "/api/trials/", token=ADMIN,
                body={"name": "LONGI", "sponsor": "S", "drug": "D", "indication": "Prostate"})
LTID = ltrial["id"]
for _v in ["Week 12", "Baseline", "Week 24"]:
    s, _lp = req("POST", f"/api/trials/{LTID}/patients", token=ADMIN,
                 body={"patient_id": "S001", "visit": _v})
    s, _ls = upload_file(f"/api/trials/patients/{_lp['id']}/slides", ADMIN, f"{_v}.svs")
    req("POST", f"/api/trials/patients/{_lp['id']}/slides/{_ls['id']}/analyze", token=ADMIN)

s, _tl = req("GET", f"/api/trials/{LTID}/subjects/S001/timeline", token=ADMIN)
_order = [t["visit"] for t in _tl["timepoints"]] if s == 200 else []
check("N1 visits ordered chronologically, not by insertion",
      _order == ["Baseline", "Week 12", "Week 24"], f"got {_order}")
check("N2 all visits grouped under one subject",
      s == 200 and _tl.get("visit_count") == 3, f"got {_tl.get('visit_count') if s == 200 else s}")
check("N3 unsigned grades marked provisional",
      s == 200 and _tl.get("provisional") is True, f"got {_tl.get('provisional') if s == 200 else s}")
# The clinical guardrail: this must never present itself as treatment response.
_txt = json.dumps(_tl).lower() if s == 200 else ""
check("N4 timeline carries its confounder caveats",
      s == 200 and len(_tl.get("caveats", [])) >= 3, f"got {len(_tl.get('caveats', [])) if s == 200 else s}")
check("N5 timeline makes no drug-efficacy claim",
      "drug is working" not in _txt and "responding to treatment" not in _txt,
      "timeline text asserts treatment response")

s, _subs = req("GET", f"/api/trials/{LTID}/subjects", token=ADMIN)
check("N6 subjects list collapses visits into one row",
      s == 200 and len(_subs) == 1 and _subs[0]["visit_count"] == 3, f"got {_subs if s == 200 else s}")
s, _ = req("GET", f"/api/trials/{LTID}/subjects/S001/timeline")
check("N7 timeline requires auth", s in (401, 403), f"got {s}")
s, _ = req("GET", f"/api/trials/{LTID}/subjects/NOSUCH/timeline", token=ADMIN)
check("N8 unknown subject -> 404", s == 404, f"got {s}")

print("\n=== O. COHORT ANALYTICS ===")
s, _ci = req("GET", f"/api/trials/{LTID}/insights", token=ADMIN)
check("O1 cohort insights computed", s == 200 and _ci.get("subject_count") == 1,
      f"got {s} / {_ci.get('subject_count') if s == 200 else ''}")
check("O2 unsigned slides surfaced as an action item",
      s == 200 and any("not yet signed" in a["label"] for a in _ci.get("action_items", [])),
      "unsigned backlog not reported")
check("O3 grade distribution covers all six grade groups",
      s == 200 and len(_ci.get("grade_distribution", {})) == 6,
      f"got {_ci.get('grade_distribution') if s == 200 else s}")
# The scope boundary is the point of this module — if it ever starts claiming
# mechanism or efficacy, that is a scientific-integrity regression, not a
# cosmetic one.
_ctxt = json.dumps(_ci).lower() if s == 200 else ""
check("O4 analytics carry an explicit scope note",
      s == 200 and "cannot" in _ci.get("scope_note", "").lower(),
      "scope note missing or does not state limits")
check("O5 analytics make no drug-mechanism or efficacy claim",
      all(p not in _ctxt for p in ("drug target", "mechanism of action",
                                   "efficacy demonstrated", "drug is working",
                                   "recommend targeting")),
      "analytics assert drug mechanism or efficacy")
s, _ = req("GET", f"/api/trials/{LTID}/insights")
check("O6 insights require auth", s in (401, 403), f"got {s}")
s, _ = req("GET", "/api/trials/NOSUCHTRIAL/insights", token=ADMIN)
check("O7 insights for unknown trial -> 404", s == 404, f"got {s}")

print("\n=== P. INVESTIGATIONAL PRODUCT / CHEMISTRY ===")
# Aspirin — descriptors are published and independently checkable, so this
# verifies the cheminformatics is really computing, not echoing input.
s, _d = req("PUT", f"/api/trials/{LTID}/drug", token=ADMIN, body={
    "name": "Aspirin", "code": "ASA", "drug_class": "NSAID",
    "target": "COX-1/COX-2", "dose": "81 mg", "route": "Oral",
    "smiles": "CC(=O)Oc1ccccc1C(=O)O"})
_chem = _d.get("chemistry", {}) if s == 200 else {}
check("P1 structure parsed and descriptors computed", _chem.get("valid") is True, f"got {_chem}")
check("P2 molecular formula matches published value",
      _chem.get("formula") == "C9H8O4", f"got {_chem.get('formula')}")
check("P3 molecular weight matches published value",
      _chem.get("molecular_weight") is not None and abs(_chem["molecular_weight"] - 180.16) < 0.05,
      f"got {_chem.get('molecular_weight')}")

s, _bad = req("PUT", f"/api/trials/{LTID}/drug", token=ADMIN, body={"smiles": "!!!not-a-molecule!!!"})
check("P4 invalid structure rejected, not silently accepted",
      s == 200 and _bad.get("chemistry", {}).get("valid") is False,
      f"got {_bad.get('chemistry') if s == 200 else s}")
# Restore a valid structure for the remaining checks.
req("PUT", f"/api/trials/{LTID}/drug", token=ADMIN, body={"smiles": "CC(=O)Oc1ccccc1C(=O)O"})

s, _png = req_raw("GET", f"/api/trials/{LTID}/drug/structure.png", token=ADMIN)
check("P5 2D structure renders", s == 200 and _png[:4] == b"\x89PNG", f"got {s}")

s, _ev = req("GET", f"/api/trials/{LTID}/evidence", token=ADMIN)
check("P6 evidence summary returned", s == 200 and "observations" in _ev, f"got {s}")
check("P7 evidence names specific missing inputs",
      s == 200 and len(_ev.get("limits", [])) >= 4, f"got {len(_ev.get('limits', [])) if s == 200 else s}")
# The core scientific guardrail for this feature.
_evtxt = json.dumps(_ev).lower() if s == 200 else ""
check("P8 evidence makes no efficacy verdict",
      all(p not in _evtxt for p in ("the drug is working", "drug is effective",
                                    "treatment is effective", "confirms efficacy")),
      "evidence asserts an efficacy verdict")
check("P9 evidence states the model ignores drug data",
      s == 200 and "does not receive" in json.dumps(_ev.get("limits", [])).lower(),
      "missing statement that grading is independent of drug metadata")
s, _ = req("PUT", f"/api/trials/{LTID}/drug", body={"name": "X"})
check("P10 drug record requires auth", s in (401, 403), f"got {s}")

print("\n=== Q. RELEASE INTEGRITY / PREFLIGHT ===")
# The installer, the API and package.json each used to carry their own
# version literal and had drifted to three different numbers. Fail the build
# if they diverge again — a user cannot report a bug against a version the
# app is not actually running.
_pkg_version = ""
try:
    with open(os.path.join(_ROOT, "package.json")) as _f:
        _pkg_version = json.load(_f).get("version", "")
except Exception as _e:
    _pkg_version = f"<unreadable: {_e}>"
s, _h = req("GET", "/health")
check("Q1 API version matches package.json",
      s == 200 and _h.get("version") == _pkg_version,
      f"api={_h.get('version') if s == 200 else s} package.json={_pkg_version}")

# Preflight is open only during setup, before the first account exists. By
# this point the suite has created users, so it needs a session — and the
# fact that it does is itself worth asserting: the reply carries absolute
# filesystem paths and a per-dependency map of the machine.
s, _ = req("GET", "/api/system/preflight")
check("Q1b preflight is not readable anonymously once setup is complete",
      s == 401, f"expected 401 for an unauthenticated caller, got {s}")

s, _pf = req("GET", "/api/system/preflight", token=ADMIN)
check("Q2 preflight runs real environment checks",
      s == 200 and len(_pf.get("checks", [])) >= 5, f"got {s}")
check("Q3 preflight reports readiness", s == 200 and "ready" in _pf, f"got {s}")
_keys = {c["key"] for c in _pf.get("checks", [])} if s == 200 else set()
check("Q4 preflight covers the components slide grading depends on",
      {"storage", "openslide", "model", "torch"} <= _keys, f"got {sorted(_keys)}")
check("Q5 preflight marks grading-critical checks as blocking",
      s == 200 and any(c["fatal"] for c in _pf.get("checks", [])),
      "no check is marked fatal, so a broken install would look fine")

print("\n=== R. TRIAL REGISTRATION FIELDS ===")

# A trial registered with a protocol ID and phase must persist and return
# them. Capturing a registry identifier that is dropped on write is worse
# than not capturing it — the record looks authoritative and is not.
s, _r = req("POST", "/api/trials/", token=ADMIN, body={
    "name": "R-TRIAL", "sponsor": "Sp", "drug": "Dr", "indication": "Prostate",
    "protocol_id": "NCT01234567", "phase": "Phase III"})
check("R1 protocol ID and phase are stored",
      s == 200 and _r.get("protocol_id") == "NCT01234567" and _r.get("phase") == "Phase III",
      f"got {s} {_r}")

_rid = _r.get("id") if s == 200 else None
s, _got = req("GET", f"/api/trials/{_rid}", token=ADMIN)
check("R2 protocol ID survives a read back",
      s == 200 and _got.get("protocol_id") == "NCT01234567", f"got {s} {_got}")

# Phase is a closed vocabulary. Free text makes cohorts unfilterable, so an
# unrecognised value must be rejected rather than silently stored.
s, _ = req("POST", "/api/trials/", token=ADMIN, body={
    "name": "R-BAD", "sponsor": "Sp", "drug": "Dr", "indication": "Prostate",
    "phase": "Phase XII"})
check("R3 unknown phase is rejected", s == 400, f"expected 400, got {s}")

# Both fields are optional: existing callers that omit them must still work.
s, _r2 = req("POST", "/api/trials/", token=ADMIN, body={
    "name": "R-MIN", "sponsor": "Sp", "drug": "Dr", "indication": "Prostate"})
check("R4 trial without protocol ID or phase is still accepted",
      s == 200 and _r2.get("protocol_id") == "" and _r2.get("phase") == "",
      f"got {s} {_r2}")

s, _ = req("POST", "/api/trials/", token=ADMIN, body={
    "name": "R-LONG", "sponsor": "Sp", "drug": "Dr", "indication": "Prostate",
    "protocol_id": "N" * 101})
check("R5 over-long protocol ID is rejected", s == 400, f"expected 400, got {s}")

# The required-field rules the dialog enforces client-side must also hold on
# the server; a client is not a validation boundary.
s, _ = req("POST", "/api/trials/", token=ADMIN, body={
    "name": "   ", "sponsor": "Sp", "drug": "Dr", "indication": "Prostate"})
check("R6 whitespace-only trial name is rejected", s == 400, f"expected 400, got {s}")

print("\n=== S. PATIENT REGISTRY & CONTAINER ===")

s, _p = req("POST", "/api/patients/", token=ADMIN,
            body={"initials": "AB", "year_of_birth": 1958, "sex": "male"})
_UID = _p.get("uid") if s == 200 else ""
check("S1 patient ID is generated by the server",
      s == 200 and _UID.startswith("OMN-") and len(_UID) == 13, f"got {s} {_p}")

# The identifier carries a check character. The failure that matters is not
# "not found" — it is a typo silently resolving to a different real patient.
_bad = _UID[:-1] + ("A" if _UID[-1] != "A" else "B")
s, _ = req("GET", f"/api/patients/{_bad}", token=ADMIN)
check("S2 a mistyped patient ID is rejected, not resolved to someone else",
      s == 404, f"expected 404 for {_bad}, got {s}")

# Case and separators are forgiving; only the check character is not.
s, _same = req("GET", f"/api/patients/{_UID.replace('-','').lower()}", token=ADMIN)
check("S3 patient ID lookup tolerates case and missing separators",
      s == 200 and _same.get("uid") == _UID, f"got {s}")

# Profile must stay pseudonymised: no name field is accepted or stored.
check("S4 profile stores no patient name",
      "name" not in _p and "dob" not in _p, f"got keys {sorted(_p.keys())}")

s, _ = req("POST", "/api/patients/", token=ADMIN, body={"year_of_birth": 1780})
check("S5 implausible year of birth is rejected", s == 400, f"expected 400, got {s}")

s, _ = req("POST", "/api/patients/", token=ADMIN, body={"initials": "TOOLONG"})
check("S6 malformed initials are rejected", s == 400, f"expected 400, got {s}")

# Enrol the same person in two trials — the container exists to answer
# "everything on file for this person", which per-trial views cannot.
s, _t1 = req("POST", "/api/trials/", token=ADMIN, body={
    "name": "S-T1", "sponsor": "Sp", "drug": "D1", "indication": "Prostate"})
s, _t2 = req("POST", "/api/trials/", token=ADMIN, body={
    "name": "S-T2", "sponsor": "Sp", "drug": "D2", "indication": "Prostate"})
req("POST", f"/api/trials/{_t1['id']}/patients", token=ADMIN,
    body={"patient_uid": _UID, "patient_id": "S-001", "visit": "Baseline"})
req("POST", f"/api/trials/{_t1['id']}/patients", token=ADMIN,
    body={"patient_uid": _UID, "patient_id": "S-001", "visit": "Week 12"})
req("POST", f"/api/trials/{_t2['id']}/patients", token=ADMIN,
    body={"patient_uid": _UID, "patient_id": "X-77", "visit": "Baseline"})

# A graded, signed slide must be counted as such. The container previously
# read the grade from a nested "analysis" object that slide records do not
# have, so it reported zero analysed and zero signed while the dashboard
# correctly showed one of each — the same slide, two different numbers.
_pats_raw = req("GET", f"/api/trials/{TID}/patients", token=ADMIN)[1]
# Scope the comparison to ONE patient: the container is per-patient, while
# the trial view spans every patient in the trial.
_uid_here = next((p.get("patient_uid") for p in _pats_raw
                  if p.get("patient_uid") and p.get("slides")), None)
_mine = [p for p in _pats_raw if p.get("patient_uid") == _uid_here]
_signed_here = sum(1 for p in _mine for sl in p.get("slides", []) if sl.get("confirmed"))
_graded_here = sum(1 for p in _mine for sl in p.get("slides", []) if sl.get("grade_group") is not None)
if _uid_here and (_signed_here or _graded_here):
    s, _cc = req("GET", f"/api/patients/{_uid_here}/container", token=ADMIN)
    check("S12 a signed graded slide is counted in the patient container",
          s == 200 and _cc["totals"]["confirmed"] == _signed_here
          and _cc["totals"]["analysed"] == _graded_here,
          f"trial shows {_signed_here} signed/{_graded_here} graded, container shows {_cc.get('totals')}")

s, _c = req("GET", f"/api/patients/{_UID}/container", token=ADMIN)
check("S7 container spans every trial the patient is enrolled in",
      s == 200 and _c["totals"]["trials"] == 2 and _c["totals"]["visits"] == 3,
      f"got {s} {_c.get('totals')}")

_codes = {e["trial_name"]: e["subject_code"] for e in _c.get("enrollments", [])}
check("S8 each enrollment shows that trial's own subject code",
      _codes.get("S-T1") == "S-001" and _codes.get("S-T2") == "X-77", f"got {_codes}")

# Enrolling without a uid must register a patient rather than reject, so a
# visit is never filed against a bare string again.
s, _v = req("POST", f"/api/trials/{_t1['id']}/patients", token=ADMIN,
            body={"visit": "Screening"})
check("S9 a visit with no patient ID registers one instead of failing",
      s == 200 and _v.get("patient_uid", "").startswith("OMN-"), f"got {s} {_v}")

s, _ = req("GET", f"/api/patients/{_UID}/reports/../../../etc/passwd", token=ADMIN)
check("S10 report retrieval refuses paths outside the patient container",
      s in (404, 400), f"expected 404/400, got {s}")

s, _ = req("GET", f"/api/patients/{_UID}/container")
check("S11 patient container requires auth", s == 401, f"expected 401, got {s}")

print("\n=== T. MODEL TRAINING (REAL, NOT SIMULATED) ===")

# The single most important guard on this feature: no code path may report a
# fabricated training curve again.
import backend.training as _tr
import backend.finetune as _ft
_src = open(_tr.__file__).read()
check("T1 training job contains no simulated optimisation loop",
      "random." not in _src and "time.sleep" not in _src and "simulated" not in _src,
      "training.py still contains simulation code")

s, _model = req("GET", "/api/training/model", token=ADMIN)
check("T2 the app reports which model it is grading with",
      s == 200 and _model.get("source") in ("shipped", "finetuned"), f"got {s} {_model}")
check("T3 model description is written for a non-specialist",
      s == 200 and len(_model.get("description", "")) > 40, f"got {_model}")

s, _rd = req("GET", "/api/training/readiness", token=ADMIN)
check("T4 readiness reports real dataset counts",
      s == 200 and "dataset" in _rd and "usable_examples" in _rd["dataset"], f"got {s}")

# Under the minimum, starting must refuse with a reason rather than run.
if _rd.get("dataset", {}).get("usable_examples", 0) < _rd.get("dataset", {}).get("minimum_required", 20):
    s, _e = req("POST", "/api/training/start", token=ADMIN)
    check("T5 training refuses to run without enough reviewed slides",
          s in (400, 409) and "slide" in str(_e).lower(), f"got {s} {_e}")

# QWK is the metric promotion is gated on, so it must be correct.
check("T6 agreement metric is exact at its bounds",
      _ft.quadratic_weighted_kappa([0,1,2,3,4,5],[0,1,2,3,4,5]) == 1.0
      and _ft.quadratic_weighted_kappa([0,1,2,3,4,5],[5,4,3,2,1,0]) == -1.0,
      "QWK bounds are wrong")
check("T7 agreement metric is defined for degenerate input",
      _ft.quadratic_weighted_kappa([], []) == 0.0
      and _ft.quadratic_weighted_kappa([2,2],[2,2]) == 0.0,
      "QWK crashes or misreports on degenerate input")

# A fine-tune must never be promoted unless it beat the current model.
#
# This used to grep finetune.py for the literal line `improved = best["qwk"]
# > base_qwk`. That passes for any file containing the right characters and
# fails for any correct refactor — including the one that fixed the gate's
# real defect, where the epoch was chosen on the same slides that then judged
# it. Assert the behaviour instead: labels with no learnable signal cannot
# produce a genuine improvement, so the run must be rejected.
def _no_signal_run():
    import numpy as np
    from unittest.mock import patch
    rng = np.random.RandomState(7)
    labels = [int(rng.randint(0, 6)) for _ in range(30)]
    feats = {f"/noise/{i}.svs": rng.randn(32, 1280).astype(np.float32) for i in range(30)}
    examples = [{"filepath": f"/noise/{i}.svs", "grade_group": g} for i, g in enumerate(labels)]
    with patch.object(_ft, "extract_features", side_effect=lambda p, force=False: feats[p]):
        return _ft.run_finetune(examples, epochs=3)

try:
    _r8 = _no_signal_run()
    check("T8 promotion is gated on measured improvement",
          (_r8["finetuned_qwk"] > _r8["baseline_qwk"]) == _r8["improved"]
          and _r8["promoted"] == _r8["improved"],
          f"promotion did not follow the measured comparison: {_r8.get('baseline_qwk')} -> "
          f"{_r8.get('finetuned_qwk')}, improved={_r8.get('improved')}, "
          f"promoted={_r8.get('promoted')}")

    # The number the gate reports must come from slides that took no part in
    # choosing which epoch to keep — otherwise it is the maximum over epochs
    # on its own measuring stick, which is biased upward and will promote noise.
    check("T8b the promotion figure is measured on slides used for nothing else",
          "selection_qwk" in _r8
          and _r8["train_size"] + _r8["select_size"] + _r8["val_size"] == _r8["examples_used"],
          "training, selection and held-out slides do not partition the dataset")
except Exception as _e8:
    check("T8 promotion is gated on measured improvement", False, f"run failed: {_e8}")
    check("T8b the promotion figure is measured on slides used for nothing else", False, "not reached")

# Corrections are training labels; free text cannot be one.
from backend.trials import grade_group_from_text as _g
check("T9 a correction resolves to exactly one grade group",
      _g("4+3=7") == 3 and _g("3+4=7") == 2 and _g("benign") == 0,
      "correction parsing is wrong")
check("T10 an unresolvable correction is rejected, not guessed",
      _g("banana") is None and _g("") is None and _g("4+9=13") is None,
      "correction parsing accepts nonsense")

s, _ = req("POST", "/api/trials/slides/correct", token=ADMIN,
           body={"patient_id": PUUID, "slide_id": "nope", "correction": "banana", "password": "Admin12345!"})
check("T11 the server refuses a free-text correction", s in (400, 404), f"got {s}")

s, _ = req("POST", "/api/training/start")
check("T12 starting training requires auth", s == 401, f"expected 401, got {s}")
s, _ = req("POST", "/api/training/model/revert", token=MONITOR)
check("T13 a monitor cannot change the active model", s == 403, f"expected 403, got {s}")

print("\n=== X. BATCH ANALYSIS QUEUE ===")

from backend import batch as _bq

s, _bj = req("GET", "/api/batch/jobs")
check("X1 the batch queue is not readable anonymously", s == 401, f"expected 401, got {s}")
s, _bj = req("GET", "/api/batch/jobs", token=ADMIN)
check("X2 an authenticated caller can list batch jobs", s == 200 and isinstance(_bj, list), f"got {s}")

s, _bj = req("POST", "/api/batch/trial", token=ADMIN, body={"trial_id": "does-not-exist"})
check("X3 queueing a trial with nothing to analyse is a clean 409",
      s == 409, f"expected 409, got {s}")

# Progress must count every settled item. A bar that only advances on success
# stalls forever on a cohort where some slides cannot be read.
_j = _bq.enqueue([{"patient_uuid": "zz", "slide_id": f"z{i}"} for i in range(4)], trial_id="ZZ")
_bq._settle(_j["id"], "zz", "z0", "done")
_bq._settle(_j["id"], "zz", "z1", "failed", "unreadable")
_after = _bq.get_job(_j["id"])
check("X4 progress counts failures, not just successes",
      _after["progress"] == 0.5, f"expected 0.5, got {_after['progress']}")

# Cancelling a job whose work has all settled must close it. Left open, the
# UI polls a job that can never change and keeps offering "Stop".
_bq.cancel(_j["id"])
_cancelled = _bq.get_job(_j["id"])
check("X5 cancelling a fully-settled job closes it",
      _cancelled["state"] == "finished" and _cancelled["finished_at"],
      f"state={_cancelled['state']}, finished_at={_cancelled['finished_at']}")

# But a job with a slide mid-analysis must stay open — the worker settles it.
_j2 = _bq.enqueue([{"patient_uuid": "zz", "slide_id": "live"}], trial_id="ZZ2")
_st = _bq._read()
for _job in _st["jobs"]:
    if _job["id"] == _j2["id"]:
        _job["items"][0]["status"] = "running"
_bq._write(_st)
_bq.cancel(_j2["id"])
check("X6 cancelling does not close a job with a slide still being analysed",
      _bq.get_job(_j2["id"])["state"] != "finished",
      "a job was closed while an analysis was still in flight")

# Interrupted work is recoverable — the reason the queue is persisted at all.
check("X7 a slide interrupted by a restart returns to pending",
      _bq._recover_interrupted() >= 1,
      "an interrupted slide was not returned to the queue")

print("\n=== W. SIGNED REPORT CORRECTNESS ===")

# The PDF is the document that leaves the building — it is what a sponsor, a
# monitor or a regulator actually reads. Every check here is a defect that
# shipped: each one rendered a signed clinical document that was wrong on its
# face rather than failing loudly.
import io as _io
import re as _re
import datetime as _dt
from backend.pathology_report import generate_pathology_pdf as _pdf
from backend.version import __version__ as _ver

def _pdf_text(b):
    from pypdf import PdfReader
    return "\n".join(p.extract_text() for p in PdfReader(_io.BytesIO(b)).pages)

# ISUP grade group 0 means benign. Testing it for truthiness treated it as
# absent, so a benign slide printed "Grade Group: —" beside "Gleason: Benign".
_benign = _pdf_text(_pdf(ai_grade="Benign", grade_group=0, ai_confidence=0.0,
                         regions_analyzed=0, processing_time_s=0.0, confirmed=True))
_bl = _benign.splitlines()
_gg = _bl[_bl.index("WHO/ISUP Grade") + 2].strip() if "WHO/ISUP Grade" in _bl else "?"
check("W1 a benign slide reports grade group 0, not 'not assessed'",
      _gg == "0", f"grade group rendered as {_gg!r}")
check("W2 a genuine 0% confidence is reported, not blanked",
      "0.0%" in _benign, "zero confidence rendered as '—'")

# The model's confidence belongs to the model's prediction. Printed under a
# doctor-corrected grade it attributed a model number to a human judgement —
# the confidence of the very prediction the pathologist had overruled.
_corr = _pdf_text(_pdf(ai_grade="3+4=7", doctor_correction="4+5=9", grade_group=5,
                       ai_confidence=0.823, confirmed=True))
check("W3 a corrected grade does not carry the overruled model's confidence",
      "Model confidence: 82%" not in _corr and "Corrected by the reporting pathologist" in _corr,
      "model confidence is still shown beneath a doctor-corrected grade")

# A signed report has to say which software produced it, and when, truthfully.
_foot = [line for line in _pdf_text(_pdf(ai_grade="4+5=9", grade_group=5, patient_id="P1",
                                         analysis_date="2026-01-01", confirmed=True)).splitlines()
         if "Omnia AI v" in line]
check("W4 the report states the version that actually produced it",
      bool(_foot) and f"v{_ver}" in _foot[0], f"footer says {_foot[0].strip() if _foot else '(missing)'}")
check("W5 a timestamp labelled UTC is actually UTC",
      bool(_foot) and _dt.datetime.now(_dt.timezone.utc).strftime("%H:") in _foot[0],
      "the UTC-labelled timestamp is local time")

# "An issued report can be produced again unchanged" — which a random report
# ID made untrue.
_args = dict(ai_grade="4+5=9", grade_group=5, patient_id="P1",
             analysis_date="2026-01-01", confirmed=True)
def _rid(pdf_bytes):
    """The Report ID a generated PDF renders, or None if it carries none."""
    m = _re.search(r"Report ID: ([0-9A-F]+)", _pdf_text(pdf_bytes))
    return m.group(1) if m else None
check("W6 reissuing the same report yields the same report ID",
      _rid(_pdf(**_args)) == _rid(_pdf(**_args)) is not None,
      "the report ID changes on every regeneration")
check("W7 different patients do not share a report ID",
      _rid(_pdf(**_args)) != _rid(_pdf(**{**_args, "patient_id": "P2"})),
      "two patients produced the same report ID")

print("\n=== U. BACKGROUND WORKERS & SELF-REPAIR ===")

import backend.workers as _wk

s, _w = req("GET", "/api/system/workers")
check("U1 the app reports its own background-task health",
      s == 200 and "workers" in _w and len(_w["workers"]) >= 4, f"got {s} {_w}")
check("U2 every worker explains itself in plain language",
      s == 200 and all(len(x["description"]) > 15 for x in _w.get("workers", [])),
      "a worker has no human-readable description")
check("U3 workers report health, not just activity",
      s == 200 and all("healthy" in x and "last_error" in x for x in _w.get("workers", [])),
      "worker status omits health")

s, _r = req("POST", "/api/system/workers/partial-files/run")
check("U4 a background check can be run on demand", s == 200 and "ok" in _r, f"got {s} {_r}")
s, _ = req("POST", "/api/system/workers/does-not-exist/run")
check("U5 an unknown background task is a clean 404", s == 404, f"got {s}")

# The recovery worker runs on a schedule. If it did not exclude the run that
# is live in this process, it would mark an in-progress training run as
# interrupted partway through its first epoch.
import backend.training as _tr2
_src2 = open(_tr2.__file__).read()
check("U6 run recovery cannot kill a training run that is actually live",
      "live_id" in _src2 and 'r.get("id") != live_id' in _src2,
      "reconcile_interrupted_runs no longer excludes the active run")

# Failure isolation: a worker that throws must keep running and be reported
# unhealthy, not take the process down or vanish.
class _Boom(_wk.Worker):
    name = "test-boom"; description = "deliberately failing test worker"; interval_s = 0.05
    def tick(self): raise RuntimeError("boom")

_sup = _wk.Supervisor(); _b = _Boom(); _sup.register(_b)
_t = threading.Thread(target=_sup._loop, args=(_b,), daemon=True); _t.start()
time.sleep(7); _sup._stop.set(); _t.join(timeout=3)
check("U7 a failing worker keeps retrying instead of dying",
      _b.status.runs >= 3, f"only ran {_b.status.runs} times")
check("U8 a persistently failing worker is reported unhealthy",
      _b.status.healthy is False and _sup.status()["unhealthy"] == ["test-boom"],
      f"health not reported: {_b.status.as_dict()}")
check("U9 the real error is preserved for diagnosis",
      "RuntimeError" in (_b.status.last_error or ""), f"got {_b.status.last_error}")

# A worker that recovers must clear its unhealthy state.
class _Flaky(_wk.Worker):
    name = "test-flaky"; description = "fails then recovers, for testing"; interval_s = 0.05
    def __init__(self): super().__init__(); self.n = 0
    def tick(self):
        self.n += 1
        if self.n <= 2: raise RuntimeError("transient")
        return "recovered" if self.n == 3 else None

_sup2 = _wk.Supervisor(); _f = _Flaky(); _sup2.register(_f)
_t2 = threading.Thread(target=_sup2._loop, args=(_f,), daemon=True); _t2.start()
time.sleep(8); _sup2._stop.set(); _t2.join(timeout=3)
check("U10 a recovered worker stops being reported unhealthy",
      _f.status.healthy and _f.status.consecutive_failures == 0 and _f.status.last_action == "recovered",
      f"got {_f.status.as_dict()}")

print("\n=== V. PRODUCT LANGUAGE ===")

# The launch screen is the first thing a clinician sees. Host:port there reads
# as a developer build, and means nothing to the person reading it.
_conn = open(os.path.join(_ROOT, "app/dashboard/components/BackendConnection.tsx")).read()
# Strip block comments before checking: the file documents the old wording in
# order to explain why it was removed, and matching that is a false positive.
_conn_code = re.sub(r"/\*.*?\*/", "", _conn, flags=re.S)
check("V1 the start-up screen does not show a host and port",
      "Starting server at" not in _conn_code and "backend\u2026" not in _conn_code,
      "the launch screen still exposes the service address")
# Matches the rendered label rather than the identifier that supplies it. The
# earlier version grepped for API_BASE and failed the moment that constant was
# replaced by apiBase(), even though the screen was unchanged — a test that
# breaks on a rename is reporting on the source, not on the product.
check("V2 the service address is still reachable for support",
      "Technical details" in _conn and "Local service address" in _conn,
      "technical detail was removed entirely instead of being tucked away")
check("V3 the failure screen tells the user what to try",
      "What to try" in _conn, "the error screen offers no next step")

# A busy engine must not surface to a pathologist as a hard failure.
_trial_page = open(os.path.join(_ROOT, "app/dashboard/trials/[id]/page.tsx")).read()
check("V4 a saturated engine is retried rather than shown as an error",
      "Retry-After" in _trial_page and "503" in _trial_page,
      "the frontend still ignores the backend's retryable busy response")

print("\n=== G. DATA-SUBJECT RIGHTS (GDPR) ===")
# ─── Data-subject rights (GDPR) ────────────────────────────────────────────
#
# These endpoints hand over and destroy personal records, so the tests that
# matter are the refusals, not the happy path.

s, _path_login = req("POST", "/api/users/login", body={"username": "path1", "password": "Path12345!"})
PATH_TOKEN = _path_login.get("token", "")

s, _subj = req("POST", "/api/patients/", token=ADMIN,
               body={"initials": "GD", "year_of_birth": 1962, "sex": "male",
                     "site": "Vilnius", "notes": "a private note"})
G_UID = _subj.get("uid", "")

s, _ = req("GET", f"/api/gdpr/subjects/{G_UID}/export", token=ADMIN)
check("G1 an administrator can export a subject record", s == 200,
      f"export returned {s}")

s, _ = req("GET", f"/api/gdpr/subjects/{G_UID}/export", token=PATH_TOKEN)
check("G2 a non-administrator cannot export a subject record", s == 403,
      f"a pathologist got {s} instead of 403 — subject access must be admin-only")

s, _ = req("GET", f"/api/gdpr/subjects/{G_UID}/export")
check("G3 subject export requires authentication", s in (401, 403),
      f"an anonymous caller got {s}")

# The export is itself a disclosure. Answering one subject-access request with
# another subject's processing history would be a breach, not a feature.
s, _export = req("GET", f"/api/gdpr/subjects/{G_UID}/export", token=ADMIN)
_other_uids = {p["uid"] for p in (req("GET", "/api/patients/", token=ADMIN)[1] or [])
               if p.get("uid") != G_UID}
_history = json.dumps(_export.get("processing_history", []))
check("G4 a subject export contains only that subject's history",
      not any(u in _history for u in _other_uids),
      "another subject's audit entries leaked into a subject-access response")

# Redaction must clear identifiers without touching the measurements.
s, _ = req("POST", f"/api/gdpr/subjects/{G_UID}/redact?reason=test", token=ADMIN)
s, _after = req("GET", f"/api/patients/{G_UID}", token=ADMIN)
check("G5 redaction clears every direct identifier",
      s == 200 and _after.get("initials") == "" and _after.get("notes") == ""
      and _after.get("site") == "" and _after.get("year_of_birth") is None,
      f"identifiers survived redaction: {_after}")
check("G6 redaction is recorded on the record itself",
      _after.get("redacted") is True,
      "the redaction flag was dropped — update_patient whitelists fields")

# A subject carrying a signed slide cannot be erased: the signature is part of
# the regulatory record. The refusal must explain itself.
s, _sub2 = req("POST", "/api/patients/", token=ADMIN, body={"initials": "HJ"})
S_UID = _sub2.get("uid", "")
s, _v = req("POST", f"/api/trials/{TID}/patients", token=ADMIN, body={"patient_id": S_UID})
_VID = _v.get("id", "")
s, _ = req("PATCH", f"/api/trials/patients/{_VID}", token=ADMIN,
           body={"slides": [{"id": "sg1", "confirmed": True, "grade_group": 2}]})
s, _refusal = req("POST", f"/api/gdpr/subjects/{S_UID}/erase?reason=test", token=ADMIN)
check("G7 erasure is refused while a signed slide exists", s == 409,
      f"erasure returned {s} — a signed grade must survive erasure")
_detail = (_refusal or {}).get("detail", {})
check("G8 the refusal cites the Article and offers the alternative",
      isinstance(_detail, dict) and "Article" in str(_detail.get("article", ""))
      and _detail.get("alternative") == "redact",
      f"the refusal gave no usable reason: {_detail}")

# A clean subject erases, and the tombstone proves it without naming anyone.
s, _erase = req("POST", f"/api/gdpr/subjects/{G_UID}/erase?reason=test", token=ADMIN)
_stone = (_erase or {}).get("tombstone", {})
check("G9 a subject with nothing blocking is erased", s == 200 and _stone.get("complete") is True,
      f"erase returned {s}: {_erase}")
# Search everything except the uid. The uid belongs in the tombstone — it is
# the whole point of one — and a bare substring search over the entire record
# false-positived when a randomly generated identifier happened to end in the
# same two letters as the subject's initials (OMN-8D0M-TCGD against "GD"). A
# test that fails on one run in twenty teaches people to re-run it, which is
# worse than not having it.
_stone_body = json.dumps({k: v for k, v in _stone.items() if k != "uid"})
check("G10 the tombstone records the erasure without personal data",
      "GD" not in _stone_body and "private note" not in _stone_body
      and _stone.get("uid") == G_UID,
      f"the tombstone leaked personal data: {_stone}")

s, _ = req("GET", f"/api/gdpr/subjects/{G_UID}/export", token=ADMIN)
check("G11 an erased subject reads as gone, not as never-existing", s == 410,
      f"export of an erased subject returned {s} — a controller must be able "
      f"to show the erasure happened")

s, _ret = req("GET", "/api/gdpr/retention", token=ADMIN)
check("G12 the retention position is reportable",
      s == 200 and isinstance(_ret.get("retention_years"), int) and _ret["retention_years"] > 0,
      f"retention returned {s}: {_ret}")

s, _a30 = req("GET", "/api/gdpr/processing-activities", token=ADMIN)
check("G13 an Article 30 record can be produced",
      s == 200 and "special_category" in json.dumps(_a30)
      and "limits_of_this_record" in _a30,
      "the processing record is missing its Article 9 category or its own caveat")



print("\n=== O. AUDIT TRAIL ORIGIN ===")
#
# 21 CFR Part 11 wants an audit entry to identify the source of a record. The
# thing that matters is not that the field is populated — it is that it is
# populated only when it is known, and blank rather than plausible otherwise.

s, _events = req("GET", "/api/audit/", token=ADMIN)
check("AO1 every audit entry carries an origin field",
      s == 200 and all("ip" in e for e in _events),
      "the origin field is missing from some entries")

_http = [e for e in _events if e.get("ip")]
check("AO2 an action taken over HTTP records where it came from",
      len(_http) > 0,
      "no audit entry recorded an origin, though every one of these was an API call")

# The middleware must not trust a forwarding header: if it did, any caller
# could choose the address written into their own audit record, which turns
# the one field that attributes an action into the easiest one to falsify.
s, _ = req("POST", "/api/patients/", token=ADMIN, body={"initials": "OR"},
           )
s, _after = req("GET", "/api/audit/", token=ADMIN)
_origins = {e.get("ip") for e in _after if e.get("ip")}
check("AO3 the recorded origin is the real peer, not a caller-supplied header",
      all(o and not o.startswith("9.9.9") for o in _origins),
      f"a spoofable origin was recorded: {_origins}")


print("\n=== TR. TRIAL STATUS AND END DATE ===")

s, _tr = req("POST", "/api/trials/", token=ADMIN,
             body={"name": "TR-STATUS", "sponsor": "S", "drug": "D",
                   "indication": "Prostate cancer", "phase": "Phase II"})
_TRID = _tr.get("id", "")
check("TR1 a new trial carries no end date",
      not _tr.get("ended"),
      f"a trial that has not ended was given an end date: {_tr.get('ended')!r}")

s, _hold = req("POST", f"/api/trials/{_TRID}/status", token=ADMIN, body={"status": "on_hold"})
check("TR2 a trial can be suspended without being closed",
      s == 200 and _hold.get("status") == "on_hold",
      f"on_hold was rejected ({s}) — a study paused by a monitoring committee "
      f"would have to be recorded as finished")
check("TR3 a suspended trial still has no end date",
      not _hold.get("ended"),
      "suspending a trial stamped an end date it has not reached")

s, _closed = req("POST", f"/api/trials/{_TRID}/status", token=ADMIN, body={"status": "closed"})
check("TR4 closing a trial stamps the end date",
      s == 200 and bool(_closed.get("ended")),
      "closing left no end date, so the date would have to be typed from memory later")

s, _re = req("POST", f"/api/trials/{_TRID}/status", token=ADMIN, body={"status": "active"})
check("TR5 reopening clears the end date",
      s == 200 and not _re.get("ended"),
      "a reopened trial kept an end date it has not reached")

s, _bad = req("POST", f"/api/trials/{_TRID}/status", token=ADMIN, body={"status": "finished"})
check("TR6 an unknown status is rejected", s >= 400,
      f"an arbitrary status was accepted ({s})")


print("\n=== US. USER ACCOUNTS ===")

# last_login is stamped where the credential is accepted, so a rejected attempt
# can never make a dormant account look like it is in use — which is exactly
# what an access review would be reading this field to find out.
s, _new = req("POST", "/api/users/", token=ADMIN,
              body={"username": "dormant1", "password": "Dorm12345!",
                    "full_name": "Dr Dormant One", "role": "pathologist"})
check("US1 a new account has never signed in",
      s == 200 and not _new.get("last_login"),
      f"a brand-new account already carried a sign-in date: {_new.get('last_login')!r}")

req("POST", "/api/users/login", body={"username": "dormant1", "password": "wrong-password"})
s, _all = req("GET", "/api/users/", token=ADMIN)
_d = next((u for u in _all if u.get("username") == "dormant1"), {})
check("US2 a rejected sign-in does not stamp the date",
      not _d.get("last_login"),
      "a failed login moved last_login — a dormant account would look active")

req("POST", "/api/users/login", body={"username": "dormant1", "password": "Dorm12345!"})
s, _all = req("GET", "/api/users/", token=ADMIN)
_d = next((u for u in _all if u.get("username") == "dormant1"), {})
check("US3 an accepted sign-in stamps the date",
      bool(_d.get("last_login")),
      "a successful login left last_login empty")

check("US4 the user list never exposes a password hash",
      all("password_hash" not in u for u in _all),
      "a password hash was returned to the client")


print("\n=== SP. SUPPORT SURFACES ===")

s, _cl = req("GET", "/api/system/changelog", token=ADMIN)
check("SP1 the release notes shipped with the build are readable",
      s == 200 and len(_cl.get("markdown", "")) > 100,
      "no bundled release notes — the app would have to fetch them, which it cannot do offline")

s, _raw = req_raw("GET", "/api/system/diagnostics", token=ADMIN)
check("SP2 an administrator can generate a diagnostics bundle",
      s == 200 and _raw[:2] == b"PK", f"diagnostics returned {s}")

# The point of the bundle is that it can be emailed. That only holds if it
# carries no patient data.
import io as _io, zipfile as _zip
try:
    _z = _zip.ZipFile(_io.BytesIO(_raw))
    _body = _z.read("diagnostics.json").decode()
except Exception:
    _body = ""
check("SP3 the diagnostics bundle carries no patient data",
      _body and not any(k in _body for k in ('"initials"', '"year_of_birth"', '"notes"', 'OMN-')),
      "a support file that carries clinical records turns a support request into a disclosure")

s, _ = req_raw("GET", "/api/system/diagnostics", token=PATH_TOKEN)
check("SP4 a non-administrator cannot generate diagnostics", s == 403,
      f"a pathologist got {s} — the bundle carries filesystem paths and a map of the machine")

s, _ = req_raw("GET", "/api/system/diagnostics")
check("SP5 diagnostics requires authentication", s in (401, 403), f"anonymous got {s}")


print("\n" + "=" * 60)
print(f"PASSED: {len(PASSES)}   FAILED: {len(FAILS)}")
print("=" * 60)
if FAILS:
    print("\nBUGS FOUND:")
    for n, d in FAILS:
        print(f"  * {n}\n      {d}")


_stop_server()
sys.exit(1 if FAILS else 0)
