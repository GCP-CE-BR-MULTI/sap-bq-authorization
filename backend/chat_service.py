import json
import time
from typing import Any, Dict, Generator, List

from state_store import append_app_audit, get_active_connection, load_state
from bq_service import get_bq_client, run_bq_query

try:
    from google.cloud import geminidataanalytics_v1beta as gemini
    HAS_GEMINI_DATA_ANALYTICS = True
except Exception:
    gemini = None
    HAS_GEMINI_DATA_ANALYTICS = False


def sse_event(evt_type: str, content: str) -> str:
    return f"data: {json.dumps({'type': evt_type, 'content': content}, ensure_ascii=False)}\n\n"


def build_bq_table_references(project_id: str, raw_ds: str, gov_ds: str) -> List[Dict[str, str]]:
    return [
        {"project_id": project_id, "dataset_id": gov_ds, "table_id": "sec_user_org_entitlements"},
        {"project_id": project_id, "dataset_id": gov_ds, "table_id": "sec_rls_audit_log"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "usr02"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "usr21"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "adr6"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "agr_users"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "agr_agrs"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "agr_1251"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "agr_1252"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "ust04"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "t001"},
        {"project_id": project_id, "dataset_id": raw_ds, "table_id": "bkpf"},
    ]


def stream_live_bq_governance_fallback(
    message: str,
    history: List[Dict[str, Any]],
    conn: Dict[str, Any],
    state: Dict[str, Any],
    initial_note: str = "",
) -> Generator[str, None, None]:
    """Stream real-time THOUGHT, FINAL_RESPONSE, and SUGGESTION chunks backed by live BigQuery queries."""
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]
    q_lower = message.lower()

    if initial_note:
        yield sse_event("THOUGHT", initial_note)

    yield sse_event(
        "THOUGHT",
        f"Analisando contexto da pergunta e histórico ({len(history)} mensagens anteriores) no projeto `{project_id}`...",
    )
    time.sleep(0.15)

    client, auth_identity = get_bq_client(conn, state)
    yield sse_event(
        "THOUGHT",
        f"Conectado ao BigQuery via `{auth_identity}` (Datasets: `{gov_ds}` e `{raw_ds}`).",
    )

    # Determine intent & run targeted live BigQuery queries
    if any(k in q_lower for k in ["rls", "política", "politica", "tabela", "protegid", "audit", "drift", "cluster"]):
        yield sse_event(
            "THOUGHT",
            f"Consultando `{project_id}.{gov_ds}.sec_rls_audit_log` e `{raw_ds}.INFORMATION_SCHEMA.COLUMNS` para verificar políticas RLS e status de clustering...",
        )
        sql = f"""
        WITH latest_audit AS (
          SELECT target_table, LOWER(org_field) AS org_field, action, policy_name, applied_by, applied_at
          FROM `{project_id}.{gov_ds}.sec_rls_audit_log`
          QUALIFY ROW_NUMBER() OVER (PARTITION BY target_table, LOWER(org_field) ORDER BY applied_at DESC) = 1
        ),
        org_cols AS (
          SELECT table_name, LOWER(column_name) AS org_field, clustering_ordinal_position IS NOT NULL AS is_clustered
          FROM `{project_id}.{raw_ds}.INFORMATION_SCHEMA.COLUMNS`
          WHERE LOWER(column_name) IN ('bukrs', 'werks', 'vkorg', 'ekorg', 'gsber', 'prctr')
            AND table_name NOT LIKE 'agr_%' AND table_name NOT LIKE 'usr%' AND table_name NOT LIKE 'adr%'
            AND table_name NOT LIKE 'dd%' AND table_name NOT LIKE 't001%' AND table_name NOT LIKE 'sec_%'
        )
        SELECT
          oc.table_name,
          oc.org_field,
          oc.is_clustered,
          COALESCE(la.action, 'UNPROTECTED') AS status,
          la.policy_name,
          la.applied_at
        FROM org_cols oc
        LEFT JOIN latest_audit la ON oc.table_name = la.target_table AND oc.org_field = la.org_field
        ORDER BY CASE WHEN la.action = 'APPLIED' THEN 0 ELSE 1 END, oc.table_name
        """
        rows, meta = run_bq_query(client, sql)
        yield sse_event(
            "THOUGHT",
            f"Query concluída em {meta['elapsed_ms']} ms (Job ID: `{meta['job_id']}`, {len(rows)} combinações tabela/coluna analisadas).",
        )

        applied = [r for r in rows if r["status"] == "APPLIED"]
        unprotected = [r for r in rows if r["status"] != "APPLIED"]
        sample_applied = applied[:12]

        md_lines = [
            f"### Status das Políticas de Row-Level Security (`{project_id}.{raw_ds}`)\n",
            f"- **Total de Combinações Tabela × Coluna Organizacional:** `{len(rows)}`",
            f"- **Tabelas com Política RLS Ativa (`APPLIED`):** `{len(applied)}`",
            f"- **Tabelas Elegíveis / Desprotegidas (`UNPROTECTED`):** `{len(unprotected)}`\n",
            "| Tabela SAP | Coluna Org | Política RLS | Status | Clusterizada? |",
            "| :--- | :--- | :--- | :--- | :--- |",
        ]
        for r in sample_applied:
            pol = r.get("policy_name") or f"rap_auto_{r['org_field']}_{r['table_name']}"
            clust = "Sim" if r.get("is_clustered") else "Não (Alerta FinOps)"
            md_lines.append(
                f"| `{r['table_name']}` | `{r['org_field']}` | `{pol}` | **{r['status']}** | {clust} |"
            )

        if unprotected:
            sample_unp = ", ".join([f"`{u['table_name']} ({u['org_field']})`" for u in unprotected[:8]])
            md_lines.append(f"\n**Exemplos de tabelas ainda sem RLS ativo:** {sample_unp}.")

        yield sse_event("FINAL_RESPONSE", "\n".join(md_lines))
        yield sse_event("SUGGESTION", "Quais usuários possuem acesso à empresa (bukrs) 1010 e 1710?")
        yield sse_event("SUGGESTION", "Quais roles do SAP (PFCG) têm mais regras organizacionais?")
        yield sse_event("SUGGESTION", "Existem usuários com perfil SAP_ALL na tabela ust04?")

    elif any(k in q_lower for k in ["role", "pfcg", "agr_", "sap_all", "ust04", "perfil", "objeto"]):
        yield sse_event(
            "THOUGHT",
            f"Consultando tabelas `{raw_ds}.agr_users`, `{raw_ds}.agr_1252`, `{raw_ds}.agr_1251` e `{raw_ds}.ust04`...",
        )
        sql = f"""
        SELECT
          a1252.agr_name AS role_name,
          COUNT(DISTINCT a1252.varbl) AS total_org_vars,
          COUNT(*) AS total_rules,
          ARRAY_AGG(DISTINCT CONCAT(LOWER(REGEXP_REPLACE(a1252.varbl, r'^\\$', '')), '=', TRIM(a1252.low)) LIMIT 6) AS sample_values
        FROM `{project_id}.{raw_ds}.agr_1252` a1252
        WHERE a1252.varbl IS NOT NULL AND a1252.varbl != ''
        GROUP BY a1252.agr_name
        ORDER BY total_rules DESC
        LIMIT 10
        """
        rows, meta = run_bq_query(client, sql)
        ust_rows, _ = run_bq_query(
            client,
            f"SELECT profile, COUNT(DISTINCT bname) AS users, ARRAY_AGG(DISTINCT bname LIMIT 10) AS sample_users FROM `{project_id}.{raw_ds}.ust04` WHERE UPPER(profile) IN ('SAP_ALL', 'SAP_NEW') GROUP BY profile",
        )
        yield sse_event(
            "THOUGHT",
            f"Catálogo PFCG analisado em {meta['elapsed_ms']} ms ({len(rows)} top roles e {len(ust_rows)} perfis mestre).",
        )

        md_lines = [
            "### Análise de Roles PFCG e Perfis Mestre no SAP\n",
            "| Role SAP (`agr_name`) | Variáveis Org | Total Regras (`agr_1252`) | Exemplos de Valores |",
            "| :--- | :---: | :---: | :--- |",
        ]
        for r in rows:
            vals = ", ".join([f"`{v}`" for v in (r.get("sample_values") or [])])
            md_lines.append(
                f"| `{r['role_name']}` | {r['total_org_vars']} | **{r['total_rules']}** | {vals} |"
            )

        if ust_rows:
            md_lines.append("\n### Superusuários com Perfil Direto (`ust04`)\n")
            for u in ust_rows:
                usrs = ", ".join([f"`{b}`" for b in (u.get("sample_users") or [])])
                md_lines.append(
                    f"- **Perfil `{u['profile']}`:** `{u['users']}` usuários atribuídos ({usrs})"
                )

        yield sse_event("FINAL_RESPONSE", "\n".join(md_lines))
        yield sse_event("SUGGESTION", "Mostre a matriz de acesso dos usuários em sec_user_org_entitlements")
        yield sse_event("SUGGESTION", "Quantas linhas cada empresa (bukrs) possui na tabela bkpf?")
        yield sse_event("SUGGESTION", "Quais tabelas estão protegidas com Row-Level Security?")

    else:
        # Default / Entitlements / Users / BUKRS / BKPF analysis
        yield sse_event(
            "THOUGHT",
            f"Consultando `{project_id}.{gov_ds}.sec_user_org_entitlements` e `{project_id}.{raw_ds}.bkpf` para consolidar acessos por usuário e empresa...",
        )
        ent_sql = f"""
        SELECT
          user_email,
          sap_uname,
          org_field,
          ARRAY_AGG(DISTINCT COALESCE(org_value, '*') LIMIT 15) AS values_granted,
          LOGICAL_OR(is_all_access) AS has_full_access,
          ARRAY_AGG(DISTINCT role_name LIMIT 5) AS roles
        FROM `{project_id}.{gov_ds}.sec_user_org_entitlements`,
        UNNEST(source_roles) AS role_name
        GROUP BY user_email, sap_uname, org_field
        ORDER BY user_email, org_field
        LIMIT 25
        """
        ent_rows, meta = run_bq_query(client, ent_sql)
        bkpf_rows, _ = run_bq_query(
            client,
            f"SELECT bukrs, COUNT(*) AS total_docs FROM `{project_id}.{raw_ds}.bkpf` GROUP BY bukrs ORDER BY total_docs DESC",
        )
        yield sse_event(
            "THOUGHT",
            f"Dados de entitlements recuperados em {meta['elapsed_ms']} ms (Job ID: `{meta['job_id']}`). Formatando resumo executivo...",
        )

        md_lines = [
            f"### Resumo de Permissões e Entitlements SAP no BigQuery (`{gov_ds}.sec_user_org_entitlements`)\n",
            "| E-mail Corporativo (`SESSION_USER`) | Usuário SAP | Nível Org | Valores Liberados | Acesso Total (`*`) | Roles de Origem |",
            "| :--- | :--- | :--- | :--- | :---: | :--- |",
        ]
        for r in ent_rows:
            vals = ", ".join([f"`{v}`" for v in (r.get("values_granted") or []) if not str(v).startswith("$")]) or "`* (Coringa)`"
            roles_str = ", ".join([f"`{rl}`" for rl in (r.get("roles") or [])])
            full_badge = "Sim (`TRUE`)" if r.get("has_full_access") else "Restrito"
            md_lines.append(
                f"| `{r['user_email']}` | `{r['sap_uname']}` | `{r['org_field']}` | {vals} | {full_badge} | {roles_str} |"
            )

        if bkpf_rows:
            md_lines.append("\n### Distribuição de Documentos Contábeis na `bkpf` por Empresa (`bukrs`)\n")
            for b in bkpf_rows:
                md_lines.append(f"- **Empresa (`bukrs`) `{b['bukrs']}`:** `{b['total_docs']:,}` lançamentos contábeis")

        yield sse_event("FINAL_RESPONSE", "\n".join(md_lines))
        yield sse_event("SUGGESTION", "Quais tabelas do dataset Raw já estão com política de RLS aplicada?")
        yield sse_event("SUGGESTION", "Quais roles do SAP existem na tabela agr_1252 e ust04?")
        yield sse_event("SUGGESTION", "Quais usuários têm acesso irrestrito (is_all_access = TRUE)?")


def stream_gemini_data_chat(
    message: str,
    history: List[Dict[str, Any]],
) -> Generator[str, None, None]:
    """Stream responses from Gemini DataChatServiceClient with live BigQuery fallback."""
    state = load_state()
    conn = get_active_connection(state)
    project_id = conn["project_id"]
    raw_ds = conn["raw_dataset"]
    gov_ds = conn["governance_dataset"]

    append_app_audit(
        actor=state.get("current_app_user_email", "admin@felipechagas.altostrat.com"),
        module="GEMINI CHAT",
        action="ASK_QUESTION",
        details=f"Pergunta enviada ao Assistente Gemini: '{message[:120]}'",
    )

    if HAS_GEMINI_DATA_ANALYTICS:
        try:
            yield sse_event(
                "THOUGHT",
                f"Inicializando Gemini Data Analytics Agent no projeto `{project_id}` com referências às tabelas `{gov_ds}` e `{raw_ds}`...",
            )
            chat_client = gemini.DataChatServiceClient()

            inline_context = {
                "system_instruction": (
                    "Você é o Assistente Especialista em Governança de Autorizações SAP (PFCG) e "
                    "Row-Level Security (RLS) no Google Cloud BigQuery para a Copel. "
                    "Responda sempre em Português do Brasil de forma clara, estruturada em Markdown "
                    "(usando tabelas e listas quando apropriado). "
                    f"Os dados de entitlements consolidados estão em `{project_id}.{gov_ds}.sec_user_org_entitlements`, "
                    f"os logs de auditoria de RLS estão em `{project_id}.{gov_ds}.sec_rls_audit_log`, "
                    f"e as tabelas brutas do SAP estão em `{project_id}.{raw_ds}` (usr02, usr21, adr6, agr_users, agr_agrs, agr_1251, agr_1252, ust04, t001, bkpf)."
                ),
                "datasource_references": {
                    "bq": {
                        "table_references": build_bq_table_references(project_id, raw_ds, gov_ds)
                    }
                },
                "options": {"chart": {}},
            }

            client_history = []
            for msg in history:
                role = msg.get("role")
                content = msg.get("content") or ""
                if not content.strip():
                    continue
                if role == "user":
                    client_history.append(
                        gemini.Message(user_message=gemini.UserMessage(text=content))
                    )
                elif role == "model":
                    client_history.append(
                        gemini.Message(
                            system_message=gemini.SystemMessage(
                                text=gemini.TextMessage(parts=[content])
                            )
                        )
                    )

            chat_request = gemini.ChatRequest(
                parent=f"projects/{project_id}/locations/us",
                messages=client_history
                + [gemini.Message(user_message=gemini.UserMessage(text=message))],
                inline_context=inline_context,
            )

            response_stream = chat_client.chat(request=chat_request)
            got_final_response = False

            for chunk in response_stream:
                sys_msg = chunk.system_message
                if not sys_msg:
                    continue

                if sys_msg.suggestions:
                    for s in sys_msg.suggestions:
                        if getattr(s, "title", None):
                            yield sse_event("SUGGESTION", s.title)

                if sys_msg.text and sys_msg.text.parts:
                    raw_type = getattr(sys_msg, "text_type", None) or getattr(
                        sys_msg.text, "text_type", None
                    )
                    type_name = (
                        getattr(raw_type, "name", str(raw_type))
                        if raw_type is not None
                        else ""
                    )

                    if "UNSPECIFIED" in type_name or raw_type == 0:
                        for suggestion in sys_msg.text.parts:
                            if suggestion and suggestion.strip():
                                yield sse_event("SUGGESTION", suggestion.strip())
                    else:
                        text_content = "".join(sys_msg.text.parts)
                        evt_type = "FINAL_RESPONSE"
                        if "THOUGHT" in type_name or str(raw_type) == "1":
                            evt_type = "THOUGHT"
                        else:
                            got_final_response = True
                        yield sse_event(evt_type, text_content)

            if got_final_response:
                yield "data: [DONE]\n\n"
                return

        except Exception as exc:
            # Seamless fallback to live BigQuery Governance SQL Agent
            for item in stream_live_bq_governance_fallback(
                message=message,
                history=history,
                conn=conn,
                state=state,
                initial_note=f"Executando motor analítico direto sobre o BigQuery (`{project_id}.{gov_ds}`)...",
            ):
                yield item
            yield "data: [DONE]\n\n"
            return

    # If SDK not present or stream yielded no final text, use live BigQuery engine
    for item in stream_live_bq_governance_fallback(
        message=message,
        history=history,
        conn=conn,
        state=state,
    ):
        yield item
    yield "data: [DONE]\n\n"
