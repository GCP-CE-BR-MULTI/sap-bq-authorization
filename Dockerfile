# ==============================================================================
# Stage 1: Build React + Vite Frontend
# ==============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: FastAPI + BigQuery Runtime for Google Cloud Run
# ==============================================================================
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    BQ_PROJECT_ID=ce-sap-latam-genai \
    BQ_GOVERNANCE_DATASET=cortex7_sap_s4_security \
    BQ_LOCATION=US \
    BQ_STATE_SYNC=true \
    BQ_BOOTSTRAP_ON_START=true

WORKDIR /app

# Install runtime Python dependencies (excluding local-only Playwright browser binaries)
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    pydantic \
    python-multipart \
    requests \
    google-auth \
    google-auth-oauthlib \
    google-cloud-bigquery \
    google-cloud-geminidataanalytics

# Copy backend source and built frontend SPA
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

WORKDIR /app/backend

EXPOSE 8080

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
