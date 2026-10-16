import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
STATE_FILE = os.path.join(DATA_DIR, "app_state.json")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


DEFAULT_STATE: Dict[str, Any] = {
    "active_connection_id": "conn-copel-s4",
    "connections": [
        {
            "id": "conn-copel-s4",
            "name": "Copel SAP S/4HANA & BigQuery (Ativo)",
            "environment": "PRODUCTION / HOMOLOG",
            "auth_mode": "oauth_adc",  # 'oauth_adc' | 'oauth_token' | 'service_account'
            "project_id": "ce-sap-latam-genai",
            "raw_dataset": "cortex7_sap_s4_raw",
            "governance_dataset": "cortex7_sap_s4_security",
            "location": "US",
            "corporate_domain": "@felipechagas.altostrat.com",
            "default_grantees": "'user:admin@felipechagas.altostrat.com', 'user:fchagas@felipechagas.altostrat.com'",
            "bypass_service_accounts": [
                "%@ce-sap-latam-genai.iam.gserviceaccount.com",
                "%@gcp-data-lake.iam.gserviceaccount.com",
            ],
            "bypass_admins": [
                "admin@felipechagas.altostrat.com",
            ],
            "excluded_table_prefixes": [
                "agr_",
                "usr",
                "adr",
                "dd",
                "t001",
                "sec_",
            ],
            "oauth_client_id": "copel-sap-rls-governance.apps.googleusercontent.com",
            "oauth_user_email": "admin@felipechagas.altostrat.com",
            "service_account_email": None,
            "has_service_account_key": False,
            "last_tested_at": "2026-10-07T04:00:00Z",
            "last_status": "CONNECTED",
        },
        {
            "id": "conn-gcp-datalake-spec",
            "name": "Arquitetura de Referência SDD (sap_governance)",
            "environment": "REFERENCE",
            "auth_mode": "oauth_adc",
            "project_id": "ce-sap-latam-genai",
            "raw_dataset": "cortex7_sap_s4_raw",
            "governance_dataset": "sap_governance",
            "location": "US",
            "corporate_domain": "@copel.com",
            "default_grantees": "'group:gcp-bi-analysts@copel.com', 'group:gcp-sap-consumers@copel.com'",
            "bypass_service_accounts": [
                "%@gcp-data-lake.iam.gserviceaccount.com",
            ],
            "bypass_admins": [
                "admin-governanca@copel.com",
            ],
            "excluded_table_prefixes": [
                "agr_",
                "usr",
                "adr",
                "dd",
                "t001",
                "sec_",
            ],
            "oauth_client_id": "",
            "oauth_user_email": "admin@felipechagas.altostrat.com",
            "service_account_email": None,
            "has_service_account_key": False,
            "last_tested_at": None,
            "last_status": "UNVERIFIED",
        },
    ],
    "service_account_keys": {},
    "oauth_tokens": {},
    "setup_runs": [],
    "custom_group_mappings": [
        {
            "id": "grp-1",
            "principal": "group:gcp-bi-analysts@copel.com",
            "principal_type": "GROUP",
            "description": "Analistas de BI e Controladoria Corporativa",
            "sap_role_binding": "Z_SAP_AUTH_FI",
            "org_field": "bukrs",
            "org_values": ["1010", "1710"],
            "is_all_access": False,
            "updated_at": "2026-10-01T10:00:00Z",
        },
        {
            "id": "grp-2",
            "principal": "group:gcp-sap-executives@copel.com",
            "principal_type": "GROUP",
            "description": "Diretoria Executiva e Auditoria Interna",
            "sap_role_binding": "PROFILE:SAP_ALL",
            "org_field": "*",
            "org_values": ["*"],
            "is_all_access": True,
            "updated_at": "2026-10-01T10:00:00Z",
        },
        {
            "id": "grp-3",
            "principal": "group:gcp-suprimentos-mm@copel.com",
            "principal_type": "GROUP",
            "description": "Equipe de Suprimentos e Logística (MM/SD)",
            "sap_role_binding": "Z_MM_WERKS_SUL",
            "org_field": "werks",
            "org_values": ["1010", "1020", "1710"],
            "is_all_access": False,
            "updated_at": "2026-10-02T14:30:00Z",
        },
    ],
    "app_roles": [
        {
            "id": "SUPER_ADMIN",
            "name": "Super Administrador (Cloud & SAP Security Admin)",
            "description": "Acesso irrestrito à configuração de conexões BigQuery, execução do Setup automatizado, gestão de matrizes RLS e administração de usuários da aplicação.",
            "badge_color": "blue",
            "is_system": True,
            "permissions": {
                "can_manage_connections": True,
                "can_run_setup": True,
                "can_view_roles": True,
                "can_view_matrices": True,
                "can_manage_entitlements": True,
                "can_apply_rls": True,
                "can_revoke_rls": True,
                "can_manage_app_users": True,
            },
        },
        {
            "id": "SECURITY_OPERATOR",
            "name": "Operador de Governança e Segurança SAP",
            "description": "Opera o dia a dia (Day-2): sincroniza entitlements, visualiza roles e matrizes, e aplica/atualiza políticas de RLS nas tabelas.",
            "badge_color": "green",
            "is_system": True,
            "permissions": {
                "can_manage_connections": False,
                "can_run_setup": True,
                "can_view_roles": True,
                "can_view_matrices": True,
                "can_manage_entitlements": True,
                "can_apply_rls": True,
                "can_revoke_rls": False,
                "can_manage_app_users": False,
            },
        },
        {
            "id": "DATA_ENGINEER",
            "name": "Engenheiro de Dados / SRE BigQuery",
            "description": "Configura conexões, executa o setup técnico e monitora clustering/FinOps, sem alterar mapeamentos funcionais de usuários.",
            "badge_color": "amber",
            "is_system": True,
            "permissions": {
                "can_manage_connections": True,
                "can_run_setup": True,
                "can_view_roles": True,
                "can_view_matrices": True,
                "can_manage_entitlements": False,
                "can_apply_rls": True,
                "can_revoke_rls": True,
                "can_manage_app_users": False,
            },
        },
        {
            "id": "COMPLIANCE_AUDITOR",
            "name": "Auditor de Compliance & SOX (Somente Leitura)",
            "description": "Inspeciona todas as roles SAP, matrizes de acesso por usuário/grupo, políticas de RLS ativas e logs de auditoria, sem permissão de escrita.",
            "badge_color": "gray",
            "is_system": True,
            "permissions": {
                "can_manage_connections": False,
                "can_run_setup": False,
                "can_view_roles": True,
                "can_view_matrices": True,
                "can_manage_entitlements": False,
                "can_apply_rls": False,
                "can_revoke_rls": False,
                "can_manage_app_users": False,
            },
        },
    ],
    "app_users": [
        {
            "id": "usr-1",
            "email": "admin@felipechagas.altostrat.com",
            "name": "Felipe Chagas (Cloud Admin)",
            "sap_uname": "SAPADM",
            "department": "Arquitetura Cloud & Dados",
            "role_id": "SUPER_ADMIN",
            "status": "ACTIVE",
            "last_login": "2026-10-07T04:05:00Z",
        },
        {
            "id": "usr-2",
            "email": "fchagas@felipechagas.altostrat.com",
            "name": "Felipe Chagas (Especialista SAP FI)",
            "sap_uname": "SAPFI",
            "department": "Governança SAP / Finanças",
            "role_id": "SECURITY_OPERATOR",
            "status": "ACTIVE",
            "last_login": "2026-10-06T18:20:00Z",
        },
        {
            "id": "usr-3",
            "email": "engenharia.dados@copel.com",
            "name": "Time Engenharia de Dados Copel",
            "sap_uname": "BTC_DATA",
            "department": "Engenharia de Plataforma",
            "role_id": "DATA_ENGINEER",
            "status": "ACTIVE",
            "last_login": "2026-10-06T15:10:00Z",
        },
        {
            "id": "usr-4",
            "email": "auditoria.sox@copel.com",
            "name": "Auditoria Interna & Compliance SOX",
            "sap_uname": "AUDITOR01",
            "department": "Riscos e Compliance",
            "role_id": "COMPLIANCE_AUDITOR",
            "status": "ACTIVE",
            "last_login": "2026-10-05T11:45:00Z",
        },
    ],
    "current_app_user_email": "admin@felipechagas.altostrat.com",
    "app_settings": {
        "auto_refresh_schedule": "0 * * * *",
        "auto_refresh_enabled": True,
        "enforce_clustering_check": True,
        "sanitize_dollar_vars": True,
        "require_approval_for_revoke": False,
        "audit_retention_days": 365,
    },
    "app_audit_logs": [
        {
            "id": "aud-101",
            "timestamp": "2026-10-07T03:55:00Z",
            "actor": "admin@felipechagas.altostrat.com",
            "module": "CONEXÕES",
            "action": "CONNECTION_VERIFIED",
            "details": "Conexão validada com ce-sap-latam-genai (datasets cortex7_sap_s4_raw e cortex7_sap_s4_security) via OAuth ADC.",
            "status": "SUCCESS",
        },
        {
            "id": "aud-102",
            "timestamp": "2026-09-28T14:10:28Z",
            "actor": "admin@felipechagas.altostrat.com",
            "module": "SETUP & ENTITLEMENTS",
            "action": "REFRESH_ENTITLEMENTS",
            "details": "Procedure sp_refresh_sap_entitlements executada em cortex7_sap_s4_security.",
            "status": "SUCCESS",
        },
        {
            "id": "aud-103",
            "timestamp": "2026-09-24T23:52:49Z",
            "actor": "admin@felipechagas.altostrat.com",
            "module": "RLS MATRIX",
            "action": "BATCH_APPLY_RLS",
            "details": "Aplicação em lote de Row Access Policies (bukrs) no dataset cortex7_sap_s4_raw.",
            "status": "SUCCESS",
        },
    ],
}


_MEMORY_STATE: Optional[Dict[str, Any]] = None
_BQ_SYNC_LOCK = None


def _get_lock():
    global _BQ_SYNC_LOCK
    if _BQ_SYNC_LOCK is None:
        import threading
        _BQ_SYNC_LOCK = threading.Lock()
    return _BQ_SYNC_LOCK


def _resolve_bq_target(state: Optional[Dict[str, Any]] = None) -> tuple[str, str, str]:
    """Resolve (project_id, governance_dataset, location) from env vars or active connection."""
    project_id = os.environ.get("BQ_PROJECT_ID", "").strip()
    gov_ds = os.environ.get("BQ_GOVERNANCE_DATASET", "").strip()
    location = os.environ.get("BQ_LOCATION", "US").strip()
    if state:
        conn = get_active_connection(state)
        project_id = project_id or conn.get("project_id", "ce-sap-latam-genai")
        gov_ds = gov_ds or conn.get("governance_dataset", "cortex7_sap_s4_security")
        location = location or conn.get("location", "US")
    else:
        project_id = project_id or "ce-sap-latam-genai"
        gov_ds = gov_ds or "cortex7_sap_s4_security"
    return project_id, gov_ds, location


def ensure_bq_app_tables(project_id: str, gov_ds: str, location: str = "US") -> None:
    """Ensure app_governance_state and app_audit_log tables exist in the BigQuery governance dataset."""
    from google.cloud import bigquery

    client = bigquery.Client(project=project_id, location=location)
    ddl_state = f"""
    CREATE SCHEMA IF NOT EXISTS `{project_id}.{gov_ds}`;
    CREATE TABLE IF NOT EXISTS `{project_id}.{gov_ds}.app_governance_state` (
      state_key STRING NOT NULL OPTIONS(description="Chave única do estado da aplicação (GLOBAL_APP_STATE)"),
      state_json STRING NOT NULL OPTIONS(description="Documento JSON com conexões, RBAC, grupos e configurações"),
      updated_by STRING OPTIONS(description="Operador que realizou a última alteração"),
      updated_at TIMESTAMP NOT NULL OPTIONS(description="Timestamp UTC da última gravação")
    )
    OPTIONS(description="Estado operacional persistente do Console Copel SAP-BQ RLS no Cloud Run");

    CREATE TABLE IF NOT EXISTS `{project_id}.{gov_ds}.app_audit_log` (
      audit_id STRING NOT NULL,
      event_ts TIMESTAMP NOT NULL,
      actor STRING NOT NULL,
      module STRING NOT NULL,
      action STRING NOT NULL,
      details STRING,
      status STRING NOT NULL
    )
    PARTITION BY DATE(event_ts)
    CLUSTER BY module, action
    OPTIONS(description="Trilha de auditoria administrativa da aplicação (SOX & Compliance)");
    """
    client.query(ddl_state).result(timeout=30)


def sync_state_to_bigquery(state: Dict[str, Any]) -> Dict[str, Any]:
    """Persist the current application state JSON into BigQuery `{project}.{gov_ds}.app_governance_state`."""
    from google.cloud import bigquery

    project_id, gov_ds, location = _resolve_bq_target(state)
    with _get_lock():
        ensure_bq_app_tables(project_id, gov_ds, location)
        client = bigquery.Client(project=project_id, location=location)

        # Strip raw private keys before persisting in BigQuery table if desired, keeping metadata intact
        sanitized = json.loads(json.dumps(state))
        sanitized["service_account_keys"] = {}
        sanitized["oauth_tokens"] = {}
        payload_str = json.dumps(sanitized, ensure_ascii=False)
        actor = sanitized.get("current_app_user_email", "admin@felipechagas.altostrat.com")

        merge_sql = f"""
        MERGE `{project_id}.{gov_ds}.app_governance_state` T
        USING (
          SELECT
            'GLOBAL_APP_STATE' AS state_key,
            @state_json AS state_json,
            @updated_by AS updated_by,
            CURRENT_TIMESTAMP() AS updated_at
        ) S
        ON T.state_key = S.state_key
        WHEN MATCHED THEN
          UPDATE SET
            state_json = S.state_json,
            updated_by = S.updated_by,
            updated_at = S.updated_at
        WHEN NOT MATCHED THEN
          INSERT (state_key, state_json, updated_by, updated_at)
          VALUES (S.state_key, S.state_json, S.updated_by, S.updated_at)
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("state_json", "STRING", payload_str),
                bigquery.ScalarQueryParameter("updated_by", "STRING", actor),
            ]
        )
        client.query(merge_sql, job_config=job_config).result(timeout=30)
        return {
            "status": "SYNCED",
            "target_table": f"{project_id}.{gov_ds}.app_governance_state",
            "synced_at": now_iso(),
        }


def _insert_audit_to_bigquery(entry: Dict[str, Any], state: Dict[str, Any]) -> None:
    """Append an administrative audit entry into `{project}.{gov_ds}.app_audit_log`."""
    try:
        from google.cloud import bigquery

        project_id, gov_ds, location = _resolve_bq_target(state)
        client = bigquery.Client(project=project_id, location=location)
        insert_sql = f"""
        INSERT INTO `{project_id}.{gov_ds}.app_audit_log`
          (audit_id, event_ts, actor, module, action, details, status)
        VALUES
          (@audit_id, CURRENT_TIMESTAMP(), @actor, @module, @action, @details, @status)
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("audit_id", "STRING", entry["id"]),
                bigquery.ScalarQueryParameter("actor", "STRING", entry["actor"]),
                bigquery.ScalarQueryParameter("module", "STRING", entry["module"]),
                bigquery.ScalarQueryParameter("action", "STRING", entry["action"]),
                bigquery.ScalarQueryParameter("details", "STRING", entry["details"]),
                bigquery.ScalarQueryParameter("status", "STRING", entry["status"]),
            ]
        )
        client.query(insert_sql, job_config=job_config).result(timeout=20)
    except Exception:
        pass


def load_state_from_bigquery() -> Optional[Dict[str, Any]]:
    """Load persisted state JSON from `{project}.{gov_ds}.app_governance_state` on Cloud Run cold start."""
    try:
        from google.cloud import bigquery

        project_id, gov_ds, location = _resolve_bq_target(None)
        client = bigquery.Client(project=project_id, location=location)
        sql = f"""
        SELECT state_json
        FROM `{project_id}.{gov_ds}.app_governance_state`
        WHERE state_key = 'GLOBAL_APP_STATE'
        ORDER BY updated_at DESC
        LIMIT 1
        """
        rows = list(client.query(sql).result(timeout=15))
        if rows and rows[0].get("state_json"):
            data = json.loads(rows[0]["state_json"])
            for k, v in DEFAULT_STATE.items():
                if k not in data:
                    data[k] = v
            return data
    except Exception:
        return None
    return None


def load_state() -> Dict[str, Any]:
    global _MEMORY_STATE
    if _MEMORY_STATE is not None:
        return _MEMORY_STATE

    os.makedirs(DATA_DIR, exist_ok=True)

    # On Cloud Run (K_SERVICE set) or when BQ_BOOTSTRAP_ON_START=true, try hydrating from BigQuery first
    if os.environ.get("K_SERVICE") or os.environ.get("BQ_BOOTSTRAP_ON_START", "").lower() == "true":
        bq_state = load_state_from_bigquery()
        if bq_state:
            _MEMORY_STATE = bq_state
            try:
                with open(STATE_FILE, "w", encoding="utf-8") as f:
                    json.dump(bq_state, f, indent=2, ensure_ascii=False)
            except Exception:
                pass
            return _MEMORY_STATE

    if not os.path.exists(STATE_FILE):
        _MEMORY_STATE = json.loads(json.dumps(DEFAULT_STATE))
        save_state(_MEMORY_STATE)
        return _MEMORY_STATE
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        for k, v in DEFAULT_STATE.items():
            if k not in data:
                data[k] = v
        _MEMORY_STATE = data
        return _MEMORY_STATE
    except Exception:
        _MEMORY_STATE = json.loads(json.dumps(DEFAULT_STATE))
        return _MEMORY_STATE


def save_state(state: Dict[str, Any], sync_bq: bool = True) -> None:
    global _MEMORY_STATE
    _MEMORY_STATE = state
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)

    # Async background persistence to BigQuery governance dataset when enabled
    if sync_bq and os.environ.get("BQ_STATE_SYNC", "true").lower() != "false":
        import threading

        snapshot = json.loads(json.dumps(state))
        threading.Thread(
            target=lambda: _safe_sync_state_to_bq(snapshot),
            daemon=True,
        ).start()


def _safe_sync_state_to_bq(snapshot: Dict[str, Any]) -> None:
    try:
        sync_state_to_bigquery(snapshot)
    except Exception:
        pass


def append_app_audit(
    actor: str, module: str, action: str, details: str, status: str = "SUCCESS"
) -> Dict[str, Any]:
    state = load_state()
    entry = {
        "id": f"aud-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        "timestamp": now_iso(),
        "actor": actor or state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
        "module": module,
        "action": action,
        "details": details,
        "status": status,
    }
    state.setdefault("app_audit_logs", []).insert(0, entry)
    state["app_audit_logs"] = state["app_audit_logs"][:200]
    save_state(state, sync_bq=True)

    if os.environ.get("BQ_STATE_SYNC", "true").lower() != "false":
        import threading

        snapshot = json.loads(json.dumps(state))
        threading.Thread(
            target=lambda: _insert_audit_to_bigquery(entry, snapshot),
            daemon=True,
        ).start()

    return entry


def get_active_connection(state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if state is None:
        state = load_state()
    active_id = state.get("active_connection_id")
    for conn in state.get("connections", []):
        if conn["id"] == active_id:
            return conn
    return state["connections"][0]
