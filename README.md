1) Directory layout (canonical)

project/
├─ backend/
│  ├─ app.py                 # Flask backend with SQLite (direct sqlite3, no ORM)
│  └─ requirements.txt       # List of packages to run in virtual environment
│  └─ data.sqlite3           # SQLite DB (created on first run)
│  └─ .env           	     # Used for environment configuration (loaded via python-dotenv)
├─ frontend/                 # All files served under /static/*
│  ├─ index.html             # Multi-video selector page
│  ├─ index-simple.html      # Single-video player page
│  ├─ dashboard.html         # Instructor dashboard
│  ├─ styles.css
│  ├─ player.js              # Single-video logic
│  ├─ mcq-multi.js           # Multi-video logic
│  ├─ dashboard.js           # Dashboard logic
│  ├─ choices-color.css      # Optional visual states for choices
│  ├─ choices-color.js       # Optional helpers (placeholder OK)
│  └─ favicon.svg            # (or favicon.ico)
├─ quizzes/                  # Quiz JSON files (one per video)
│  ├─ sample.json
│  └─ pp01.json
└─ mcq-manifest.json         # (Optional) Machine-readable manifest to lock paths

Static mapping: /static/* → frontend/*
Quiz content directory: quizzes/ (JSON files)

2) Pages and how to open them
/ → frontend/index.html (multi video)
/index-simple → frontend/index-simple.html (single video)
/dashboard → frontend/dashboard.html (instructor)

Static assets:
/static/styles.css → frontend/styles.css
/static/player.js → frontend/player.js
/favicon.svg (or .ico) → from frontend/

3) Environment and run

# from project/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# run (dynamic port by default)
python3 app.py
# or pin port
PORT=5000 python3 app.py
# delete key (required for delete endpoints)
export DELETE_KEY=changeme
# view key (required for loading attempts)
export VIEW_KEY=changeme

4) API contract (stable)

Quizzes
GET /api/quizzes → [{id, title?, category?}]
GET /api/quiz/<quiz_id> → full quiz JSON

Attempts
POST /api/attempt/<quiz_id>

{
  "viewer": "jdoe",
  "points": 2,
  "max_points": 3,
  "answers": { "q1": {...}, "q2": {...} },
  "category": "optional-tag"
}

GET /api/attempts?quiz_id=&viewer=&attempt=all|latest|best
→ { "attempts": [ ... ] }

DELETE /api/attempt/<id>
(Requires ADMIN_KEY if set; header X-Admin-Key or body/query admin_key.)

Bulk deletes (dashboard)

POST /api/attempts/delete_by_viewer
Body: { "quiz_id":"...", "viewer":"..." }

POST /api/attempts/delete_all
Body: { "quiz_id":"..." }

Exports

GET /api/export/attempts?quiz_id=&viewer=&attempt=latest|best|all&group_by=viewer|quiz|none&include_answers=0|1
GET /api/export/poll_fr?quiz_id=&attempt=latest|best|all&name_mode=id|prompt&limit_prompt=40

Poll & Free-Response (dashboard panel)

GET /api/responses?quiz_id=&type=all|poll|fr&attempt=all|latest|best
GET /api/polls/aggregate?quiz_id=&attempt=latest|best|all

Diagnostics

GET /api/selftest → basic health
GET /api/debug/dbinfo → DB path, schema, counts

5) Frontend element IDs (expected by JS)

index.html (multi-video selector)
#quizPicker (or similar selector per our multi script)
#overlay, #prompt, #choices
#submit, #continue, #feedback
#progress, #finish, #status

index-simple.html (single)
#player
Same overlay elements (#overlay, #prompt, #choices, etc.) managed by player.js
Global: window.QUIZ_ID = 'sample'

dashboard.html
Attempts panel:
#attemptsTable tbody (rows)
#attemptQuiz, #attemptViewer, #attemptMode
#btnRefreshAttempts, #btnDeleteByViewer, #btnDeleteAll, #btnExportAttempts
#attemptsStatus (message line)
Poll/FR panel:
#respPanel, #respQuiz, #respType, #respAttempt
#btnLoadResp, #btnExportPollFr
#respTable tbody, #pollAgg

6) Quiz JSON schema (authoring)

Minimal top-level:
{
  "id": "physics-2",
  "title": "Four Possible Mechanics Questions",
  "videoId": "JDYtZzB5VL8",
  "allowSeeking": false,
  "requireContinue": true,
  "requireWatchToEnd": true,
  "requireIdentity": true,
  "identityPrompt": "Enter your Cal Poly username (no @calpoly.edu)",
  "feedbackDelaySeconds": 3,
  "items": [ ... ]
}

Item types supported:

"pause": informational pause (no points).
{ "id":"p1","t":12,"type":"pause","prompt":"Read this and click Continue" }

"mcq": multiple choice, single correct; shows correct if wrong.
{
  "id":"q1","t":20,"type":"mcq","points":1,
  "prompt":"Which quantity is the time-derivative of position?",
  "choices":[{"id":"a","text":"Acceleration"},{"id":"b","text":"Velocity"}],
  "correct":["b"],
  "feedback":{"b":"Correct: v = dx/dt","*":"Review derivatives of motion."}
}

"checkbox": check all that apply; partial credit + penalties as configured in frontend logic; per-choice feedback optional.
"poll": no correct answer; selection(s) stored for aggregation.
"fr" (free response): short text captured; not graded; enforce length with maxLen (default 280–500).
{ "id":"id1","t":130,"type":"fr","maxLen":120,"placeholder":"Short reflection…" }

Notes:
t = timestamp in seconds when to pause.
Items with type: "pause" or the final identity prompt are excluded from score totals.
Per-item feedback is shown after submit, not on selection.

7) Data model (SQLite: attempts)

Columns:
id (INTEGER PK AUTOINCREMENT)
quiz_id (TEXT, NOT NULL)
viewer (TEXT)
points (REAL), max_points (REAL), score_percent (REAL)
answers_json (TEXT) — serialized JSON of per-item answers:
{
  "q1": {"kind":"mcq","selected":["b"]},
  "q2": {"kind":"checkbox","selected":["x","z"]},
  "p1": {"kind":"pause"},
  "id1": {"kind":"fr","text":"my userid","maxLen":120}
}
category (TEXT, optional tag)
created_at (TEXT, ISO-8601 UTC)

Sanitization:
viewer filtered to [A-Za-z0-9._-], length ≤ 120
FR text: control chars stripped, length clamped to maxLen

8) Security & admin
Delete endpoints require DELETE_KEY:
Header: X-Delete-Key: <value>, or body/query delete_key=<value>
If DELETE_KEY is unset, deletes are not allowed
User inputs are stored as inert text (never executed); control chars removed.
View endpoints require VIEW_KEY:
Header: X-View-Key: <value>, or body/query view_key=<value>
If VIEW_KEY is unset, attempts are not visible


9) Quick verification cookbook
Run the included validator to ensure the project matches the manifest:
This checks the SQLite schema, quiz JSON files, frontend IDs, and API contract.

python validate_snapshot.py

# See which DB is active, schema, counts
curl -s http://127.0.0.1:<PORT>/api/debug/dbinfo | jq .

# List quizzes
curl -s http://127.0.0.1:<PORT>/api/quizzes | jq .

# Smoke-test: submit an attempt
curl -s -X POST http://127.0.0.1:<PORT>/api/attempt/sample \
 -H 'Content-Type: application/json' \
 -d '{"viewer":"debug","points":1,"max_points":2,"answers":{"q1":{"kind":"mcq","selected":["b"]}}}' | jq .

# List attempts
curl -s 'http://127.0.0.1:<PORT>/api/attempts?attempt=latest' | jq .

# Export attempts CSV (latest per viewer)
open "http://127.0.0.1:<PORT>/api/export/attempts?quiz_id=sample&attempt=latest"

# Poll/FR summary
open "http://127.0.0.1:<PORT>/api/polls/aggregate?quiz_id=sample&attempt=latest"

10) Change policy (to keep things stable)
Do not rename directories/files listed above without first updating this README and (if used) mcq-manifest.json.
Any new endpoints must be appended (additive) and not break existing ones.
Frontend element IDs must remain as listed; new UI should add IDs, not rename.

11) Optional: machine-readable manifest

Keep mcq-manifest.json (from earlier) at the project root and point app.py to it (via MCQ_MANIFEST env var or default path). This lets tools and future helpers adhere to these paths automatically.

12) Convert quizzes to json files from csv:

csv_to_quizzes.py
Reads one CSV and writes one JSON per quiz (grouped by quiz_id / video_tag / quiz / etc.).
Supports item types: mcq, checkbox, fib, pause, poll, fr.
Per-choice feedback (feedback_a, feedback_b, …) for mcq/checkbox/poll (poll ignores correct).
Checkbox scoring knobs: pointsPerCorrect, penaltyPerWrong, capAtMax.
FIB: accept list, caseSensitive, placeholder.
Free response (fr): maxLen and placeholder; stored but unscored by default.
Timestamps accept seconds or mm:ss / hh:mm:ss.
Tolerant to header casing/spacing; cleans control chars; safe with listy cell values (Google Sheets exports).

Usage:
# dry run (prints JSON instead of writing)
python3 csv_to_quizzes.py path/to/input.csv --dry-run

# write JSON files to your actual quizzes folder
python3 csv_to_quizzes.py path/to/input.csv --out ../quizzes

Expected CSV columns (case-insensitive)

Top-level quiz fields (repeatable; last non-blank wins per quiz):
quiz_id (or video_tag, tag, quiz, id)
title, category
videoId (or video_id, videoid) required

Flags: allowSeeking, requireContinue, requireWatchToEnd, requireIdentity
identityPrompt, feedbackDelaySeconds

Per-item fields:
type (mcq | checkbox | fib | pause | poll | fr) — required
t (timestamp seconds or mm:ss or hh:mm:ss) — required
item_id (optional; auto if blank)
prompt, note (pause)
points (default 1 for mcq/fib; 0 for pause/poll/fr unless set)

Choices (mcq/checkbox/poll):
correct (not used for poll)
choice_a, choice_b, … ; optional feedback_a, feedback_b, …

Checkbox scoring (optional):
pointsPerCorrect, penaltyPerWrong, capAtMax

FIB:
accept, caseSensitive, placeholder

FR:
maxLen, placeholder

