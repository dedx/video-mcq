# video-mcq

Interactive video-based MCQ / checkbox / poll / free-response quizzes with a Flask + SQLite backend and a static frontend.

---

## Directory layout (canonical)

```text
project/
├─ backend/
│  ├─ app.py                 # Flask backend with SQLite (direct sqlite3, no ORM)
│  ├─ requirements.txt       # Packages for the virtual environment
│  └─ .env.example           # Example environment config (copy to .env locally)
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
├─ quizzes/                  # Quiz JSON files (one per video)
│  └─ sample.json
└─ mcq-manifest.json         # Optional manifest locking paths
```

**Static mapping:** `/static/*` → `frontend/*`  
**Quiz JSON directory:** `quizzes/`

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

## Frontend element IDs

### index.html
- `#quizPicker`
- `#overlay`, `#prompt`, `#choices`
- `#submit`, `#continue`, `#feedback`

### index-simple.html
- `#player`
- same overlay elements
- `window.QUIZ_ID = 'sample'`

### dashboard.html
- Attempts table and controls
- Poll / free-response aggregation panels

---

## Quiz JSON schema (authoring)

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

Supported item types:
- `pause`
- `mcq`
- `checkbox`
- `poll`
- `fib`
- `fr`

---

## Data model (SQLite)

Attempts table includes:
- quiz_id
- viewer
- points / max_points
- answers_json
- created_at

User input is sanitized and stored inertly.

---

## Security

- Delete endpoints require `DELETE_KEY`
- View endpoints require `VIEW_KEY`
- If keys are unset, actions are disabled

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

## Change policy

- Do not rename documented paths without updating this README
- API changes must be additive
- Frontend element IDs must not be renamed

---

## CSV → JSON conversion

The `csv_to_quizzes.py` tool converts CSV quizzes into per-quiz JSON files.

Supported item types:
`mcq`, `checkbox`, `fib`, `pause`, `poll`, `fr`

```bash
python3 csv_to_quizzes.py input.csv --out quizzes/
```
