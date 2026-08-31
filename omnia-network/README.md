# Omnia Network

The federated-contribution server. Separate from the desktop app: this runs
on infrastructure you host, not on a site's machine.

What it does:
1. Sites `POST /contribute` with their locally fine-tuned attention/classifier
   heads (never the backbone, never patient data — see `network_server/ingest.py`
   for the size guard that catches an accidental full-checkpoint upload).
2. Contributions sit in `pending/` until you run the merge yourself.
3. `python -m network_server.merge` (or `POST /admin/merge` from the console)
   runs a sample-weighted average (FedAvg) over the selected contributions.
4. Sites `GET /latest` and `GET /release/{version}` to pull a published
   version and hot-swap their local head.

## Console

`console/` is the operator dashboard — pending contributions, release
history, site management, server health. It talks only to the `/admin/*`
endpoints below, gated by `OMNIA_NETWORK_ADMIN_TOKEN`. See
`console/README.md` to run it.

## Run it

```bash
cd omnia-network
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export OMNIA_NETWORK_SECRET="<a real secret — do not use the dev fallback in production>"
export OMNIA_NETWORK_ADMIN_TOKEN="<a real secret — gates every /admin/* route, unset = all admin calls 401>"
uvicorn network_server.main:app --host 0.0.0.0 --port 8420
```

## Issue a site key

```python
from network_server.auth import issue_site_key
import datetime
print(issue_site_key("site-name", datetime.date.today().isoformat()))
```

Give the site their key, and set on their install:

```
OMNIA_NETWORK_URL=https://your-network-host:8420
OMNIA_NETWORK_SITE_KEY=<the key above>
```

## Merge pending contributions

```bash
python -m network_server.merge
```

Prints who contributed and how much, computes the sample-weighted average,
and asks for confirmation before writing a new versioned release. It does
**not** evaluate the merged model against a benchmark for you yet — check
the merged head's agreement on your held-out set before confirming.

## What this is not, yet

- No automatic aggregation — every merge is a decision you make.
- No eval gate in `merge.py` — wire in a benchmark comparison (same pattern
  as `backend/finetune.py`'s promotion gate) before treating a publish as
  safe to auto-adopt on the client side.
- No TLS termination configured here — put this behind a reverse proxy
  (nginx, Caddy) with HTTPS before any real site sends anything to it.
