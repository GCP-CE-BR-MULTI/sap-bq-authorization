#!/usr/bin/env bash
# ==============================================================================
# Copel SAP S/4HANA -> BigQuery RLS Governance Console
# Automated Deployment Script for Google Cloud Run + BigQuery State Persistence
# ==============================================================================
set -euo pipefail

PROJECT_ID="${BQ_PROJECT_ID:-ce-sap-latam-genai}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-copel-sap-bq-rls-console}"
RAW_DATASET="${BQ_RAW_DATASET:-cortex7_sap_s4_raw}"
GOVERNANCE_DATASET="${BQ_GOVERNANCE_DATASET:-cortex7_sap_s4_security}"
BQ_LOCATION="${BQ_LOCATION:-US}"

echo "=================================================================="
echo " Google Cloud Run Deploy — Copel SAP-BQ RLS Governance Console"
echo "=================================================================="
echo " Project ID         : ${PROJECT_ID}"
echo " Cloud Run Region   : ${REGION}"
echo " Service Name       : ${SERVICE_NAME}"
echo " SAP Raw Dataset    : ${RAW_DATASET}"
echo " Governance Dataset : ${GOVERNANCE_DATASET} (app_governance_state & app_audit_log)"
echo "=================================================================="

# 1. Ensure Governance Dataset & State Tables exist in BigQuery
echo "[1/3] Provisionando tabelas de persistência da aplicação em ${PROJECT_ID}.${GOVERNANCE_DATASET}..."
bq --location="${BQ_LOCATION}" mk --dataset \
  --description="Dataset de Governança SAP RLS e Estado da Aplicação" \
  "${PROJECT_ID}:${GOVERNANCE_DATASET}" 2>/dev/null || true

bq --location="${BQ_LOCATION}" query --use_legacy_sql=false \
  --label="service:copel_sap_rls_console" \
  "CREATE TABLE IF NOT EXISTS \`${PROJECT_ID}.${GOVERNANCE_DATASET}.app_governance_state\` (
     state_key STRING NOT NULL,
     state_json STRING NOT NULL,
     updated_by STRING,
     updated_at TIMESTAMP NOT NULL
   );
   CREATE TABLE IF NOT EXISTS \`${PROJECT_ID}.${GOVERNANCE_DATASET}.app_audit_log\` (
     audit_id STRING NOT NULL,
     event_ts TIMESTAMP NOT NULL,
     actor STRING NOT NULL,
     module STRING NOT NULL,
     action STRING NOT NULL,
     details STRING,
     status STRING NOT NULL
   )
   PARTITION BY DATE(event_ts)
   CLUSTER BY module, action;"

# 2. Enable required Google Cloud APIs
echo "[2/3] Verificando APIs necessárias no projeto ${PROJECT_ID}..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  bigquery.googleapis.com \
  geminidataanalytics.googleapis.com \
  --project="${PROJECT_ID}"

# 3. Build and Deploy to Cloud Run from source
echo "[3/3] Executando build e deploy no Cloud Run (${SERVICE_NAME})..."
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --set-env-vars="BQ_PROJECT_ID=${PROJECT_ID},BQ_RAW_DATASET=${RAW_DATASET},BQ_GOVERNANCE_DATASET=${GOVERNANCE_DATASET},BQ_LOCATION=${BQ_LOCATION},BQ_STATE_SYNC=true,BQ_BOOTSTRAP_ON_START=true" \
  --labels="app=copel-sap-rls-governance,env=production"

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')
echo "=================================================================="
echo " Deploy concluído com sucesso!"
echo " URL da Aplicação: ${SERVICE_URL}"
echo " Estado persistido em: ${PROJECT_ID}.${GOVERNANCE_DATASET}.app_governance_state"
echo "=================================================================="
