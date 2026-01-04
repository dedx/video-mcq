# Instructor Quick Start — video-mcq

This document provides a **complete, self-contained quick start guide**
for instructors or developers who want to run **video-mcq** locally
and then switch to full quiz content.

Nothing in this document is a command to the project maintainer.
All instructions are intended for **end users**.

---

## Overview

- Run the **video-mcq** application locally
- Verify functionality using a built-in sample quiz
- Connect full quiz content from the companion quizzes repository

---

## Prerequisites

- Python 3.9 or newer
- Git
- A modern web browser (Chrome, Firefox, Safari)

---

## Step 1: Get the application code

Clone the main application repository:

```bash
git clone https://github.com/dedx/video-mcq.git
cd video-mcq
```

---

## Step 2: Start the backend server

Create a Python virtual environment, install dependencies, and start the Flask backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

By default, the server starts at:

```
http://127.0.0.1:5000
```

---

## Step 3: Open the frontend

With the backend running, open one of the following URLs in your browser:

- **Multi-video selector**  
  http://127.0.0.1:5000/

- **Single-video player (sample quiz)**  
  http://127.0.0.1:5000/index-simple

- **Instructor dashboard**  
  http://127.0.0.1:5000/dashboard

The repository includes a small sample quiz so you can immediately verify that the system is working.

---

## Step 4: Use real quizzes

Full quiz content is maintained in a separate repository:

https://github.com/dedx/video-mcq-quizzes

That repository contains:
- `pp_quizzes.csv` — the authoritative quiz source
- `quiz_template.csv` — supported question types and examples
- optional JSON quiz exports

To use real quizzes:

1. Edit quizzes in CSV format
2. Convert CSV files into per-quiz JSON files (instructions provided in the quizzes repo)
3. Copy the generated JSON files into this project’s `quizzes/` directory

---

## Step 5: Enable instructor controls (optional)

To enable instructor-only features such as viewing or deleting attempts,
set the following environment variables before starting the backend:

```bash
export VIEW_KEY=your-view-key
export DELETE_KEY=your-delete-key
```

These keys protect the instructor dashboard and administrative endpoints.

---

## What you should have now

- The backend server running locally
- Frontend pages accessible in your browser
- Sample quiz verified
- A clear path to using full quiz content

At this point, **video-mcq** is ready for classroom use.
