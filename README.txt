================================================================
RUNNING ALL SERVICES (development)
================================================================

Open 3 separate terminals and run:

Terminal 1 — Backend:
  cd sigla-backend
  npm run dev

Terminal 2 — ML Service:
  cd sigla-ml
  venv\Scripts\activate
  uvicorn app.main:app --reload --port 8000 --host 0.0.0.0

Terminal 3 — Admin Panel:
  cd sigla-admin
  npm run dev