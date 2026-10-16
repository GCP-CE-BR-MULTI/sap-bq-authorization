import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import google.auth
from google.cloud import bigquery
from google.oauth2 import credentials as oauth_credentials
from google.oauth2 import service_account

from state_store import append_app_audit, load_state, now_iso, save_state


def get_bq_client(conn: Dict[str, Any], state: Dict[str, Any]) -> Tuple[bigquery.Client, str]:
    """Instantiate a BigQuery client using the selected authentication mode."""
    project_id = conn.get("project_id", "ce-sap-latam-genai")
    auth_mode = conn.get("auth_mode", "oauth_adc")
    conn_id = conn.get("id", "conn-copel-s4")

    if auth_mode == "service_account":
        sa_keys = state.get("service_account_keys", {})
        sa_info = sa_keys.get(conn_id)
        if sa_info:
            creds = service_account.Credentials.from_service_account_info(sa_info)
            sa_email = sa_info.get("client_email", "service-account")
            return bigquery.Client(project=project_id, credentials=creds), f"Service Account ({sa_email})"
        raise ValueError(
            "Modo Service Account selecionado, mas nenhuma chave JSON foi carregada para esta conexão."
        )

    if auth_mode == "oauth_token":
        tokens = state.get("oauth_tokens", {})
        token_str = tokens.get(conn_id)
        if token_str:
            creds = oauth_credentials.Credentials(token=token_str)
            return bigquery.Client(project=project_id, credentials=creds), f"OAuth 2.0 User Token ({conn.get('oauth_user_email') or 'Token Ativo'})"
        # Fallback to ADC if user has active OAuth session in environment
        creds, default_proj = google.auth.default()
        principal = getattr(creds, "service_account_email", None) or conn.get("oauth_user_email") or "OAuth Session"
        return bigquery.Client(project=project_id or default_proj, credentials=creds), f"OAuth 2.0 ADC ({principal})"

    # Default: oauth_adc (Application Default Credentials / gcloud OAuth)
    creds, default_proj = google.auth.default()
    principal = getattr(creds, "service_account_email", None) or conn.get("oauth_user_email") or "admin@felipechagas.altostrat.com"
    return bigquery.Client(project=project_id or default_proj, credentials=creds), f"Google OAuth / ADC ({principal})"


def run_bq_query(
    client: bigquery.Client,
    sql: str,
    location: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Run a BigQuery SQL query with attribution labels and return rows + job telemetry."""
    t0 = time.time()
    job_config = bigquery.QueryJobConfig(
        labels={"datacloud": "antigravity"}
    )
    query_job = client.query(sql, job_config=job_config, location=location)
    result = query_job.result()
    elapsed_ms = int((time.time() - t0) * 1000)

    rows = []
    for row in result:
        d = {}
        for k, v in dict(row).items():
            if hasattr(v, "isoformat"):
                d[k] = v.isoformat()
            else:
                d[k] = v
        rows.append(d)

    meta = {
        "job_id": query_job.job_id,
        "location": query_job.location,
        "elapsed_ms": elapsed_ms,
        "total_bytes_processed": query_job.total_bytes_processed or 0,
        "total_bytes_billed": query_job.total_bytes_billed or 0,
        "num_dml_affected_rows": query_job.num_dml_affected_rows,
        "row_count": len(rows),
        "statement_type": query_job.statement_type or "SELECT",
    }
    return rows, meta


def test_connection_and_prerequisites(conn: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    """Validate BigQuery connection, check SAP security tables, and calculate email coverage."""
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]

    client, auth_identity = get_bq_client(conn, state)

    # 1. Check SAP Raw Security + Core Business Tables
    tables_sql = f"""
    SELECT
      table_id AS table_name,
      row_count,
      ROUND(size_bytes / POW(1024, 2), 3) AS size_mb,
      TIMESTAMP_MILLIS(last_modified_time) AS last_modified
    FROM `{project_id}.{raw_ds}.__TABLES__`
    WHERE table_id IN (
      'usr02', 'usr21', 'adr6', 'agr_users', 'agr_agrs', 'agr_1252', 'agr_1251', 'ust04',
      't001', 'bkpf', 'bseg', 'acdoca', 'tvko', 'vbak', 'ekko'
    )
    ORDER BY table_name
    """
    raw_tables, job1 = run_bq_query(client, tables_sql)
    raw_map = {r["table_name"]: r for r in raw_tables}

    mandatory_sec_tables = [
        ("usr02", "Dados de Logon do Usuário (Status/Validade)"),
        ("usr21", "Chave Mestra Usuário-Endereço (BAS)"),
        ("adr6", "Endereços de E-mail Corporativo (SMTP)"),
        ("agr_users", "Atribuição de Roles aos Usuários"),
        ("agr_agrs", "Hierarquia de Roles Compostas"),
        ("agr_1252", "Valores de Níveis Organizacionais ($bukrs, etc.)"),
        ("agr_1251", "Valores de Objetos e Campos de Autorização"),
        ("ust04", "Perfis Mestre de Superusuários (SAP_ALL / SAP_NEW)"),
    ]

    sec_tables_status = []
    for t_name, desc in mandatory_sec_tables:
        info = raw_map.get(t_name)
        sec_tables_status.append({
            "table_name": t_name,
            "description": desc,
            "exists": info is not None,
            "row_count": info["row_count"] if info else 0,
            "size_mb": info["size_mb"] if info else 0.0,
            "last_modified": info["last_modified"] if info else None,
        })

    # 2. Check Email Coverage (bname -> smtp_addr)
    coverage_sql = f"""
    SELECT
      COUNT(DISTINCT u.bname) AS total_sap_users,
      COUNT(DISTINCT IF(a.smtp_addr IS NOT NULL AND a.smtp_addr LIKE '%@%', u.bname, NULL)) AS users_with_valid_email,
      ROUND(
        SAFE_DIVIDE(
          COUNT(DISTINCT IF(a.smtp_addr IS NOT NULL AND a.smtp_addr LIKE '%@%', u.bname, NULL)),
          COUNT(DISTINCT u.bname)
        ) * 100, 2
      ) AS email_coverage_pct
    FROM `{project_id}.{raw_ds}.usr02` u
    LEFT JOIN `{project_id}.{raw_ds}.usr21` up
      ON u.bname = up.bname
    LEFT JOIN `{project_id}.{raw_ds}.adr6` a
      ON up.persnumber = a.persnumber AND up.addrnumber = a.addrnumber
    WHERE (u.uflag IS NULL OR u.uflag = 0)
    """
    try:
        cov_rows, _ = run_bq_query(client, coverage_sql)
        coverage = cov_rows[0] if cov_rows else {}
    except Exception:
        coverage = {"total_sap_users": 0, "users_with_valid_email": 0, "email_coverage_pct": 0}

    # 3. Check Governance Dataset objects
    gov_objects = {"dataset_exists": False, "tables": [], "routines": []}
    try:
        gov_tbl_sql = f"""
        SELECT table_id AS table_name, row_count, TIMESTAMP_MILLIS(last_modified_time) AS last_modified
        FROM `{project_id}.{gov_ds}.__TABLES__`
        """
        gov_tbls, _ = run_bq_query(client, gov_tbl_sql)
        gov_objects["dataset_exists"] = True
        gov_objects["tables"] = gov_tbls

        gov_rout_sql = f"""
        SELECT routine_name, routine_type, last_altered
        FROM `{project_id}.{gov_ds}.INFORMATION_SCHEMA.ROUTINES`
        """
        gov_routs, _ = run_bq_query(client, gov_rout_sql)
        gov_objects["routines"] = gov_routs
    except Exception:
        gov_objects["dataset_exists"] = False

    return {
        "status": "CONNECTED",
        "tested_at": now_iso(),
        "auth_identity": auth_identity,
        "project_id": project_id,
        "raw_dataset": raw_ds,
        "governance_dataset": gov_ds,
        "location": job1.get("location") or conn.get("location", "US"),
        "security_tables": sec_tables_status,
        "identity_coverage": coverage,
        "governance_objects": gov_objects,
    }


def build_setup_steps(conn: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build the 6 automated setup steps with exact BigQuery SQL scripts."""
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]
    grantees = conn.get(
        "default_grantees",
        "'user:admin@felipechagas.altostrat.com', 'user:fchagas@felipechagas.altostrat.com'",
    )
    sa_list = conn.get("bypass_service_accounts", ["%@ce-sap-latam-genai.iam.gserviceaccount.com"])
    admin_list = conn.get("bypass_admins", ["admin@felipechagas.altostrat.com"])

    sa_like_clause = " OR ".join([f"SESSION_USER() LIKE '{sa}'" for sa in sa_list]) if sa_list else "FALSE"
    admins_str = ", ".join([f"'{a}'" for a in admin_list]) if admin_list else "'admin@felipechagas.altostrat.com'"

    step1_sql = f"""-- PASSO 1: Diagnóstico das 8 Tabelas de Segurança SAP e Cobertura de Identidade (ADR6)
SELECT 
  table_id AS table_name,
  row_count,
  ROUND(size_bytes / POW(1024, 2), 2) AS size_mb,
  TIMESTAMP_MILLIS(last_modified_time) AS last_modified
FROM `{project_id}.{raw_ds}.__TABLES__`
WHERE table_id IN ('usr02', 'usr21', 'adr6', 'agr_users', 'agr_agrs', 'agr_1252', 'agr_1251', 'ust04')
ORDER BY table_name;"""

    step2_sql = f"""-- PASSO 2: Criação do Dataset de Governança e Segurança SAP no BigQuery
CREATE SCHEMA IF NOT EXISTS `{project_id}.{gov_ds}`
OPTIONS(
  description="Dataset de governança de acesso, perfis PFCG e Row-Level Security (RLS) SAP"
);"""

    step3_sql = f"""-- PASSO 3: Criação das Tabelas de Entitlements, Configuração e Auditoria RLS
CREATE TABLE IF NOT EXISTS `{project_id}.{gov_ds}.sec_user_org_entitlements`
(
  user_email STRING NOT NULL OPTIONS(description="E-mail corporativo institucional (coincide com SESSION_USER())"),
  sap_uname STRING NOT NULL OPTIONS(description="ID do usuário no SAP (bname)"),
  org_field STRING NOT NULL OPTIONS(description="Campo organizacional padronizado (bukrs, werks, vkorg, etc.)"),
  org_value STRING OPTIONS(description="Valor organizacional desnormalizado para correspondência direta no RLS (IN subquery)"),
  val_low STRING OPTIONS(description="Valor pontual de autorização ou início de faixa"),
  val_high STRING OPTIONS(description="Fim da faixa de autorização (NULL para valores pontuais)"),
  is_all_access BOOL NOT NULL OPTIONS(description="TRUE indica acesso total (*) ou SAP_ALL concedido"),
  source_roles ARRAY<STRING> OPTIONS(description="Lista de roles PFCG que concederam o privilégio"),
  updated_at TIMESTAMP NOT NULL OPTIONS(description="Data e hora do processamento da linha")
)
CLUSTER BY user_email, org_field
OPTIONS(
  description="Tabela mestra de autorizações organizacionais desnormalizadas para consumo do RLS"
);

CREATE TABLE IF NOT EXISTS `{project_id}.{gov_ds}.sec_table_rls_config`
(
  project_id STRING NOT NULL,
  dataset_name STRING NOT NULL,
  table_name STRING NOT NULL,
  org_field STRING NOT NULL,
  rls_column_name STRING NOT NULL,
  filter_type STRING NOT NULL,
  is_active BOOL NOT NULL,
  consumer_grantees STRING NOT NULL,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `{project_id}.{gov_ds}.sec_rls_audit_log`
(
  execution_id STRING NOT NULL,
  target_project STRING NOT NULL,
  target_dataset STRING NOT NULL,
  target_table STRING NOT NULL,
  org_field STRING NOT NULL,
  action STRING NOT NULL,
  policy_name STRING NOT NULL,
  error_message STRING,
  applied_by STRING NOT NULL,
  applied_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(applied_at)
CLUSTER BY target_table, org_field;

-- Tabelas de Persistência de Estado e Auditoria da Aplicação (Cloud Run Stateless)
CREATE TABLE IF NOT EXISTS `{project_id}.{gov_ds}.app_governance_state`
(
  state_key STRING NOT NULL OPTIONS(description="Chave única do estado da aplicação (GLOBAL_APP_STATE)"),
  state_json STRING NOT NULL OPTIONS(description="Documento JSON com conexões, RBAC, grupos e configurações"),
  updated_by STRING OPTIONS(description="Operador que realizou a última alteração"),
  updated_at TIMESTAMP NOT NULL OPTIONS(description="Timestamp UTC da última gravação")
);

CREATE TABLE IF NOT EXISTS `{project_id}.{gov_ds}.app_audit_log`
(
  audit_id STRING NOT NULL,
  event_ts TIMESTAMP NOT NULL,
  actor STRING NOT NULL,
  module STRING NOT NULL,
  action STRING NOT NULL,
  details STRING,
  status STRING NOT NULL
)
PARTITION BY DATE(event_ts)
CLUSTER BY module, action;"""

    step4_sql = f"""-- PASSO 4: Deploy das Stored Procedures (Refresh Entitlements, Apply RLS e Revoke RLS)
CREATE OR REPLACE PROCEDURE `{project_id}.{gov_ds}.sp_refresh_sap_entitlements`()
BEGIN
  CREATE OR REPLACE TABLE `{project_id}.{gov_ds}.sec_user_org_entitlements`
  CLUSTER BY user_email, org_field
  AS
  WITH active_users AS (
    SELECT
      LOWER(TRIM(a.smtp_addr)) AS user_email,
      u.bname AS sap_uname
    FROM `{project_id}.{raw_ds}.usr02` u
    INNER JOIN `{project_id}.{raw_ds}.usr21` up
      ON u.bname = up.bname
    INNER JOIN `{project_id}.{raw_ds}.adr6` a
      ON up.persnumber = a.persnumber AND up.addrnumber = a.addrnumber
    WHERE (u.uflag IS NULL OR u.uflag = 0)
      AND CURRENT_DATE() BETWEEN COALESCE(u.gltgv, DATE '1900-01-01') AND COALESCE(u.gltgb, DATE '9999-12-31')
      AND a.smtp_addr IS NOT NULL
  ),
  user_roles_expanded AS (
    SELECT
      au.user_email,
      au.sap_uname,
      COALESCE(comp.child_agr, r.agr_name) AS effective_role
    FROM active_users au
    INNER JOIN `{project_id}.{raw_ds}.agr_users` r
      ON au.sap_uname = r.uname
    LEFT JOIN `{project_id}.{raw_ds}.agr_agrs` comp
      ON r.agr_name = comp.agr_name
    WHERE CURRENT_DATE() BETWEEN COALESCE(r.from_dat, DATE '1900-01-01') AND COALESCE(r.to_dat, DATE '9999-12-31')
  ),
  raw_org_permissions AS (
    SELECT
      ur.user_email,
      ur.sap_uname,
      ur.effective_role,
      LOWER(REGEXP_REPLACE(a1252.varbl, r'^\\$', '')) AS org_field,
      TRIM(a1252.low) AS val_low,
      TRIM(a1252.high) AS val_high
    FROM user_roles_expanded ur
    INNER JOIN `{project_id}.{raw_ds}.agr_1252` a1252
      ON ur.effective_role = a1252.agr_name
    WHERE a1252.varbl IS NOT NULL AND a1252.varbl != ''
    UNION ALL
    SELECT
      ur.user_email,
      ur.sap_uname,
      ur.effective_role,
      LOWER(TRIM(a1251.field)) AS org_field,
      TRIM(a1251.low) AS val_low,
      TRIM(a1251.high) AS val_high
    FROM user_roles_expanded ur
    INNER JOIN `{project_id}.{raw_ds}.agr_1251` a1251
      ON ur.effective_role = a1251.agr_name
    WHERE LOWER(a1251.field) IN ('bukrs', 'werks', 'vkorg', 'ekorg', 'gsber', 'prctr')
      AND NOT STARTS_WITH(TRIM(a1251.low), '$')
    UNION ALL
    SELECT
      au.user_email,
      au.sap_uname,
      'PROFILE:SAP_ALL' AS effective_role,
      '*' AS org_field,
      '*' AS val_low,
      CAST(NULL AS STRING) AS val_high
    FROM active_users au
    INNER JOIN `{project_id}.{raw_ds}.ust04` p
      ON au.sap_uname = p.bname
    WHERE UPPER(p.profile) IN ('SAP_ALL', 'SAP_NEW')
  ),
  master_bukrs AS (
    SELECT DISTINCT bukrs AS org_value FROM `{project_id}.{raw_ds}.t001`
    UNION DISTINCT
    SELECT DISTINCT bukrs FROM `{project_id}.{raw_ds}.bkpf`
  ),
  expanded_values AS (
    SELECT
      p.user_email, p.sap_uname, p.org_field,
      p.val_low AS org_value, p.val_low, p.val_high,
      FALSE AS is_all_access, p.effective_role
    FROM raw_org_permissions p
    WHERE p.val_low != '*' AND (p.val_high IS NULL OR p.val_high = '')
    UNION ALL
    SELECT
      p.user_email, p.sap_uname, p.org_field,
      m.org_value, p.val_low, p.val_high,
      FALSE AS is_all_access, p.effective_role
    FROM raw_org_permissions p
    JOIN master_bukrs m
      ON p.org_field = 'bukrs' AND m.org_value BETWEEN p.val_low AND p.val_high
    WHERE p.val_high IS NOT NULL AND p.val_high != ''
    UNION ALL
    SELECT
      p.user_email, p.sap_uname, p.org_field,
      CAST(NULL AS STRING) AS org_value, p.val_low, p.val_high,
      TRUE AS is_all_access, p.effective_role
    FROM raw_org_permissions p
    WHERE p.val_low = '*' OR p.org_field = '*'
  )
  SELECT
    user_email, sap_uname, org_field, org_value, val_low, val_high, is_all_access,
    ARRAY_AGG(DISTINCT effective_role) AS source_roles,
    CURRENT_TIMESTAMP() AS updated_at
  FROM expanded_values
  WHERE (org_value IS NOT NULL AND org_value != '') OR is_all_access = TRUE
  GROUP BY user_email, sap_uname, org_field, org_value, val_low, val_high, is_all_access;
END;

CREATE OR REPLACE PROCEDURE `{project_id}.{gov_ds}.sp_apply_sap_rls`(
  target_project STRING,
  target_dataset STRING,
  org_column_name STRING,
  consumer_grantees STRING
)
BEGIN
  DECLARE exec_id STRING;
  DECLARE formatted_grantees STRING;
  DECLARE dynamic_grantees STRING;
  SET exec_id = GENERATE_UUID();
  SET formatted_grantees = TRIM(COALESCE(consumer_grantees, ''));

  -- Se consumer_grantees estiver vazio, busca dinamicamente todos os usuários com acesso ativo àquele nível org na tabela de entitlements
  IF formatted_grantees = '' OR formatted_grantees = "''" OR formatted_grantees = '""' THEN
    EXECUTE IMMEDIATE FORMAT(\"\"\"
      SELECT STRING_AGG(DISTINCT CONCAT("'user:", LOWER(user_email), "'"), ', ')
      FROM `%s.%s.sec_user_org_entitlements`
      WHERE (LOWER(org_field) = LOWER('%s') OR org_field = '*')
        AND user_email IS NOT NULL 
        AND user_email != ''
        AND NOT ENDS_WITH(LOWER(user_email), '.sap-ag.de')
        AND (ENDS_WITH(LOWER(user_email), '@felipechagas.altostrat.com') OR ENDS_WITH(LOWER(user_email), '@google.com') OR ENDS_WITH(LOWER(user_email), '@copel.com'))
    \"\"\", target_project, '{gov_ds}', org_column_name)
    INTO dynamic_grantees;

    IF dynamic_grantees IS NOT NULL AND dynamic_grantees != '' THEN
      SET formatted_grantees = dynamic_grantees;
    ELSE
      -- Fallback para admin corporativo caso nenhum usuário possua autorização mapeada
      SET formatted_grantees = "'user:admin@felipechagas.altostrat.com'";
    END IF;
  ELSE
    IF NOT (STARTS_WITH(formatted_grantees, "'") OR STARTS_WITH(formatted_grantees, '"')) THEN
      SET formatted_grantees = FORMAT("'%s'", formatted_grantees);
    END IF;
  END IF;

  FOR target IN (
    SELECT table_name
    FROM `{project_id}.{raw_ds}.INFORMATION_SCHEMA.COLUMNS`
    WHERE LOWER(column_name) = LOWER(org_column_name)
      AND table_schema = target_dataset
      AND table_name NOT LIKE 'agr_%'
      AND table_name NOT LIKE 'usr%'
      AND table_name NOT LIKE 'adr%'
      AND table_name NOT LIKE 'dd%'
      AND table_name NOT LIKE 't001%'
      AND table_name NOT LIKE 'sec_%'
    GROUP BY table_name
  )
  DO
    BEGIN
      EXECUTE IMMEDIATE FORMAT(\"\"\"
        CREATE OR REPLACE ROW ACCESS POLICY rap_auto_%s_%s
        ON `%s.%s.%s`
        GRANT TO (%s)
        FILTER USING (
          SESSION_USER() LIKE '%%@{project_id}.iam.gserviceaccount.com'
          OR SESSION_USER() IN ('admin@felipechagas.altostrat.com')
          OR TRUE IN (
            SELECT is_all_access
            FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
            WHERE user_email = SESSION_USER()
              AND (org_field = '%s' OR org_field = '*')
              AND is_all_access = TRUE
          )
          OR %s IN (
            SELECT org_value
            FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
            WHERE user_email = SESSION_USER()
              AND org_field = '%s'
          )
        );
      \"\"\",
        LOWER(org_column_name), LOWER(target.table_name),
        target_project, target_dataset, target.table_name,
        formatted_grantees,
        LOWER(org_column_name), LOWER(org_column_name), LOWER(org_column_name)
      );

      INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
      VALUES (
        exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
        'APPLIED', FORMAT('rap_auto_%s_%s', LOWER(org_column_name), LOWER(target.table_name)),
        NULL, SESSION_USER(), CURRENT_TIMESTAMP()
      );
    EXCEPTION WHEN ERROR THEN
      INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
      VALUES (
        exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
        'FAILED', FORMAT('rap_auto_%s_%s', LOWER(org_column_name), LOWER(target.table_name)),
        @@error.message, SESSION_USER(), CURRENT_TIMESTAMP()
      );
    END;
  END FOR;
END;

CREATE OR REPLACE PROCEDURE `{project_id}.{gov_ds}.sp_revoke_sap_rls`(
  target_project STRING,
  target_dataset STRING,
  org_column_name STRING
)
BEGIN
  DECLARE exec_id STRING;
  SET exec_id = GENERATE_UUID();

  FOR target IN (
    SELECT DISTINCT table_name
    FROM `{project_id}.{raw_ds}.INFORMATION_SCHEMA.COLUMNS`
    WHERE LOWER(column_name) = LOWER(org_column_name)
      AND table_schema = target_dataset
      AND table_name NOT LIKE 'agr_%'
      AND table_name NOT LIKE 'usr%'
      AND table_name NOT LIKE 'adr%'
      AND table_name NOT LIKE 'dd%'
      AND table_name NOT LIKE 't001%'
      AND table_name NOT LIKE 'sec_%'
    UNION DISTINCT
    SELECT DISTINCT target_table AS table_name
    FROM `{project_id}.{gov_ds}.sec_rls_audit_log`
    WHERE target_project = target_project
      AND target_dataset = target_dataset
      AND LOWER(org_field) = LOWER(org_column_name)
      AND action = 'APPLIED'
  )
  DO
    BEGIN
      DECLARE policy_name STRING;
      SET policy_name = FORMAT('rap_auto_%s_%s', LOWER(org_column_name), LOWER(target.table_name));

      BEGIN
        EXECUTE IMMEDIATE FORMAT(\"\"\"
          DROP ROW ACCESS POLICY IF EXISTS %s ON `%s.%s.%s`;
        \"\"\", policy_name, target_project, target_dataset, target.table_name);

        INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
        VALUES (
          exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
          'REVOKED', policy_name, NULL, SESSION_USER(), CURRENT_TIMESTAMP()
        );
      EXCEPTION WHEN ERROR THEN
        IF CONTAINS_SUBSTR(LOWER(@@error.message), 'drop all') 
           OR CONTAINS_SUBSTR(LOWER(@@error.message), 'last row access policy') THEN
          BEGIN
            EXECUTE IMMEDIATE FORMAT(\"\"\"
              DROP ALL ROW ACCESS POLICIES ON `%s.%s.%s`;
            \"\"\", target_project, target_dataset, target.table_name);

            INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
            VALUES (
              exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
              'REVOKED', FORMAT('%s (DROP ALL)', policy_name), NULL, SESSION_USER(), CURRENT_TIMESTAMP()
            );
          EXCEPTION WHEN ERROR THEN
            INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
            VALUES (
              exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
              'FAILED_REVOKE', policy_name, @@error.message, SESSION_USER(), CURRENT_TIMESTAMP()
            );
          END;
        ELSE
          INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
          VALUES (
            exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
            'FAILED_REVOKE', policy_name, @@error.message, SESSION_USER(), CURRENT_TIMESTAMP()
          );
        END IF;
      END;
    END;
  END FOR;
END;"""

    step5_sql = f"""-- PASSO 5: Execução da Consolidação de Entitlements SAP -> BigQuery
CALL `{project_id}.{gov_ds}.sp_refresh_sap_entitlements`();"""

    step6_sql = f"""-- PASSO 6: Aplicação de Row-Level Security (RLS) Automática por Metadados (bukrs)
CALL `{project_id}.{gov_ds}.sp_apply_sap_rls`(
  '{project_id}',
  '{raw_ds}',
  'bukrs',
  "{grantees}"
);"""

    return [
        {
            "step_number": 1,
            "id": "step_1_prereq",
            "title": "Validação das 8 Tabelas CDC SAP & Identidade",
            "phase": "Fase 0: Pré-requisitos",
            "description": "Verifica no BigQuery a presença e volumetria das tabelas usr02, usr21, adr6, agr_users, agr_agrs, agr_1251, agr_1252 e ust04.",
            "target_object": f"{project_id}.{raw_ds}.__TABLES__",
            "sql": step1_sql,
            "estimated_time": "~2s",
        },
        {
            "step_number": 2,
            "id": "step_2_dataset",
            "title": "Criação do Dataset de Governança",
            "phase": "Fase 1: Estrutura",
            "description": f"Garante a existência do schema `{gov_ds}` no projeto `{project_id}` com metadados de governança SAP.",
            "target_object": f"{project_id}.{gov_ds}",
            "sql": step2_sql,
            "estimated_time": "~2s",
        },
        {
            "step_number": 3,
            "id": "step_3_tables",
            "title": "Criação das Tabelas de Entitlements e Auditoria",
            "phase": "Fase 1: Tabelas de Controle",
            "description": "Cria as tabelas sec_user_org_entitlements (clusterizada por user_email, org_field), sec_table_rls_config e sec_rls_audit_log.",
            "target_object": f"{project_id}.{gov_ds}.sec_user_org_entitlements",
            "sql": step3_sql,
            "estimated_time": "~4s",
        },
        {
            "step_number": 4,
            "id": "step_4_procedures",
            "title": "Deploy das Stored Procedures de Automação",
            "phase": "Fase 2 & 3: Motor SQL",
            "description": "Compila e atualiza as procedures de automação: sp_refresh_sap_entitlements, sp_apply_sap_rls e sp_revoke_sap_rls.",
            "target_object": f"{project_id}.{gov_ds}.sp_refresh_sap_entitlements",
            "sql": step4_sql,
            "estimated_time": "~5s",
        },
        {
            "step_number": 5,
            "id": "step_5_refresh",
            "title": "Execução da Carga de Entitlements SAP",
            "phase": "Fase 2: Materialização",
            "description": "Executa CALL sp_refresh_sap_entitlements() para popular a tabela desnormalizada com as permissões atuais do SAP.",
            "target_object": f"CALL {gov_ds}.sp_refresh_sap_entitlements()",
            "sql": step5_sql,
            "estimated_time": "~6s",
        },
        {
            "step_number": 6,
            "id": "step_6_apply_rls",
            "title": "Aplicação de Políticas RLS (Piloto / Escala)",
            "phase": "Fase 3: Row Access Policies",
            "description": "Aplica Row Access Policies não correlacionadas nas tabelas de negócio e registra no sec_rls_audit_log.",
            "target_object": f"CALL {gov_ds}.sp_apply_sap_rls()",
            "sql": step6_sql,
            "estimated_time": "~8s",
        },
    ]


def execute_setup_step(
    step_id: str,
    conn: Dict[str, Any],
    state: Dict[str, Any],
    custom_sql: Optional[str] = None,
    pilot_only: bool = True,
) -> Dict[str, Any]:
    """Execute a specific setup step in BigQuery and generate detailed terminal logs."""
    steps = build_setup_steps(conn)
    step = next((s for s in steps if s["id"] == step_id), None)
    if not step:
        raise ValueError(f"Passo '{step_id}' não encontrado.")

    client, auth_identity = get_bq_client(conn, state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]
    grantees = conn.get(
        "default_grantees",
        "'user:admin@felipechagas.altostrat.com', 'user:fchagas@felipechagas.altostrat.com'",
    )

    logs: List[Dict[str, Any]] = []

    def add_log(level: str, msg: str, meta: Optional[Dict[str, Any]] = None):
        logs.append({
            "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3],
            "level": level,
            "message": msg,
            "meta": meta or {},
        })

    add_log("INFO", f"Iniciando execução do [{step['title']}] no projeto '{project_id}'...")
    add_log("INFO", f"Credencial ativa: {auth_identity}")

    sql_to_run = custom_sql or step["sql"]

    # For Step 6, if pilot_only is True, apply on pilot table (bkpf) so it finishes in ~2 seconds instead of looping 50 tables, unless full batch requested
    if step_id == "step_6_apply_rls" and pilot_only and not custom_sql:
        exec_id = str(uuid.uuid4())
        sql_to_run = f"""
        CREATE OR REPLACE ROW ACCESS POLICY rap_auto_bukrs_bkpf
        ON `{project_id}.{raw_ds}.bkpf`
        GRANT TO ({grantees})
        FILTER USING (
          SESSION_USER() LIKE '%@ce-sap-latam-genai.iam.gserviceaccount.com'
          OR SESSION_USER() IN ('admin@felipechagas.altostrat.com')
          OR TRUE IN (
            SELECT is_all_access
            FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
            WHERE user_email = SESSION_USER()
              AND (org_field = 'bukrs' OR org_field = '*')
              AND is_all_access = TRUE
          )
          OR bukrs IN (
            SELECT org_value
            FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
            WHERE user_email = SESSION_USER()
              AND org_field = 'bukrs'
          )
        );
        INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
        VALUES (
          '{exec_id}', '{project_id}', '{raw_ds}', 'bkpf', 'bukrs',
          'APPLIED', 'rap_auto_bukrs_bkpf', NULL, SESSION_USER(), CURRENT_TIMESTAMP()
        );
        """
        add_log("INFO", "Modo de validação rápida (Tabela Piloto 'bkpf') selecionado para confirmação de DDL.")

    try:
        add_log("SQL", f"Submetendo job ao motor BigQuery:\n{sql_to_run.strip()}")
        rows, meta = run_bq_query(client, sql_to_run)
        add_log(
            "SUCCESS",
            f"Job BigQuery concluído com sucesso! Job ID: {meta['job_id']} | Tempo: {meta['elapsed_ms']} ms | Bytes processados: {meta['total_bytes_processed']:,}",
            meta,
        )

        # Extra post-step telemetry
        if step_id == "step_1_prereq":
            add_log("INFO", f"Tabelas de segurança verificadas: {len(rows)}/8 encontradas no dataset '{raw_ds}'.")
            for r in rows:
                add_log("DATA", f"• Tabela {r['table_name']}: {r['row_count']:,} linhas ({r['size_mb']} MB)")
        elif step_id == "step_5_refresh":
            count_rows, _ = run_bq_query(
                client,
                f"SELECT COUNT(*) AS total_rows, COUNT(DISTINCT user_email) AS total_users, COUNT(DISTINCT org_field) AS total_fields FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`",
            )
            if count_rows:
                c = count_rows[0]
                add_log(
                    "DATA",
                    f"Tabela sec_user_org_entitlements atualizada: {c['total_rows']} regras ativas para {c['total_users']} usuários e {c['total_fields']} campos organizacionais.",
                )

        run_record = {
            "run_id": f"run-{int(time.time() * 1000)}",
            "step_id": step_id,
            "step_number": step["step_number"],
            "step_title": step["title"],
            "status": "SUCCESS",
            "executed_at": now_iso(),
            "executed_by": state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
            "job_meta": meta,
            "logs": logs,
            "preview_rows": rows[:15],
        }
        state.setdefault("setup_runs", []).insert(0, run_record)
        state["setup_runs"] = state["setup_runs"][:100]
        save_state(state)

        append_app_audit(
            actor=state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
            module="SETUP",
            action=f"EXECUTE_{step_id.upper()}",
            details=f"Passo '{step['title']}' executado com sucesso (Job: {meta['job_id']}, {meta['elapsed_ms']} ms).",
            status="SUCCESS",
        )
        return run_record

    except Exception as exc:
        err_str = str(exc)
        add_log("ERROR", f"Erro ao executar passo no BigQuery: {err_str}")
        run_record = {
            "run_id": f"run-{int(time.time() * 1000)}",
            "step_id": step_id,
            "step_number": step["step_number"],
            "step_title": step["title"],
            "status": "FAILED",
            "executed_at": now_iso(),
            "executed_by": state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
            "job_meta": {"error": err_str},
            "logs": logs,
            "preview_rows": [],
        }
        state.setdefault("setup_runs", []).insert(0, run_record)
        save_state(state)

        append_app_audit(
            actor=state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
            module="SETUP",
            action=f"EXECUTE_{step_id.upper()}",
            details=f"Falha no passo '{step['title']}': {err_str[:200]}",
            status="FAILED",
        )
        return run_record


def get_sap_roles_catalog(conn: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch SAP PFCG Roles, Composite Role hierarchy, Org Levels, Auth Objects, and Users."""
    client, _ = get_bq_client(conn, state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]

    sql = f"""
    WITH distinct_role_users AS (
      SELECT DISTINCT
        au.agr_name AS role_name,
        au.uname AS sap_uname,
        LOWER(TRIM(COALESCE(a.smtp_addr, ''))) AS user_email,
        CAST(au.from_dat AS STRING) AS from_dat,
        CAST(au.to_dat AS STRING) AS to_dat
      FROM `{project_id}.{raw_ds}.agr_users` au
      LEFT JOIN `{project_id}.{raw_ds}.usr21` u21 ON au.uname = u21.bname
      LEFT JOIN `{project_id}.{raw_ds}.adr6` a ON u21.persnumber = a.persnumber AND u21.addrnumber = a.addrnumber
    ),
    role_users AS (
      SELECT
        role_name,
        ARRAY_AGG(STRUCT(sap_uname, user_email, from_dat, to_dat) LIMIT 50) AS assigned_users,
        COUNT(DISTINCT sap_uname) AS user_count
      FROM distinct_role_users
      GROUP BY role_name
    ),
    composite_children AS (
      SELECT
        agr_name AS role_name,
        ARRAY_AGG(DISTINCT child_agr LIMIT 50) AS child_roles
      FROM `{project_id}.{raw_ds}.agr_agrs`
      GROUP BY agr_name
    ),
    distinct_org_levels AS (
      SELECT DISTINCT
        agr_name AS role_name,
        LOWER(REGEXP_REPLACE(varbl, r'^\\$', '')) AS org_field,
        varbl AS raw_varbl,
        TRIM(low) AS val_low,
        TRIM(COALESCE(high, '')) AS val_high
      FROM `{project_id}.{raw_ds}.agr_1252`
      WHERE varbl IS NOT NULL AND varbl != ''
    ),
    org_levels AS (
      SELECT
        role_name,
        ARRAY_AGG(STRUCT(org_field, raw_varbl, val_low, val_high) LIMIT 100) AS org_values,
        COUNT(*) AS org_rules_count
      FROM distinct_org_levels
      GROUP BY role_name
    ),
    distinct_auth_objects AS (
      SELECT DISTINCT
        agr_name AS role_name,
        object AS auth_object,
        LOWER(TRIM(field)) AS field_name,
        TRIM(low) AS val_low,
        TRIM(COALESCE(high, '')) AS val_high
      FROM `{project_id}.{raw_ds}.agr_1251`
      WHERE LOWER(TRIM(field)) IN ('bukrs', 'werks', 'vkorg', 'ekorg', 'gsber', 'prctr', 'kokrs', 'vtweg', 'spart', 'actvt')
    ),
    auth_objects AS (
      SELECT
        role_name,
        ARRAY_AGG(STRUCT(auth_object, field_name, val_low, val_high) LIMIT 100) AS auth_fields,
        COUNT(DISTINCT auth_object) AS auth_objects_count
      FROM distinct_auth_objects
      GROUP BY role_name
    ),
    all_role_names AS (
      SELECT DISTINCT agr_name AS role_name FROM `{project_id}.{raw_ds}.agr_users`
      UNION DISTINCT
      SELECT DISTINCT agr_name AS role_name FROM `{project_id}.{raw_ds}.agr_1252`
      UNION DISTINCT
      SELECT DISTINCT agr_name AS role_name FROM `{project_id}.{raw_ds}.agr_agrs`
    )
    SELECT
      r.role_name,
      IF(ARRAY_LENGTH(cc.child_roles) > 0, 'COMPOSITE_ROLE', 'SINGLE_ROLE') AS role_type,
      COALESCE(ru.user_count, 0) AS user_count,
      COALESCE(ol.org_rules_count, 0) AS org_rules_count,
      COALESCE(ao.auth_objects_count, 0) AS auth_objects_count,
      cc.child_roles,
      ru.assigned_users,
      ol.org_values,
      ao.auth_fields
    FROM all_role_names r
    LEFT JOIN role_users ru ON r.role_name = ru.role_name
    LEFT JOIN composite_children cc ON r.role_name = cc.role_name
    LEFT JOIN org_levels ol ON r.role_name = ol.role_name
    LEFT JOIN auth_objects ao ON r.role_name = ao.role_name
    ORDER BY user_count DESC, org_rules_count DESC, r.role_name
    LIMIT 200
    """
    roles, meta = run_bq_query(client, sql)

    # Also query ust04 SAP_ALL profiles
    ust04_sql = f"""
    WITH distinct_ust04 AS (
      SELECT DISTINCT
        p.profile AS role_name,
        p.bname AS sap_uname,
        LOWER(TRIM(COALESCE(a.smtp_addr, ''))) AS user_email
      FROM `{project_id}.{raw_ds}.ust04` p
      LEFT JOIN `{project_id}.{raw_ds}.usr21` u21 ON p.bname = u21.bname
      LEFT JOIN `{project_id}.{raw_ds}.adr6` a ON u21.persnumber = a.persnumber AND u21.addrnumber = a.addrnumber
      WHERE UPPER(p.profile) IN ('SAP_ALL', 'SAP_NEW')
    )
    SELECT
      role_name,
      'MASTER_PROFILE' AS role_type,
      COUNT(DISTINCT sap_uname) AS user_count,
      ARRAY_AGG(STRUCT(sap_uname, user_email)) AS assigned_users
    FROM distinct_ust04
    GROUP BY role_name
    """
    try:
        profiles, _ = run_bq_query(client, ust04_sql)
    except Exception:
        profiles = []

    return {
        "roles": roles,
        "master_profiles": profiles,
        "meta": meta,
    }


def get_access_matrix(conn: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch the User & Group Access Matrix from sec_user_org_entitlements + t001 company codes."""
    client, _ = get_bq_client(conn, state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]

    ent_sql = f"""
    SELECT
      user_email,
      sap_uname,
      org_field,
      org_value,
      val_low,
      val_high,
      is_all_access,
      source_roles,
      updated_at
    FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
    ORDER BY user_email, org_field, org_value
    """
    ent_rows, meta = run_bq_query(client, ent_sql)

    t001_sql = f"""
    SELECT DISTINCT bukrs, butxt, ort01, waers
    FROM `{project_id}.{raw_ds}.t001`
    WHERE bukrs IS NOT NULL
    ORDER BY bukrs
    LIMIT 100
    """
    try:
        companies, _ = run_bq_query(client, t001_sql)
    except Exception:
        companies = []

    # Build user-centric pivoted summary
    users_dict: Dict[str, Dict[str, Any]] = {}
    org_fields_set = set()

    for r in ent_rows:
        email = r["user_email"]
        field = r["org_field"]
        org_fields_set.add(field)
        if email not in users_dict:
            users_dict[email] = {
                "principal": email,
                "principal_type": "USER",
                "sap_uname": r["sap_uname"],
                "is_superuser": False,
                "source_roles": set(),
                "fields": {},
                "updated_at": r["updated_at"],
            }
        u = users_dict[email]
        for sr in (r.get("source_roles") or []):
            u["source_roles"].add(sr)
        if field == "*" and r.get("is_all_access"):
            u["is_superuser"] = True

        f_entry = u["fields"].setdefault(field, {"is_all_access": False, "values": [], "raw_vars": []})
        if r.get("is_all_access"):
            f_entry["is_all_access"] = True
        val = r.get("org_value") or r.get("val_low")
        if val:
            if str(val).startswith("$"):
                if val not in f_entry["raw_vars"]:
                    f_entry["raw_vars"].append(val)
            else:
                if val not in f_entry["values"]:
                    f_entry["values"].append(val)

    matrix_users = []
    for u in users_dict.values():
        u["source_roles"] = sorted(list(u["source_roles"]))
        matrix_users.append(u)

    return {
        "raw_entitlements": ent_rows,
        "pivoted_users": matrix_users,
        "custom_group_mappings": state.get("custom_group_mappings", []),
        "org_fields": sorted(list(org_fields_set)),
        "companies": companies,
        "meta": meta,
    }


def get_rls_table_matrix(conn: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch all SAP Raw tables with org columns, their RLS status, audit logs, and clustering FinOps status."""
    client, _ = get_bq_client(conn, state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]

    sql = f"""
    WITH org_columns AS (
      SELECT
        table_name,
        LOWER(column_name) AS org_field,
        column_name AS physical_column,
        data_type,
        clustering_ordinal_position
      FROM `{project_id}.{raw_ds}.INFORMATION_SCHEMA.COLUMNS`
      WHERE LOWER(column_name) IN ('bukrs', 'werks', 'vkorg', 'ekorg', 'gsber', 'prctr')
        AND table_name NOT LIKE 'agr_%'
        AND table_name NOT LIKE 'usr%'
        AND table_name NOT LIKE 'adr%'
        AND table_name NOT LIKE 'dd%'
        AND table_name NOT LIKE 't001%'
        AND table_name NOT LIKE 'sec_%'
    ),
    table_clustering AS (
      SELECT
        table_name,
        ARRAY_TO_STRING(ARRAY_AGG(column_name ORDER BY clustering_ordinal_position), ', ') AS clustering_fields
      FROM `{project_id}.{raw_ds}.INFORMATION_SCHEMA.COLUMNS`
      WHERE clustering_ordinal_position IS NOT NULL
      GROUP BY table_name
    ),
    table_stats AS (
      SELECT
        table_id AS table_name,
        row_count,
        ROUND(size_bytes / POW(1024, 2), 2) AS size_mb
      FROM `{project_id}.{raw_ds}.__TABLES__`
    ),
    latest_audit AS (
      SELECT
        target_table AS table_name,
        LOWER(org_field) AS org_field,
        action,
        policy_name,
        error_message,
        applied_by,
        applied_at
      FROM `{project_id}.{gov_ds}.sec_rls_audit_log`
      QUALIFY ROW_NUMBER() OVER (PARTITION BY target_table, LOWER(org_field) ORDER BY applied_at DESC) = 1
    )
    SELECT
      oc.table_name,
      oc.org_field,
      oc.physical_column,
      oc.data_type,
      COALESCE(ts.row_count, 0) AS row_count,
      COALESCE(ts.size_mb, 0.0) AS size_mb,
      oc.clustering_ordinal_position IS NOT NULL AS is_org_clustered,
      tc.clustering_fields,
      COALESCE(la.action, 'UNPROTECTED') AS rls_status,
      COALESCE(la.policy_name, CONCAT('rap_auto_', oc.org_field, '_', LOWER(oc.table_name))) AS policy_name,
      la.applied_by,
      la.applied_at,
      la.error_message
    FROM org_columns oc
    LEFT JOIN table_clustering tc ON oc.table_name = tc.table_name
    LEFT JOIN table_stats ts ON oc.table_name = ts.table_name
    LEFT JOIN latest_audit la ON oc.table_name = la.table_name AND oc.org_field = la.org_field
    ORDER BY
      CASE WHEN la.action = 'APPLIED' THEN 0 ELSE 1 END,
      ts.row_count DESC,
      oc.table_name,
      oc.org_field
    """
    rows, meta = run_bq_query(client, sql)

    # Also get recent audit history
    audit_sql = f"""
    SELECT
      execution_id,
      target_project,
      target_dataset,
      target_table,
      org_field,
      action,
      policy_name,
      error_message,
      applied_by,
      applied_at
    FROM `{project_id}.{gov_ds}.sec_rls_audit_log`
    ORDER BY applied_at DESC
    LIMIT 60
    """
    try:
        audit_logs, _ = run_bq_query(client, audit_sql)
    except Exception:
        audit_logs = []

    default_grantees = conn.get(
        "default_grantees",
        "'user:admin@felipechagas.altostrat.com', 'user:fchagas@felipechagas.altostrat.com'",
    )
    for r in rows:
        r["grantees"] = default_grantees
        r["filter_expression"] = (
            f"TRUE IN (SELECT is_all_access FROM `{project_id}.{gov_ds}.sec_user_org_entitlements` "
            f"WHERE user_email = SESSION_USER() AND (org_field = '{r['org_field']}' OR org_field = '*') AND is_all_access = TRUE) "
            f"OR {r['physical_column']} IN (SELECT org_value FROM `{project_id}.{gov_ds}.sec_user_org_entitlements` "
            f"WHERE user_email = SESSION_USER() AND org_field = '{r['org_field']}')"
        )

    return {
        "tables": rows,
        "audit_logs": audit_logs,
        "meta": meta,
    }


def manage_single_table_rls(
    action: str,  # 'APPLY' | 'REVOKE'
    table_name: str,
    org_field: str,
    grantees: Optional[str],
    conn: Dict[str, Any],
    state: Dict[str, Any],
) -> Dict[str, Any]:
    """Apply or Revoke Row-Level Security on a single BigQuery table and record in sec_rls_audit_log."""
    client, _ = get_bq_client(conn, state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]
    exec_id = str(uuid.uuid4())
    policy_name = f"rap_auto_{org_field.lower()}_{table_name.lower()}"
    raw_grantees = (grantees or "").strip()
    if not raw_grantees:
        # Dynamically extract all authorized users for this org_field from sec_user_org_entitlements
        corp_domain = conn.get("corporate_domain", "@felipechagas.altostrat.com")
        dyn_sql = f"""
        SELECT STRING_AGG(DISTINCT CONCAT("'user:", LOWER(user_email), "'"), ', ') AS dynamic_users
        FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
        WHERE (LOWER(org_field) = '{org_field.lower()}' OR org_field = '*')
          AND user_email IS NOT NULL 
          AND user_email != ''
          AND NOT ENDS_WITH(LOWER(user_email), '.sap-ag.de')
          AND (ENDS_WITH(LOWER(user_email), '{corp_domain}') OR ENDS_WITH(LOWER(user_email), '@google.com') OR ENDS_WITH(LOWER(user_email), '@copel.com'))
        """
        try:
            dyn_rows, _ = run_bq_query(client, dyn_sql)
            if dyn_rows and dyn_rows[0].get("dynamic_users"):
                eff_grantees = dyn_rows[0]["dynamic_users"]
            else:
                eff_grantees = "'user:admin@felipechagas.altostrat.com'"
        except Exception:
            eff_grantees = "'user:admin@felipechagas.altostrat.com'"
    else:
        eff_grantees = raw_grantees
        if not (eff_grantees.startswith("'") or eff_grantees.startswith('"')):
            eff_grantees = f"'{eff_grantees}'"

    if action.upper() == "APPLY":
        ddl_sql = f"""
        CREATE OR REPLACE ROW ACCESS POLICY {policy_name}
        ON `{project_id}.{raw_ds}.{table_name}`
        GRANT TO ({eff_grantees})
        FILTER USING (
          SESSION_USER() LIKE '%@ce-sap-latam-genai.iam.gserviceaccount.com'
          OR SESSION_USER() IN ('admin@felipechagas.altostrat.com')
          OR TRUE IN (
            SELECT is_all_access
            FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
            WHERE user_email = SESSION_USER()
              AND (org_field = '{org_field.lower()}' OR org_field = '*')
              AND is_all_access = TRUE
          )
          OR {org_field.lower()} IN (
            SELECT org_value
            FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
            WHERE user_email = SESSION_USER()
              AND org_field = '{org_field.lower()}'
          )
        );
        INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
        VALUES (
          '{exec_id}', '{project_id}', '{raw_ds}', '{table_name}', '{org_field.lower()}',
          'APPLIED', '{policy_name}', NULL, SESSION_USER(), CURRENT_TIMESTAMP()
        );
        """
    else:
        try:
            ddl_sql = f"""
            DROP ROW ACCESS POLICY IF EXISTS {policy_name} ON `{project_id}.{raw_ds}.{table_name}`;
            INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
            VALUES (
              '{exec_id}', '{project_id}', '{raw_ds}', '{table_name}', '{org_field.lower()}',
              'REVOKED', '{policy_name}', NULL, SESSION_USER(), CURRENT_TIMESTAMP()
            );
            """
            _, meta = run_bq_query(client, ddl_sql)
        except Exception as exc:
            err_str = str(exc).lower()
            if "drop all" in err_str or "last row access policy" in err_str:
                ddl_sql = f"""
                DROP ALL ROW ACCESS POLICIES ON `{project_id}.{raw_ds}.{table_name}`;
                INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
                VALUES (
                  '{exec_id}', '{project_id}', '{raw_ds}', '{table_name}', '{org_field.lower()}',
                  'REVOKED', '{policy_name} (DROP ALL)', NULL, SESSION_USER(), CURRENT_TIMESTAMP()
                );
                """
                _, meta = run_bq_query(client, ddl_sql)
            else:
                fail_sql = f"""
                INSERT INTO `{project_id}.{gov_ds}.sec_rls_audit_log`
                VALUES (
                  '{exec_id}', '{project_id}', '{raw_ds}', '{table_name}', '{org_field.lower()}',
                  'FAILED_REVOKE', '{policy_name}', {repr(str(exc)[:500])}, SESSION_USER(), CURRENT_TIMESTAMP()
                );
                """
                try:
                    run_bq_query(client, fail_sql)
                except Exception:
                    pass
                raise exc

    if action.upper() == "APPLY":
        _, meta = run_bq_query(client, ddl_sql)

    append_app_audit(
        actor=state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
        module="RLS MATRIX",
        action=f"{action.upper()}_RLS",
        details=f"Política '{policy_name}' ({action.upper()}) na tabela `{project_id}.{raw_ds}.{table_name}` (Job: {meta.get('job_id')}).",
        status="SUCCESS",
    )
    return {
        "status": "SUCCESS",
        "action": action.upper(),
        "table_name": table_name,
        "org_field": org_field,
        "policy_name": policy_name,
        "sql_executed": ddl_sql.strip(),
        "job_meta": meta,
    }


def revoke_all_tables_by_org_field(
    org_field: str,
    conn: Dict[str, Any],
    state: Dict[str, Any],
) -> Dict[str, Any]:
    """Execute sp_revoke_sap_rls to sweep across the dataset and revoke all RLS for the given org_field."""
    client, _ = get_bq_client(conn, state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]
    org_clean = org_field.strip().lower()

    call_sql = f"""
    CALL `{project_id}.{gov_ds}.sp_revoke_sap_rls`(
      '{project_id}',
      '{raw_ds}',
      '{org_clean}'
    );
    """
    rows, meta = run_bq_query(client, call_sql)

    # Fetch recently revoked tables in this run from sec_rls_audit_log
    audit_check_sql = f"""
    SELECT target_table, policy_name, action, error_message, applied_at
    FROM `{project_id}.{gov_ds}.sec_rls_audit_log`
    WHERE LOWER(org_field) = '{org_clean}'
      AND applied_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 MINUTE)
    ORDER BY applied_at DESC
    LIMIT 100
    """
    try:
        revoked_rows, _ = run_bq_query(client, audit_check_sql)
    except Exception:
        revoked_rows = []

    append_app_audit(
        actor=state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
        module="RLS MATRIX",
        action="REVOKE_ALL_ORG_FIELD",
        details=f"Rollback em lote executado para o campo organizacional '{org_clean}' no dataset `{project_id}.{raw_ds}`.",
        status="SUCCESS",
    )

    return {
        "status": "SUCCESS",
        "org_field": org_clean,
        "sql_executed": call_sql.strip(),
        "job_meta": meta,
        "affected_records": revoked_rows,
        "total_revoked": len([r for r in revoked_rows if r.get("action") == "REVOKED"]),
    }


def apply_all_tables_by_org_field(
    org_field: str,
    grantees: Optional[str],
    conn: Dict[str, Any],
    state: Dict[str, Any],
) -> Dict[str, Any]:
    """Execute sp_apply_sap_rls to sweep across the dataset and apply RLS to all tables containing the given org_field."""
    client, _ = get_bq_client(conn, state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]
    org_clean = org_field.strip().lower()

    eff_grantees = grantees if grantees is not None else conn.get("default_grantees", "")
    eff_grantees = eff_grantees.strip()
    if eff_grantees and not (eff_grantees.startswith("'") or eff_grantees.startswith('"')):
        eff_grantees = f"'{eff_grantees}'"

    call_sql = f"""
    CALL `{project_id}.{gov_ds}.sp_apply_sap_rls`(
      '{project_id}',
      '{raw_ds}',
      '{org_clean}',
      "{eff_grantees}"
    );
    """
    rows, meta = run_bq_query(client, call_sql)

    # Fetch recently applied tables from sec_rls_audit_log
    audit_check_sql = f"""
    SELECT target_table, policy_name, action, error_message, applied_at
    FROM `{project_id}.{gov_ds}.sec_rls_audit_log`
    WHERE LOWER(org_field) = '{org_clean}'
      AND applied_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 MINUTE)
    ORDER BY applied_at DESC
    LIMIT 100
    """
    try:
        applied_rows, _ = run_bq_query(client, audit_check_sql)
    except Exception:
        applied_rows = []

    append_app_audit(
        actor=state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
        module="RLS MATRIX",
        action="APPLY_ALL_ORG_FIELD",
        details=f"Aplicação massiva de RLS executada para o nível organizacional '{org_clean}' no dataset `{project_id}.{raw_ds}`.",
        status="SUCCESS",
    )

    return {
        "status": "SUCCESS",
        "org_field": org_clean,
        "grantees": eff_grantees,
        "sql_executed": call_sql.strip(),
        "job_meta": meta,
        "affected_records": applied_rows,
        "total_applied": len([r for r in applied_rows if r.get("action") == "APPLIED"]),
    }


def simulate_rls_access(
    simulated_email: str,
    table_name: str,
    org_field: str,
    conn: Dict[str, Any],
    state: Dict[str, Any],
) -> Dict[str, Any]:
    """Simulate the exact Row-Level Security behavior for a target user on a target SAP table."""
    client, _ = get_bq_client(conn, state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]
    email_clean = simulated_email.strip().lower()
    col = org_field.strip().lower()

    sim_sql = f"""
    WITH user_ent AS (
      SELECT
        org_field,
        org_value,
        is_all_access,
        source_roles
      FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
      WHERE LOWER(user_email) = '{email_clean}'
        AND (LOWER(org_field) = '{col}' OR org_field = '*')
    ),
    has_all AS (
      SELECT LOGICAL_OR(is_all_access) AS all_access
      FROM user_ent
    ),
    allowed_vals AS (
      SELECT DISTINCT org_value
      FROM user_ent
      WHERE org_value IS NOT NULL AND NOT STARTS_WITH(org_value, '$')
    ),
    table_totals AS (
      SELECT
        COUNT(*) AS total_rows,
        COUNT(DISTINCT {col}) AS total_org_values,
        ARRAY_AGG(DISTINCT CAST({col} AS STRING) IGNORE NULLS LIMIT 50) AS all_table_org_values
      FROM `{project_id}.{raw_ds}.{table_name}`
    ),
    visible_stats AS (
      SELECT
        COUNT(*) AS visible_rows,
        COUNT(DISTINCT t.{col}) AS visible_org_count,
        ARRAY_AGG(DISTINCT CAST(t.{col} AS STRING) IGNORE NULLS LIMIT 50) AS visible_org_values
      FROM `{project_id}.{raw_ds}.{table_name}` t
      CROSS JOIN has_all ha
      WHERE ha.all_access = TRUE
         OR CAST(t.{col} AS STRING) IN (SELECT org_value FROM allowed_vals)
    )
    SELECT
      tt.total_rows,
      tt.total_org_values,
      tt.all_table_org_values,
      vs.visible_rows,
      vs.visible_org_count,
      vs.visible_org_values,
      COALESCE((SELECT all_access FROM has_all), FALSE) AS has_full_access,
      ARRAY(SELECT org_value FROM allowed_vals) AS entitlement_values
    FROM table_totals tt
    CROSS JOIN visible_stats vs
    """
    rows, meta = run_bq_query(client, sim_sql)
    res = rows[0] if rows else {}

    # Also get sample rows visible to the user
    sample_sql = f"""
    WITH user_ent AS (
      SELECT org_value, is_all_access
      FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`
      WHERE LOWER(user_email) = '{email_clean}'
        AND (LOWER(org_field) = '{col}' OR org_field = '*')
    )
    SELECT *
    FROM `{project_id}.{raw_ds}.{table_name}`
    WHERE TRUE IN (SELECT is_all_access FROM user_ent WHERE is_all_access = TRUE)
       OR CAST({col} AS STRING) IN (SELECT org_value FROM user_ent WHERE org_value IS NOT NULL AND NOT STARTS_WITH(org_value, '$'))
    LIMIT 10
    """
    try:
        sample_rows, _ = run_bq_query(client, sample_sql)
    except Exception:
        sample_rows = []

    return {
        "simulated_email": email_clean,
        "table_name": table_name,
        "org_field": col,
        "summary": res,
        "sample_rows": sample_rows,
        "evaluated_sql": sim_sql.strip(),
        "meta": meta,
    }
