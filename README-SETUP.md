# Portal Clientes - Setup

This repo contains:
- backend (FastAPI)
- frontend (React)
- sql/schema.sql

Backend env vars:
- DB_HOST
- DB_PORT
- DB_NAME
- DB_USER
- DB_PASS
- JWT_SECRET
- UPLOAD_DIR

Frontend build arg:
- VITE_API_URL (backend base URL)

EasyPanel deploy (Git source):

Backend app
1) Source: Git repo URL, branch main
2) Dockerfile: backend/Dockerfile
3) If a build path/context field exists: backend (or /backend if required)
4) Env vars: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, JWT_SECRET, UPLOAD_DIR
5) Expose port: 8000
6) Volume: /app/uploads (persist)

Frontend app
1) Source: Git repo URL, branch main
2) Dockerfile: frontend/Dockerfile
3) If a build path/context field exists: keep empty or repo root
4) Build arg: VITE_API_URL=https://<backend-domain>
5) Expose port: 80

Run local backend:
1) cd backend
2) python -m venv .venv
3) .venv\Scripts\activate
4) pip install -r requirements.txt
5) uvicorn app.main:app --reload
