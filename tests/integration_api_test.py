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
import shutil

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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
s, r = req("POST", f"/api/trials/{TID}/patients", token=ADMIN, body={"patient_id": ""})
check("C2 empty patient_id rejected", s in (400, 422), f"got {s}")
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

print("\n" + "=" * 60)
print(f"PASSED: {len(PASSES)}   FAILED: {len(FAILS)}")
print("=" * 60)
if FAILS:
    print("\nBUGS FOUND:")
    for n, d in FAILS:
        print(f"  * {n}\n      {d}")

_stop_server()
sys.exit(1 if FAILS else 0)
