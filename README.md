# FocusFlow (ADHD-first Todo)

Local-only, touch-friendly task manager that turns calendar invites into tasks. Built for Raspberry Pi with Docker.

## Why this works for ADHD
- Fast capture with a single prominent input.
- Limit focus to three tasks to reduce overwhelm.
- Clear priority buttons (low/med/high).
- Categories keep work and personal separated without clutter.

## Architecture
- `backend/` Flask + SQLite + SMTP inbox listener for calendar invites.
- `frontend/` React + Tailwind, served by Nginx.
- `docker-compose.yml` runs frontend, backend, and inbox listener.

## Data model
Tasks:
- title, description, priority, status
- category, focus flag, time estimate
- optional calendar event metadata (start/end/uid/attendees)

Categories:
- name, color (optional)

## Calendar invite → task flow
1. Invite your special email address to a calendar event (e.g. `todo@your-domain.com`).
2. Your email provider forwards the invite email to the Raspberry Pi SMTP listener.
3. `email_ingest.py` parses the `.ics` attachment and sends it to Flask.
4. Flask creates a task with event details.

## Run with Docker
```bash
docker compose up --build
```

Open:
- UI: `http://<pi-ip>:8080`
- API: `http://<pi-ip>:5000`

## Email ingest setup (example)
1. Set `INGEST_RECIPIENT` in `docker-compose.yml` (optional).
2. Configure your email provider to forward calendar invites to:
   - `<pi-ip>:8025` (use an SMTP forwarder), or
   - a local relay like postfix on the Pi that forwards to the ingest service.

The ingest service listens on port `8025` and accepts `.ics` invites.

## API sketch
`GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`  
`GET /api/categories`, `POST /api/categories`  
`POST /api/inbox/calendar`
