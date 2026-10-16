import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from bq_service import (
    build_setup_steps,
    execute_setup_step,
    apply_all_tables_by_org_field,
    get_access_matrix,
    get_bq_client,
    get_rls_table_matrix,
    get_sap_roles_catalog,
    manage_single_table_rls,
    revoke_all_tables_by_org_field,
    run_bq_query,
    simulate_rls_access,
    test_connection_and_prerequisites,
)
from state_store import (
    append_app_audit,
    get_active_connection,
    load_state,
    now_iso,
    save_state,
)

app = FastAPI(
    title="Copel SAP to BigQuery RLS Governance Hub API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_current_rbac_context(state: Dict[str, Any]) -> Dict[str, Any]:
    curr_email = state.get("current_app_user_email", "admin@felipechagas.altostrat.com")
    users = state.get("app_users", [])
    roles = {r["id"]: r for r in state.get("app_roles", [])}
    user_obj = next((u for u in users if u["email"].lower() == curr_email.lower()), None)
    if not user_obj and users:
        user_obj = users[0]
    role_obj = roles.get(user_obj["role_id"]) if user_obj else None
    return {
        "user": user_obj,
        "role": role_obj,
        "permissions": role_obj["permissions"] if role_obj else {},
    }


@app.get("/api/context")
def api_get_context():
    state = load_state()
    conn = get_active_connection(state)
    rbac = get_current_rbac_context(state)
    return {
        "active_connection": conn,
        "connections": state.get("connections", []),
        "rbac": rbac,
        "app_users": state.get("app_users", []),
        "app_roles": state.get("app_roles", []),
        "app_settings": state.get("app_settings", {}),
    }


# =====================================================================
# MODULE 1: BIGQUERY CONNECTIONS (OAUTH 2.0 / ADC / SERVICE ACCOUNT)
# =====================================================================


class ConnectionPayload(BaseModel):
    id: Optional[str] = None
    name: str
    environment: str = "PRODUCTION"
    auth_mode: str = "oauth_adc"  # 'oauth_adc' | 'oauth_token' | 'service_account'
    project_id: str
    raw_dataset: str
    governance_dataset: str
    location: str = "US"
    corporate_domain: str = "@copel.com"
    default_grantees: str = "'user:admin@felipechagas.altostrat.com'"
    bypass_service_accounts: List[str] = []
    bypass_admins: List[str] = []
    oauth_client_id: Optional[str] = ""
    oauth_user_email: Optional[str] = ""
    oauth_access_token: Optional[str] = None
    service_account_json: Optional[str] = None


@app.get("/api/connections")
def api_list_connections():
    state = load_state()
    return {
        "active_connection_id": state.get("active_connection_id"),
        "connections": state.get("connections", []),
    }


@app.post("/api/connections")
def api_save_connection(payload: ConnectionPayload):
    state = load_state()
    conn_id = payload.id or f"conn-{uuid.uuid4().hex[:8]}"
    existing_idx = next(
        (i for i, c in enumerate(state.get("connections", [])) if c["id"] == conn_id),
        None,
    )

    sa_email = None
    has_sa = conn_id in state.get("service_account_keys", {})
    if payload.service_account_json and payload.service_account_json.strip():
        try:
            sa_info = json.loads(payload.service_account_json)
            if "client_email" not in sa_info or "private_key" not in sa_info:
                raise ValueError("JSON de Service Account inválido: campos 'client_email' e 'private_key' são obrigatórios.")
            state.setdefault("service_account_keys", {})[conn_id] = sa_info
            sa_email = sa_info.get("client_email")
            has_sa = True
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Erro ao validar JSON da Service Account: {str(e)}")

    if payload.oauth_access_token and payload.oauth_access_token.strip():
        state.setdefault("oauth_tokens", {})[conn_id] = payload.oauth_access_token.strip()

    conn_obj = {
        "id": conn_id,
        "name": payload.name,
        "environment": payload.environment,
        "auth_mode": payload.auth_mode,
        "project_id": payload.project_id.strip(),
        "raw_dataset": payload.raw_dataset.strip(),
        "governance_dataset": payload.governance_dataset.strip(),
        "location": payload.location.strip() or "US",
        "corporate_domain": payload.corporate_domain.strip(),
        "default_grantees": payload.default_grantees.strip(),
        "bypass_service_accounts": payload.bypass_service_accounts,
        "bypass_admins": payload.bypass_admins,
        "oauth_client_id": payload.oauth_client_id or "",
        "oauth_user_email": payload.oauth_user_email or "admin@felipechagas.altostrat.com",
        "service_account_email": sa_email or (
            state["connections"][existing_idx].get("service_account_email") if existing_idx is not None else None
        ),
        "has_service_account_key": has_sa,
        "last_tested_at": now_iso(),
        "last_status": "CONFIGURED",
    }

    if existing_idx is not None:
        state["connections"][existing_idx] = conn_obj
    else:
        state.setdefault("connections", []).append(conn_obj)

    state["active_connection_id"] = conn_id
    save_state(state)
    append_app_audit(
        actor=state.get("current_app_user_email", ""),
        module="CONEXÕES",
        action="SAVE_CONNECTION",
        details=f"Conexão '{conn_obj['name']}' ({conn_obj['auth_mode']}) salva para projeto {conn_obj['project_id']}.",
    )
    return {"connection": conn_obj, "active_connection_id": conn_id}


@app.post("/api/connections/{conn_id}/activate")
def api_activate_connection(conn_id: str):
    state = load_state()
    conn = next((c for c in state.get("connections", []) if c["id"] == conn_id), None)
    if not conn:
        raise HTTPException(status_code=404, detail="Conexão não encontrada.")
    state["active_connection_id"] = conn_id
    save_state(state)
    append_app_audit(
        actor=state.get("current_app_user_email", ""),
        module="CONEXÕES",
        action="ACTIVATE_CONNECTION",
        details=f"Conexão ativa alterada para '{conn['name']}' ({conn['project_id']}.{conn['governance_dataset']}).",
    )
    return {"active_connection": conn}


@app.delete("/api/connections/{conn_id}")
def api_delete_connection(conn_id: str):
    state = load_state()
    conns = state.get("connections", [])
    conn = next((c for c in conns if c["id"] == conn_id), None)
    if not conn:
        raise HTTPException(status_code=404, detail="Conexão não encontrada.")
    if len(conns) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Não é possível excluir a única conexão restante. Mantenha pelo menos um perfil de conexão ativo.",
        )

    state["connections"] = [c for c in conns if c["id"] != conn_id]
    state.get("service_account_keys", {}).pop(conn_id, None)
    state.get("oauth_tokens", {}).pop(conn_id, None)

    if state.get("active_connection_id") == conn_id:
        state["active_connection_id"] = state["connections"][0]["id"]

    save_state(state)
    append_app_audit(
        actor=state.get("current_app_user_email", ""),
        module="CONEXÕES",
        action="DELETE_CONNECTION",
        details=f"Conexão '{conn['name']}' ({conn['project_id']}.{conn['governance_dataset']}) excluída.",
    )
    return {
        "deleted_id": conn_id,
        "active_connection_id": state["active_connection_id"],
        "connections": state["connections"],
    }


@app.post("/api/connections/{conn_id}/test")
def api_test_connection(conn_id: str):
    state = load_state()
    conn_idx = next((i for i, c in enumerate(state.get("connections", [])) if c["id"] == conn_id), None)
    if conn_idx is None:
        raise HTTPException(status_code=404, detail="Conexão não encontrada.")
    conn = state["connections"][conn_idx]
    try:
        diag = test_connection_and_prerequisites(conn, state)
        state["connections"][conn_idx]["last_tested_at"] = diag["tested_at"]
        state["connections"][conn_idx]["last_status"] = "CONNECTED"
        save_state(state)
        append_app_audit(
            actor=state.get("current_app_user_email", ""),
            module="CONEXÕES",
            action="TEST_CONNECTION",
            details=f"Diagnóstico BigQuery concluído com sucesso em {conn['project_id']} ({diag['auth_identity']}).",
            status="SUCCESS",
        )
        return diag
    except Exception as exc:
        state["connections"][conn_idx]["last_tested_at"] = now_iso()
        state["connections"][conn_idx]["last_status"] = "FAILED"
        save_state(state)
        append_app_audit(
            actor=state.get("current_app_user_email", ""),
            module="CONEXÕES",
            action="TEST_CONNECTION",
            details=f"Falha ao testar conexão '{conn['name']}': {str(exc)}",
            status="FAILED",
        )
        raise HTTPException(status_code=400, detail=str(exc))


# =====================================================================
# MODULE 2: AUTOMATED SETUP & EXECUTION LOGS
# =====================================================================


class ExecuteStepRequest(BaseModel):
    custom_sql: Optional[str] = None
    pilot_only: bool = True


@app.get("/api/setup/steps")
def api_get_setup_steps():
    state = load_state()
    conn = get_active_connection(state)
    steps = build_setup_steps(conn)
    runs = state.get("setup_runs", [])

    # Attach latest run status to each step
    latest_by_step = {}
    for r in runs:
        sid = r.get("step_id")
        if sid and sid not in latest_by_step:
            latest_by_step[sid] = r

    for s in steps:
        last_run = latest_by_step.get(s["id"])
        s["last_run"] = last_run
        s["status"] = last_run["status"] if last_run else "READY"

    return {
        "connection": conn,
        "steps": steps,
        "setup_runs": runs[:50],
    }


@app.post("/api/setup/execute/{step_id}")
def api_execute_setup_step(step_id: str, req: ExecuteStepRequest):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_run_setup", False):
        raise HTTPException(
            status_code=403,
            detail="Permissão negada: Seu perfil atual não possui permissão 'can_run_setup' para executar o Setup no BigQuery.",
        )
    conn = get_active_connection(state)
    run_record = execute_setup_step(
        step_id=step_id,
        conn=conn,
        state=state,
        custom_sql=req.custom_sql,
        pilot_only=req.pilot_only,
    )
    return run_record


@app.post("/api/setup/execute-all")
def api_execute_all_setup_steps(req: ExecuteStepRequest):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_run_setup", False):
        raise HTTPException(
            status_code=403,
            detail="Permissão negada: Seu perfil atual não possui permissão 'can_run_setup'.",
        )
    conn = get_active_connection(state)
    steps = build_setup_steps(conn)
    results = []
    for s in steps:
        res = execute_setup_step(
            step_id=s["id"],
            conn=conn,
            state=state,
            pilot_only=req.pilot_only,
        )
        results.append(res)
        if res["status"] == "FAILED":
            break
    return {"results": results}


# =====================================================================
# MODULE 3: PROFILE ADMINISTRATION (ROLES, ACCESS MATRIX, RLS MATRIX)
# =====================================================================


@app.get("/api/profiles/roles")
def api_get_sap_roles():
    state = load_state()
    conn = get_active_connection(state)
    try:
        return get_sap_roles_catalog(conn, state)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/profiles/access-matrix")
def api_get_access_matrix():
    state = load_state()
    conn = get_active_connection(state)
    try:
        return get_access_matrix(conn, state)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class GroupMappingRequest(BaseModel):
    principal: str
    principal_type: str = "GROUP"
    description: str = ""
    sap_role_binding: str
    org_field: str
    org_values: List[str]
    is_all_access: bool = False
    sync_to_bigquery: bool = True


@app.post("/api/profiles/group-mappings")
def api_add_group_mapping(req: GroupMappingRequest):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_manage_entitlements", False):
        raise HTTPException(
            status_code=403,
            detail="Permissão negada: Seu perfil não possui permissão para gerenciar entitlements.",
        )
    conn = get_active_connection(state)

    new_item = {
        "id": f"grp-{uuid.uuid4().hex[:6]}",
        "principal": req.principal.strip().lower(),
        "principal_type": req.principal_type,
        "description": req.description,
        "sap_role_binding": req.sap_role_binding.strip(),
        "org_field": req.org_field.strip().lower(),
        "org_values": [v.strip() for v in req.org_values if v.strip()],
        "is_all_access": req.is_all_access,
        "updated_at": now_iso(),
    }
    state.setdefault("custom_group_mappings", []).insert(0, new_item)
    save_state(state)

    bq_synced = False
    if req.sync_to_bigquery:
        try:
            client, _ = get_bq_client(conn, state)
            project_id = conn["project_id"]
            gov_ds = conn["governance_dataset"]
            clean_email = req.principal.replace("group:", "").replace("user:", "").strip().lower()
            vals = req.org_values if not req.is_all_access else ["*"]
            for val in vals:
                org_val_sql = "NULL" if (req.is_all_access or val == "*") else f"'{val}'"
                insert_sql = f"""
                INSERT INTO `{project_id}.{gov_ds}.sec_user_org_entitlements`
                (user_email, sap_uname, org_field, org_value, val_low, val_high, is_all_access, source_roles, updated_at)
                VALUES
                ('{clean_email}', 'IAM_{req.principal_type}', '{req.org_field.lower()}', {org_val_sql}, '{val}', NULL, {str(req.is_all_access).upper()}, ['{req.sap_role_binding}'], CURRENT_TIMESTAMP())
                """
                run_bq_query(client, insert_sql)
            bq_synced = True
        except Exception:
            bq_synced = False

    append_app_audit(
        actor=state.get("current_app_user_email", ""),
        module="ACCESS MATRIX",
        action="ADD_ENTITLEMENT_MAPPING",
        details=f"Concessão adicionada para {req.principal} ({req.org_field}: {', '.join(req.org_values)}) | Sync BQ: {bq_synced}",
    )
    return {"mapping": new_item, "bq_synced": bq_synced}


@app.delete("/api/profiles/group-mappings/{mapping_id}")
def api_delete_group_mapping(mapping_id: str):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_manage_entitlements", False):
        raise HTTPException(status_code=403, detail="Permissão negada.")
    state["custom_group_mappings"] = [
        m for m in state.get("custom_group_mappings", []) if m["id"] != mapping_id
    ]
    save_state(state)
    return {"status": "DELETED"}


@app.get("/api/profiles/rls-matrix")
def api_get_rls_matrix():
    state = load_state()
    conn = get_active_connection(state)
    try:
        return get_rls_table_matrix(conn, state)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class TableRlsActionRequest(BaseModel):
    action: str  # 'APPLY' | 'REVOKE'
    table_name: str
    org_field: str = "bukrs"
    grantees: Optional[str] = None


@app.post("/api/profiles/rls-matrix/action")
def api_table_rls_action(req: TableRlsActionRequest):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if req.action.upper() == "APPLY" and not rbac["permissions"].get("can_apply_rls", False):
        raise HTTPException(
            status_code=403,
            detail="Permissão negada: Seu perfil não possui permissão 'can_apply_rls'.",
        )
    if req.action.upper() == "REVOKE" and not rbac["permissions"].get("can_revoke_rls", False):
        raise HTTPException(
            status_code=403,
            detail="Permissão negada: Seu perfil não possui permissão 'can_revoke_rls' para revogar políticas.",
        )
    conn = get_active_connection(state)
    try:
        return manage_single_table_rls(
            action=req.action,
            table_name=req.table_name,
            org_field=req.org_field,
            grantees=req.grantees,
            conn=conn,
            state=state,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class ApplyAllOrgFieldRequest(BaseModel):
    org_field: str = "bukrs"
    grantees: Optional[str] = None


@app.post("/api/profiles/rls-matrix/apply-all")
def api_apply_all_org_field(req: ApplyAllOrgFieldRequest):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_apply_rls", False):
        raise HTTPException(
            status_code=403,
            detail="Permissão negada: Seu perfil não possui permissão 'can_apply_rls' para aplicar políticas em lote.",
        )
    conn = get_active_connection(state)
    try:
        return apply_all_tables_by_org_field(
            org_field=req.org_field,
            grantees=req.grantees,
            conn=conn,
            state=state,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class RevokeAllOrgFieldRequest(BaseModel):
    org_field: str = "bukrs"


@app.post("/api/profiles/rls-matrix/revoke-all")
def api_revoke_all_org_field(req: RevokeAllOrgFieldRequest):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_revoke_rls", False):
        raise HTTPException(
            status_code=403,
            detail="Permissão negada: Seu perfil não possui permissão 'can_revoke_rls' para revogar políticas em lote.",
        )
    conn = get_active_connection(state)
    try:
        return revoke_all_tables_by_org_field(
            org_field=req.org_field,
            conn=conn,
            state=state,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# =====================================================================
# MODULE 4: APPLICATION ADMINISTRATION & RBAC
# =====================================================================


@app.get("/api/admin/state")
def api_get_admin_state():
    state = load_state()
    return {
        "rbac": get_current_rbac_context(state),
        "app_roles": state.get("app_roles", []),
        "app_users": state.get("app_users", []),
        "app_settings": state.get("app_settings", {}),
        "app_audit_logs": state.get("app_audit_logs", []),
    }


class SwitchUserRequest(BaseModel):
    email: str


@app.post("/api/admin/switch-user")
def api_switch_app_user(req: SwitchUserRequest):
    state = load_state()
    user = next((u for u in state.get("app_users", []) if u["email"].lower() == req.email.lower()), None)
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    state["current_app_user_email"] = user["email"]
    user["last_login"] = now_iso()
    save_state(state)
    append_app_audit(
        actor=user["email"],
        module="APP ADMIN",
        action="SWITCH_ACTIVE_USER",
        details=f"Sessão da aplicação alternada para {user['name']} ({user['email']}) com perfil {user['role_id']}.",
    )
    return get_current_rbac_context(state)


class AppUserPayload(BaseModel):
    id: Optional[str] = None
    email: str
    name: str
    sap_uname: str = ""
    department: str = ""
    role_id: str
    status: str = "ACTIVE"


@app.post("/api/admin/users")
def api_save_app_user(payload: AppUserPayload):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_manage_app_users", False):
        raise HTTPException(
            status_code=403,
            detail="Permissão negada: Apenas administradores da aplicação ('can_manage_app_users') podem gerenciar usuários.",
        )

    uid = payload.id or f"usr-{uuid.uuid4().hex[:6]}"
    existing_idx = next(
        (i for i, u in enumerate(state.get("app_users", [])) if u["id"] == uid or u["email"].lower() == payload.email.lower()),
        None,
    )
    user_obj = {
        "id": uid,
        "email": payload.email.strip().lower(),
        "name": payload.name.strip(),
        "sap_uname": payload.sap_uname.strip().upper(),
        "department": payload.department.strip(),
        "role_id": payload.role_id,
        "status": payload.status,
        "last_login": now_iso(),
    }
    if existing_idx is not None:
        state["app_users"][existing_idx] = user_obj
    else:
        state.setdefault("app_users", []).append(user_obj)

    save_state(state)
    append_app_audit(
        actor=state.get("current_app_user_email", ""),
        module="APP ADMIN",
        action="SAVE_APP_USER",
        details=f"Usuário da aplicação '{user_obj['email']}' atribuído ao perfil '{user_obj['role_id']}'.",
    )
    return {"user": user_obj, "app_users": state["app_users"]}


@app.delete("/api/admin/users/{user_id}")
def api_delete_app_user(user_id: str):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_manage_app_users", False):
        raise HTTPException(status_code=403, detail="Permissão negada.")
    state["app_users"] = [u for u in state.get("app_users", []) if u["id"] != user_id]
    save_state(state)
    return {"app_users": state["app_users"]}


class RolePermissionsUpdate(BaseModel):
    role_id: str
    permissions: Dict[str, bool]


@app.post("/api/admin/roles/permissions")
def api_update_role_permissions(req: RolePermissionsUpdate):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_manage_app_users", False):
        raise HTTPException(status_code=403, detail="Permissão negada.")

    for r in state.get("app_roles", []):
        if r["id"] == req.role_id:
            r["permissions"].update(req.permissions)
            break
    save_state(state)
    append_app_audit(
        actor=state.get("current_app_user_email", ""),
        module="APP ADMIN",
        action="UPDATE_ROLE_PERMISSIONS",
        details=f"Matriz de permissões da role '{req.role_id}' atualizada.",
    )
    return {"app_roles": state["app_roles"], "rbac": get_current_rbac_context(state)}


@app.post("/api/admin/settings")
def api_update_app_settings(settings: Dict[str, Any]):
    state = load_state()
    rbac = get_current_rbac_context(state)
    if not rbac["permissions"].get("can_manage_app_users", False):
        raise HTTPException(status_code=403, detail="Permissão negada.")
    state.setdefault("app_settings", {}).update(settings)
    save_state(state)
    append_app_audit(
        actor=state.get("current_app_user_email", ""),
        module="APP ADMIN",
        action="UPDATE_SETTINGS",
        details="Configurações globais de governança da aplicação atualizadas.",
    )
    return {"app_settings": state["app_settings"]}


# =====================================================================
# MODULE 5: RLS ACCESS SIMULATOR ("TEST AS USER")
# =====================================================================


class SimulateRequest(BaseModel):
    user_email: str
    table_name: str = "bkpf"
    org_field: str = "bukrs"


@app.post("/api/simulator/run")
def api_run_simulator(req: SimulateRequest):
    state = load_state()
    conn = get_active_connection(state)
    try:
        res = simulate_rls_access(
            simulated_email=req.user_email,
            table_name=req.table_name,
            org_field=req.org_field,
            conn=conn,
            state=state,
        )
        append_app_audit(
            actor=state.get("current_app_user_email", ""),
            module="SIMULADOR RLS",
            action="SIMULATE_USER_ACCESS",
            details=f"Simulação executada para '{req.user_email}' na tabela '{req.table_name}' ({req.org_field}).",
        )
        return res
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# =====================================================================
# MODULE 6: GEMINI DATA ANALYTICS CHAT INTERFACE (SSE STREAMING)
# =====================================================================

import os
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from chat_service import stream_gemini_data_chat
from state_store import sync_state_to_bigquery


class ChatRequestModel(BaseModel):
    message: str
    history: List[Dict[str, Any]] = []


@app.post("/api/chat")
async def api_chat(request: ChatRequestModel):
    """Stream Gemini Data Analytics thoughts, final markdown response, and follow-up suggestions via SSE."""
    return StreamingResponse(
        stream_gemini_data_chat(request.message, request.history),
        media_type="text/event-stream",
    )


@app.post("/api/admin/sync-bq")
def api_sync_state_to_bq():
    """Explicitly persist application state to BigQuery governance dataset (`app_governance_state`)."""
    state = load_state()
    try:
        res = sync_state_to_bigquery(state)
        append_app_audit(
            actor=state.get("current_app_user_email", ""),
            module="APP ADMIN",
            action="SYNC_BQ_STATE",
            details=f"Estado da aplicação sincronizado no BigQuery ({res['target_table']}).",
        )
        return res
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Falha ao sincronizar estado no BigQuery: {str(exc)}")


# Serve built React SPA (`frontend/dist`) in production / Cloud Run
FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.isdir(FRONTEND_DIST):
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        candidate = os.path.join(FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)

