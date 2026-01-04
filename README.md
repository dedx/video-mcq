# video-mcq

![License](https://img.shields.io/github/license/dedx/video-mcq)
![Repo Size](https://img.shields.io/github/repo-size/dedx/video-mcq)
![Last Commit](https://img.shields.io/github/last-commit/dedx/video-mcq)

Interactive video-based **MCQ / checkbox / poll / free-response** quizzes with a Flask + SQLite backend and a static frontend.

**Quiz content (CSV + JSON exports) lives in a separate repository:**  
➡️ **video-mcq-quizzes**: https://github.com/dedx/video-mcq-quizzes  
That repository’s content is licensed under **CC BY-NC 4.0** (see its `LICENSE`).

---

## Quick Start (5 minutes)

See [Instructor Quick Start](QuickStart.md) for instructions to get a server up and running for your class.

---

## Directory layout (canonical)

```text
project/
├─ backend/
│  ├─ app.py                 # Flask backend with SQLite (direct sqlite3, no ORM)
│  ├─ requirements.txt       # Packages for the virtual environment
│  └─ .env.example           # Example env config (copy to .env locally)
├─ frontend/                 # All files served under /static/*
│  ├─ index.html             # Multi-video selector page
│  ├─ index-simple.html      # Single-video player page
│  ├─ dashboard.html         # Instructor dashboard
│  ├─ styles.css
│  ├─ player.js              # Single-video logic
│  ├─ mcq-multi.js           # Multi-video logic
│  ├─ dashboard.js           # Dashboard logic
│  ├─ choices-color.css      # Optional visual states
│  ├─ choices-color.js       # Optional helpers
│  └─ favicon.svg            # (or favicon.ico)
├─ quizzes/                  # Quiz JSON files (optional examples only)
│  └─ sample.json
└─ mcq-manifest.json         # Optional manifest locking paths
```

**Static mapping:** `/static/*` → `frontend/*`  
**Quiz JSON directory:** `quizzes/`

> Note: The SQLite DB file is created on first run (path controlled by `DB_PATH` / app config). It is intentionally **not** committed.

---

## Pages and routes

- `/` → multi-video selector
- `/index-simple` → single-video player
- `/dashboard` → instructor dashboard

Static assets:
- `/static/styles.css`
- `/static/player.js`
- `/favicon.svg`

---

## Local development

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Optional environment variables:

```bash
export VIEW_KEY=changeme
export DELETE_KEY=changeme
export PORT=5000
```

> Do **not** commit `.env`. Use `.env.example` as a template.

---

## API contract (stable)

### Quizzes
- `GET /api/quizzes`
- `GET /api/quiz/<quiz_id>`

### Attempts
- `POST /api/attempt/<quiz_id>`
- `GET /api/attempts?attempt=all|latest|best`
- `DELETE /api/attempt/<id>` (requires `DELETE_KEY`)

### Bulk deletes
- `POST /api/attempts/delete_by_viewer`
- `POST /api/attempts/delete_all`

### Exports
- `GET /api/export/attempts`
- `GET /api/export/poll_fr`

### Diagnostics
- `GET /api/selftest`
- `GET /api/debug/dbinfo`

---

## Quiz JSON schema (authoring)

Supported item types:
- `pause`
- `mcq`
- `checkbox`
- `poll`
- `fib`
- `fr`

Minimal example:

```json
{
  "id": "physics-2",
  "title": "Four Possible Mechanics Questions",
  "videoId": "JDYtZzB5VL8",
  "allowSeeking": false,
  "requireContinue": true,
  "requireWatchToEnd": true,
  "requireIdentity": true,
  "identityPrompt": "Enter your username",
  "feedbackDelaySeconds": 3,
  "items": []
}
```

---

## Verification cookbook

```bash
curl http://127.0.0.1:PORT/api/debug/dbinfo
curl http://127.0.0.1:PORT/api/quizzes
curl -X POST http://127.0.0.1:PORT/api/attempt/sample \
  -H 'Content-Type: application/json' \
  -d '{"viewer":"debug","points":1,"max_points":2,"answers":{"q1":{"kind":"mcq","selected":["b"]}}}'
```

---

## Contributing

See `CONTRIBUTING.md`. If you’re reporting a bug, include:
- steps to reproduce
- expected vs actual behavior
- browser + OS
- relevant console/network output (redacting secrets)

---

## License

This repository contains the **software** and is licensed per `LICENSE`.

Quiz **content** is in the separate repo: https://github.com/dedx/video-mcq-quizzes (licensed **CC BY-NC 4.0**).
