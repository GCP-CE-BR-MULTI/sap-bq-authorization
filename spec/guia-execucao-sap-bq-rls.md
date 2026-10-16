# Guia Prático de Execução Passo a Passo: RLS SAP no BigQuery

**Projeto:** Governança e Transposição de Autorizações SAP para o BigQuery  
**Ambiente:** Google Cloud e SAP  
**Documento de Referência:** [sdd-sap-authorization-bigquery.md](file:///Users/felipechagas/Repository/customers/copel/spec/sdd-sap-authorization-bigquery.md)  
**Versão:** 1.0  
**Data:** 2026-09-24  

---

## Índice de Fases

1. [Fase 0: Pré-requisitos e Validação de Ambiente](#fase-0-pré-requisitos-e-validação-de-ambiente)
2. [Fase 1: Criação da Estrutura de Governança e Datasets](#fase-1-criação-da-estrutura-de-governança-e-datasets)
3. [Fase 2: Implementação do Pipeline de Carga de Entitlements](#fase-2-implementação-do-pipeline-de-carga-de-entitlements)
4. [Fase 3: Automação da Aplicação de Row-Level Security (RLS)](#fase-3-automação-da-aplicação-de-row-level-security-rls)
5. [Fase 4: Otimização Física de Tabelas de Alto Volume (FinOps)](#fase-4-otimização-física-de-tabelas-de-alto-volume-finops)
6. [Fase 5: Homologação e Matriz de Testes de Segurança](#fase-5-homologação-e-matriz-de-testes-de-segurança)
7. [Fase 6: Operação Contínua, Monitoramento e Rollback](#fase-6-operação-contínua-monitoramento-e-rollback)

---

## Fase 0: Pré-requisitos e Validação de Ambiente

### Passo 0.1: Validar Permissões IAM do Operador
O engenheiro ou operador responsável pela implantação precisa das seguintes roles no projeto Google Cloud (`gcp-data-lake`):
- `roles/bigquery.admin` ou:
  - `roles/bigquery.dataOwner` (nos datasets `cortex7_sap_s4_raw` e `sap_governance`)
  - `roles/bigquery.filteredDataViewer` (para gerenciar e testar RLS)
  - `roles/bigquery.jobUser` (para executar queries e Stored Procedures)

### Passo 0.2: Verificar a Existência das 8 Tabelas SAP no Dataset Raw
Execute a query de diagnóstico para garantir que as tabelas de segurança do SAP foram replicadas via CDC e possuem dados atualizados:

```sql
SELECT 
  table_id AS table_name,
  row_count,
  ROUND(size_bytes / POW(1024, 2), 2) AS size_mb,
  TIMESTAMP_MILLIS(last_modified_time) AS last_modified
FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.__TABLES__`
WHERE table_id IN (
  'usr02',     -- Logon do usuário
  'usr21',     -- Chave usuário-endereço
  'adr6',      -- E-mails corporativos
  'agr_users', -- Associação usuário-role
  'agr_agrs',  -- Roles compostas
  'agr_1252',  -- Níveis organizacionais ($bukrs, etc.)
  'agr_1251',  -- Autorizações de campos
  'ust04'      -- Perfis diretos de superusuário (SAP_ALL, SAP_NEW)
)
ORDER BY table_name;
```
> **Critério de Aceite:** Todas as 8 tabelas devem existir com `row_count > 0` e `last_modified` compatível com a frequência do CDC.

### Passo 0.3: Validar a Taxa de Mapeamento de E-mails (bname $\rightarrow$ smtp_addr)
Verifique se os usuários corporativos do SAP possuem e-mail válido no formato `@empresa.com` na tabela `adr6`:

```sql
SELECT
  COUNT(DISTINCT u.bname) AS total_sap_users,
  COUNT(DISTINCT IF(a.smtp_addr IS NOT NULL AND a.smtp_addr LIKE '%@empresa.com%', u.bname, NULL)) AS users_with_valid_email,
  ROUND(COUNT(DISTINCT IF(a.smtp_addr IS NOT NULL AND a.smtp_addr LIKE '%@empresa.com%', u.bname, NULL)) / COUNT(DISTINCT u.bname) * 100, 2) AS email_coverage_pct
FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.usr02` u
LEFT JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.usr21` up 
  ON u.bname = up.bname
LEFT JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.adr6` a 
  ON up.persnumber = a.persnumber AND up.addrnumber = a.addrnumber
WHERE u.uflag = 0 
  AND CURRENT_DATE() BETWEEN COALESCE(u.gltgv, DATE '1900-01-01') AND COALESCE(u.gltgb, DATE '9999-12-31');
```
> **Critério de Aceite:** `email_coverage_pct >= 95%`. Usuários corporativos sem e-mail devem ser listados e reportados à equipe de Basis/Segurança SAP para saneamento na transação `SU01`.

---

## Fase 1: Criação da Estrutura de Governança e Datasets

### Passo 1.1: Criar o Dataset de Governança (caso ainda não exista)
No Cloud Shell ou terminal local:
```bash
bq --location=southamerica-east1 mk \
  --dataset \
  --description="Dataset de governança de acesso, perfis e RLS SAP" \
  gcp-data-lake:sap_governance
```

### Passo 1.2: Criar a Tabela Otimizada de Entitlements
Esta tabela armazena a visão desnormalizada das autorizações e deve ser clusterizada por `(user_email, org_field)` para garantir latência milimétrica no BigQuery:

```sql
CREATE OR REPLACE TABLE `gcp-data-lake.sap_governance.sec_user_org_entitlements`
(
  user_email STRING NOT NULL OPTIONS(description="E-mail corporativo institucional (coincide com SESSION_USER())"),
  sap_uname STRING NOT NULL OPTIONS(description="ID do usuário no SAP (bname)"),
  org_field STRING NOT NULL OPTIONS(description="Campo organizacional padronizado (bukrs, werks, vkorg, etc.)"),
  org_value STRING OPTIONS(description="Valor organizacional desnormalizado para correspondência direta no RLS (IN subquery)"),
  val_low STRING OPTIONS(description="Valor pontual de autorização ou início de faixa"),
  val_high STRING OPTIONS(description="Fim da faixa de autorização (NULL para valores pontuais)"),
  is_all_access BOOL NOT NULL OPTIONS(description="TRUE indica acesso total (*) concedido"),
  source_roles ARRAY<STRING> OPTIONS(description="Lista de roles PFCG que concederam o privilégio"),
  updated_at TIMESTAMP NOT NULL OPTIONS(description="Data e hora do processamento da linha")
)
CLUSTER BY user_email, org_field
OPTIONS(
  description="Tabela mestra de autorizações organizacionais desnormalizadas para consumo do RLS"
);
```

### Passo 1.3: Criar Tabela de Auditoria de Aplicação de Políticas
Para rastrear quais tabelas receberam RLS automaticamente e quando:

```sql
CREATE OR REPLACE TABLE `gcp-data-lake.sap_governance.sec_rls_audit_log`
(
  execution_id STRING NOT NULL,
  target_project STRING NOT NULL,
  target_dataset STRING NOT NULL,
  target_table STRING NOT NULL,
  org_field STRING NOT NULL,
  action STRING NOT NULL, -- 'APPLIED', 'REVOKED', 'FAILED'
  policy_name STRING NOT NULL,
  error_message STRING,
  applied_by STRING NOT NULL,
  applied_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(applied_at)
CLUSTER BY target_table, org_field;
```

---

## Fase 2: Implementação do Pipeline de Carga de Entitlements

### Passo 2.1: Criar a Stored Procedure de Atualização de Autorizações
Esta procedure consolida o de-para completo:
1. Filtra usuários ativos e válidos (`usr02` + `usr21` + `adr6`).
2. Expande roles compostas (`agr_agrs`).
3. Consolida níveis organizacionais da `agr_1252` e campos da `agr_1251`.
4. Trata coringas (`*`) e faixas (`low` e `high`).
5. Substitui atomicamente a tabela de entitlements.

```sql
CREATE OR REPLACE PROCEDURE `gcp-data-lake.sap_governance.sp_refresh_sap_entitlements`()
BEGIN
  -- Criação / Substituição atômica via CREATE OR REPLACE TABLE
  CREATE OR REPLACE TABLE `gcp-data-lake.sap_governance.sec_user_org_entitlements`
  CLUSTER BY user_email, org_field
  AS
  WITH active_users AS (
    SELECT
      LOWER(TRIM(a.smtp_addr)) AS user_email,
      u.bname AS sap_uname
    FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.usr02` u
    INNER JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.usr21` up
      ON u.bname = up.bname
    INNER JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.adr6` a
      ON up.persnumber = a.persnumber AND up.addrnumber = a.addrnumber
    WHERE (u.uflag IS NULL OR u.uflag = 0)
      AND CURRENT_DATE() BETWEEN COALESCE(u.gltgv, DATE '1900-01-01') AND COALESCE(u.gltgb, DATE '9999-12-31')
      AND a.smtp_addr IS NOT NULL
      AND a.smtp_addr LIKE '%@empresa.com%'
  ),

  user_roles_expanded AS (
    SELECT
      au.user_email,
      au.sap_uname,
      COALESCE(comp.child_agr, r.agr_name) AS effective_role
    FROM active_users au
    INNER JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.agr_users` r
      ON au.sap_uname = r.uname
    LEFT JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.agr_agrs` comp
      ON r.agr_name = comp.agr_name
    WHERE CURRENT_DATE() BETWEEN COALESCE(r.from_dat, DATE '1900-01-01') AND COALESCE(r.to_dat, DATE '9999-12-31')
  ),

  raw_org_permissions AS (
    -- Fonte 1: Níveis Organizacionais (agr_1252)
    SELECT
      ur.user_email,
      ur.sap_uname,
      ur.effective_role,
      LOWER(REGEXP_REPLACE(a1252.varbl, r'^\$', '')) AS org_field,
      TRIM(a1252.low) AS val_low,
      TRIM(a1252.high) AS val_high
    FROM user_roles_expanded ur
    INNER JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.agr_1252` a1252
      ON ur.effective_role = a1252.agr_name
    WHERE a1252.varbl IS NOT NULL
      AND a1252.varbl != ''

    UNION ALL

    -- Fonte 2: Campos de Autorização Explícitos (agr_1251)
    SELECT
      ur.user_email,
      ur.sap_uname,
      ur.effective_role,
      LOWER(TRIM(a1251.field)) AS org_field,
      TRIM(a1251.low) AS val_low,
      TRIM(a1251.high) AS val_high
    FROM user_roles_expanded ur
    INNER JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.agr_1251` a1251
      ON ur.effective_role = a1251.agr_name
    WHERE LOWER(a1251.field) IN ('bukrs', 'werks', 'vkorg', 'ekorg', 'gsber', 'prctr')

    UNION ALL

    -- Fonte 3: Superusuários com Perfil Direto SAP_ALL (ust04)
    SELECT
      au.user_email,
      au.sap_uname,
      'PROFILE:SAP_ALL' AS effective_role,
      '*' AS org_field,
      '*' AS val_low,
      CAST(NULL AS STRING) AS val_high
    FROM active_users au
    INNER JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.ust04` p
      ON au.sap_uname = p.bname
    WHERE UPPER(p.profile) IN ('SAP_ALL', 'SAP_NEW')
  ),

  master_bukrs AS (
    SELECT DISTINCT bukrs AS org_value FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.t001`
    UNION DISTINCT
    SELECT DISTINCT bukrs FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf`
  ),

  expanded_values AS (
    -- 1. Valores pontuais simples
    SELECT
      p.user_email,
      p.sap_uname,
      p.org_field,
      p.val_low AS org_value,
      p.val_low,
      p.val_high,
      FALSE AS is_all_access,
      p.effective_role
    FROM raw_org_permissions p
    WHERE p.val_low != '*' 
      AND (p.val_high IS NULL OR p.val_high = '')

    UNION ALL

    -- 2. Faixas de valores (val_low até val_high) expandidas contra a tabela mestre de empresas
    SELECT
      p.user_email,
      p.sap_uname,
      p.org_field,
      m.org_value,
      p.val_low,
      p.val_high,
      FALSE AS is_all_access,
      p.effective_role
    FROM raw_org_permissions p
    JOIN master_bukrs m
      ON p.org_field = 'bukrs' AND m.org_value BETWEEN p.val_low AND p.val_high
    WHERE p.val_high IS NOT NULL AND p.val_high != ''

    UNION ALL

    -- 3. Acesso Total (*) e Superusuários (SAP_ALL)
    SELECT
      p.user_email,
      p.sap_uname,
      p.org_field,
      CAST(NULL AS STRING) AS org_value,
      p.val_low,
      p.val_high,
      TRUE AS is_all_access,
      p.effective_role
    FROM raw_org_permissions p
    WHERE p.val_low = '*' OR p.org_field = '*'
  )

  SELECT
    user_email,
    sap_uname,
    org_field,
    org_value,
    val_low,
    val_high,
    is_all_access,
    ARRAY_AGG(DISTINCT effective_role) AS source_roles,
    CURRENT_TIMESTAMP() AS updated_at
  FROM expanded_values
  WHERE (org_value IS NOT NULL AND org_value != '') OR is_all_access = TRUE
  GROUP BY user_email, sap_uname, org_field, org_value, val_low, val_high, is_all_access;
END;
```

### Passo 2.2: Executar e Testar a Carga Inicial
Execute a procedure manualmente para validar sua execução:

```sql
CALL `gcp-data-lake.sap_governance.sp_refresh_sap_entitlements`();
```

Faça a verificação de sanidade:
```sql
SELECT 
  org_field,
  COUNT(DISTINCT user_email) AS total_users,
  COUNTIF(is_all_access) AS users_with_full_access,
  COUNT(*) AS total_rule_rows
FROM `gcp-data-lake.sap_governance.sec_user_org_entitlements`
GROUP BY org_field
ORDER BY total_rule_rows DESC;
```

### Passo 2.3: Configurar o Agendamento Recorrente
Para manter as autorizações sincronizadas diariamente (ou de hora em hora):

```bash
bq mk \
  --transfer_config \
  --project_id=gcp-data-lake \
  --data_source=scheduled_query \
  --display_name="Sync-SAP-Authorizations-to-Entitlements" \
  --schedule="every 1 hours" \
  --target_dataset=sap_governance \
  --params='{"query":"CALL `gcp-data-lake.sap_governance.sp_refresh_sap_entitlements`();"}'
```

---

## Fase 3: Automação da Aplicação de Row-Level Security (RLS)

### Passo 3.1: Criar a Stored Procedure de Aplicação Automática (`sp_apply_sap_rls`)
Esta procedure varre o catálogo `INFORMATION_SCHEMA.COLUMNS` do BigQuery, encontra todas as tabelas do dataset informado que contêm a coluna alvo e aplica a política de RLS de forma transacional e segura.

> **Resolução Arquitetural: Modo Dinâmico de Identidades (`GRANT TO`):**  
> Se o parâmetro `consumer_grantees` for informado como vazio (`''`), a procedure busca automaticamente em `sec_user_org_entitlements` todos os e-mails com permissões ativas para o nível organizacional informado (`org_column_name` ou wildcard `*`) e monta o `GRANT TO ('user:email1', 'user:email2', ...)` de forma dinâmica. Se identidades forem especificadas (ex: grupos IAM), ela utiliza a lista parametrizada.

```sql
CREATE OR REPLACE PROCEDURE `gcp-data-lake.sap_governance.sp_apply_sap_rls`(
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

  -- Modo Dinâmico: Se nenhum grantee for passado, extrai da tabela de entitlements
  IF formatted_grantees = '' OR formatted_grantees = "''" OR formatted_grantees = '""' THEN
    EXECUTE IMMEDIATE FORMAT("""
      SELECT STRING_AGG(DISTINCT CONCAT("'user:", LOWER(user_email), "'"), ', ')
      FROM `%s.sap_governance.sec_user_org_entitlements`
      WHERE (LOWER(org_field) = LOWER('%s') OR org_field = '*')
        AND user_email IS NOT NULL AND user_email != ''
    """, target_project, org_column_name)
    INTO dynamic_grantees;

    IF dynamic_grantees IS NOT NULL AND dynamic_grantees != '' THEN
      SET formatted_grantees = dynamic_grantees;
    ELSE
      -- Fallback para conta de administração corporativa
      SET formatted_grantees = "'user:admin-governanca@empresa.com'";
    END IF;
  ELSE
    -- Garante que os membros IAM possuam aspas simples se forem passados como string direta
    IF NOT (STARTS_WITH(formatted_grantees, "'") OR STARTS_WITH(formatted_grantees, '"')) THEN
      SET formatted_grantees = FORMAT("'%s'", formatted_grantees);
    END IF;
  END IF;

  FOR target IN (
    SELECT table_name
    FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.INFORMATION_SCHEMA.COLUMNS`
    WHERE LOWER(column_name) = LOWER(org_column_name)
      AND table_schema = target_dataset
      -- Filtro de segurança: Não aplicar sobre tabelas de sistema, auditoria ou dicionário
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
      -- 1. Executa a DDL do Row-Level Security usando Top-Level IN subqueries não correlacionadas
      EXECUTE IMMEDIATE FORMAT("""
        CREATE OR REPLACE ROW ACCESS POLICY rap_auto_%s_%s
        ON `%s.%s.%s`
        GRANT TO (%s)
        FILTER USING (
          -- Bypass para Contas de Serviço técnicas e Administradores
          SESSION_USER() LIKE '%%@gcp-data-lake.iam.gserviceaccount.com'
          OR SESSION_USER() IN ('admin-governanca@empresa.com')

          -- Superusuários com Acesso Total (*) ou SAP_ALL (subquery não correlacionada)
          OR TRUE IN (
            SELECT is_all_access
            FROM `gcp-data-lake.sap_governance.sec_user_org_entitlements`
            WHERE user_email = SESSION_USER()
              AND (org_field = '%s' OR org_field = '*')
              AND is_all_access = TRUE
          )

          -- Usuários com escopo organizacional específico (subquery não correlacionada com suporte a block pruning)
          OR %s IN (
            SELECT org_value
            FROM `gcp-data-lake.sap_governance.sec_user_org_entitlements`
            WHERE user_email = SESSION_USER()
              AND org_field = '%s'
          )
        );
      """, 
        LOWER(org_column_name), 
        LOWER(target.table_name),
        target_project,
        target_dataset,
        target.table_name,
        formatted_grantees,
        LOWER(org_column_name),
        LOWER(org_column_name),
        LOWER(org_column_name)
      );

      -- 2. Registra o sucesso no log de auditoria
      INSERT INTO `gcp-data-lake.sap_governance.sec_rls_audit_log`
      VALUES (
        exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
        'APPLIED', FORMAT('rap_auto_%s_%s', LOWER(org_column_name), LOWER(target.table_name)),
        NULL, SESSION_USER(), CURRENT_TIMESTAMP()
      );

    EXCEPTION WHEN ERROR THEN
      -- Registra falha pontual sem abortar o restante do loop
      INSERT INTO `gcp-data-lake.sap_governance.sec_rls_audit_log`
      VALUES (
        exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
        'FAILED', FORMAT('rap_auto_%s_%s', LOWER(org_column_name), LOWER(target.table_name)),
        @@error.message, SESSION_USER(), CURRENT_TIMESTAMP()
      );
    END;
  END FOR;
END;
```

### Passo 3.2: Criar a Stored Procedure de Remoção Emergencial (`sp_revoke_sap_rls`)
Essencial para situações em que for necessário reverter as políticas de RLS rapidamente.

> **Regra Fundamental de Segurança do BigQuery (DROP ALL):** No BigQuery, ao remover a **última ou única** política de RLS em uma tabela, o BigQuery rejeita `DROP ROW ACCESS POLICY <nome>` com o erro:
> `Dropping the last row access policy would make the table accessible to all users who have access to the table. If this is intended, please use a DROP ALL statement instead.`
> Por esse motivo, a Stored Procedure tenta primeiro remover a política específica. Caso o BigQuery aponte que é a última política, ela executa automaticamente `DROP ALL ROW ACCESS POLICIES ON <tabela>` de forma segura e resiliente, registrando cada ação no log de auditoria `sec_rls_audit_log`.

```sql
CREATE OR REPLACE PROCEDURE `gcp-data-lake.sap_governance.sp_revoke_sap_rls`(
  target_project STRING,
  target_dataset STRING,
  org_column_name STRING
)
BEGIN
  DECLARE exec_id STRING;
  SET exec_id = GENERATE_UUID();

  -- Itera por todas as tabelas que contêm o campo organizacional ou que tiveram RLS registrado na auditoria
  FOR target IN (
    SELECT DISTINCT table_name
    FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.INFORMATION_SCHEMA.COLUMNS`
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
    FROM `gcp-data-lake.sap_governance.sec_rls_audit_log`
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
        -- Tentativa 1: Remover a política específica da coluna organizacional
        EXECUTE IMMEDIATE FORMAT("""
          DROP ROW ACCESS POLICY IF EXISTS %s ON `%s.%s.%s`;
        """, policy_name, target_project, target_dataset, target.table_name);

        INSERT INTO `gcp-data-lake.sap_governance.sec_rls_audit_log`
        VALUES (
          exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
          'REVOKED', policy_name, NULL, SESSION_USER(), CURRENT_TIMESTAMP()
        );
      EXCEPTION WHEN ERROR THEN
        -- Se for a última/única política na tabela, o BigQuery exige DROP ALL ROW ACCESS POLICIES
        IF CONTAINS_SUBSTR(LOWER(@@error.message), 'drop all') 
           OR CONTAINS_SUBSTR(LOWER(@@error.message), 'last row access policy') THEN
          BEGIN
            EXECUTE IMMEDIATE FORMAT("""
              DROP ALL ROW ACCESS POLICIES ON `%s.%s.%s`;
            """, target_project, target_dataset, target.table_name);

            INSERT INTO `gcp-data-lake.sap_governance.sec_rls_audit_log`
            VALUES (
              exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
              'REVOKED', FORMAT('%s (DROP ALL)', policy_name), NULL, SESSION_USER(), CURRENT_TIMESTAMP()
            );
          EXCEPTION WHEN ERROR THEN
            INSERT INTO `gcp-data-lake.sap_governance.sec_rls_audit_log`
            VALUES (
              exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
              'FAILED_REVOKE', policy_name, @@error.message, SESSION_USER(), CURRENT_TIMESTAMP()
            );
          END;
        ELSE
          INSERT INTO `gcp-data-lake.sap_governance.sec_rls_audit_log`
          VALUES (
            exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
            'FAILED_REVOKE', policy_name, @@error.message, SESSION_USER(), CURRENT_TIMESTAMP()
          );
        END IF;
      END;
    END;
  END FOR;
END;
```

### Passo 3.3: Execução Piloto em 1 Tabela Controlada (`bkpf`)
Antes de rodar em todas as tabelas, execute um teste isolado na tabela de cabeçalho contábil (`bkpf`):

```sql
CREATE OR REPLACE ROW ACCESS POLICY rap_piloto_bukrs_bkpf
ON `ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf`
GRANT TO (
  'group:gcp-bi-analysts@empresa.com',
  'group:gcp-sap-consumers@empresa.com'
)
FILTER USING (
  SESSION_USER() LIKE '%@gcp-data-lake.iam.gserviceaccount.com'
  OR TRUE IN (
    SELECT is_all_access
    FROM `gcp-data-lake.sap_governance.sec_user_org_entitlements`
    WHERE user_email = SESSION_USER()
      AND (org_field = 'bukrs' OR org_field = '*')
      AND is_all_access = TRUE
  )
  OR bukrs IN (
    SELECT org_value
    FROM `gcp-data-lake.sap_governance.sec_user_org_entitlements`
    WHERE user_email = SESSION_USER()
      AND org_field = 'bukrs'
  )
);
```

### Passo 3.4: Execução em Escala (Dataset Inteiro para `bukrs`)
Após homologar o piloto, invoque a procedure para aplicar a política em todas as tabelas do dataset:

```sql
CALL `gcp-data-lake.sap_governance.sp_apply_sap_rls`(
  'ce-sap-latam-genai',
  'cortex7_sap_s4_raw',
  'bukrs',
  "'group:gcp-bi-analysts@empresa.com', 'group:gcp-sap-consumers@empresa.com'"
);
```

Verifique o relatório de execução:
```sql
SELECT 
  action, 
  COUNT(*) AS total_tables,
  COUNTIF(action = 'FAILED') AS total_failures
FROM `gcp-data-lake.sap_governance.sec_rls_audit_log`
WHERE DATE(applied_at) = CURRENT_DATE()
GROUP BY action;
```

---

## Fase 4: Otimização Física de Tabelas de Alto Volume (FinOps)

### Passo 4.1: Analisar Tabelas Críticas sem Clustering por `bukrs`
Tabelas como `bseg`, `acdoca` e `bkpf` com bilhões de linhas não devem rodar RLS sem clustering na coluna filtrada, caso contrário o BigQuery fará varredura de partição completa.

Verifique o clustering atual:
```sql
SELECT 
  table_name,
  ARRAY_TO_STRING(ARRAY_AGG(column_name ORDER BY clustering_ordinal_position), ', ') AS clustering_fields
FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.INFORMATION_SCHEMA.COLUMNS`
WHERE is_clustering_column = 'YES'
  AND table_name IN ('bkpf', 'bseg', 'acdoca', 'bsis', 'bsas', 'bsik', 'bsak')
GROUP BY table_name
ORDER BY table_name;
```

### Passo 4.2: Adequar o Clustering das Tabelas Contábeis (se necessário)
Caso a tabela `bkpf` ou `bseg` não esteja clusterizada por `bukrs`, ajuste sua definição:

```sql
-- Exemplo de re-clusterização para bkpf
CREATE OR REPLACE TABLE `ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf`
PARTITION BY DATE(cpudt) -- Data de digitação/lançamento
CLUSTER BY bukrs, gjahr, belnr
AS SELECT * FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf`;
```
> **Benefício FinOps:** O BigQuery aplica *Block Pruning*, eliminando do scan mais de 80% dos blocos físicos de dados para usuários com permissão em apenas 1 ou 2 empresas.

---

## Fase 5: Homologação e Matriz de Testes de Segurança

Execute as validações abaixo conectado como cada perfil de usuário (ou solicitando que o usuário execute e valide o resultado):

### Matriz de Validação Prática

| # | Perfil / Caso de Teste | Consulta de Teste | Resultado Esperado |
| :--- | :--- | :--- | :--- |
| **5.1** | **Usuário Empresa Única**<br>`joao.silva@empresa.com` (apenas bukrs 1000) | `SELECT DISTINCT bukrs FROM \`ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf\`` | Retorna **apenas a linha `1000`**. |
| **5.2** | **Usuário Multi-Empresa**<br>`maria.costa@empresa.com` (bukrs 1000 e 2000) | `SELECT DISTINCT bukrs FROM \`ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf\`` | Retorna **exatamente `1000` e `2000`**. |
| **5.3** | **Usuário Faixa de Empresas**<br>`carlos.souza@empresa.com` (1000 a 1050) | `SELECT DISTINCT bukrs FROM \`ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf\`` | Retorna apenas empresas no intervalo **`[1000, 1050]`**. |
| **5.4** | **Usuário Corporativo Coringa**<br>`diretor.financas@empresa.com` (`*`) | `SELECT DISTINCT bukrs FROM \`ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf\`` | Retorna **todas as empresas** da tabela. |
| **5.5** | **Usuário Bloqueado/Expirado**<br>`ex.colaborador@empresa.com` | `SELECT COUNT(*) FROM \`ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf\`` | Retorna **0** (nenhum registro acessível). |
| **5.6** | **Consulta via View de Consumo**<br>`vw_lancamentos_contabeis` | `SELECT DISTINCT bukrs FROM \`gcp-data-lake.sap_analytics.vw_lancamentos_contabeis\`` | **Filtra com o mesmo resultado da tabela RAW**, provando a herança de `SECURITY INVOKER`. |
| **5.7** | **Service Account de Pipeline**<br>`sa-etl-dataproc@...` | `SELECT COUNT(DISTINCT bukrs) FROM \`ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf\`` | Retorna **o total real de empresas**, comprovando que o bypass de SA está ativo. |

---

## Fase 6: Operação Contínua, Monitoramento e Rollback

### Passo 6.1: Consulta Periódica de Auditoria de Políticas Ativas
Monitore o histórico de aplicação e status das políticas RLS através da tabela de auditoria contínua da governança:

```sql
SELECT 
  target_project,
  target_dataset,
  target_table,
  org_field,
  policy_name,
  action,
  applied_by,
  applied_at
FROM `gcp-data-lake.sap_governance.sec_rls_audit_log`
WHERE action IN ('APPLIED', 'REVOKED')
QUALIFY ROW_NUMBER() OVER (PARTITION BY target_table, org_field ORDER BY applied_at DESC) = 1
ORDER BY target_table;
```

### Passo 6.2: Detecção Automática de Novas Tabelas Ingeridas sem RLS
Para garantir que nenhuma tabela nova chegue via CDC sem a proteção de segurança, cruzando o dicionário de colunas com as tabelas já protegidas no log de auditoria:

```sql
SELECT 
  c.table_name,
  c.column_name
FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.INFORMATION_SCHEMA.COLUMNS` c
LEFT JOIN (
  SELECT DISTINCT target_table 
  FROM `gcp-data-lake.sap_governance.sec_rls_audit_log`
  WHERE action = 'APPLIED' AND LOWER(org_field) = 'bukrs'
) protected
  ON c.table_name = protected.target_table
WHERE LOWER(c.column_name) = 'bukrs'
  AND protected.target_table IS NULL
  AND c.table_name NOT LIKE 'agr_%'
  AND c.table_name NOT LIKE 'usr%'
  AND c.table_name NOT LIKE 'adr%'
  AND c.table_name NOT LIKE 'dd%'
  AND c.table_name NOT LIKE 't001%'
  AND c.table_name NOT LIKE 'sec_%';
```
> **Alerta Operacional:** Se esta query retornar qualquer tabela, execute a procedure `sp_apply_sap_rls` para aplicar a governança imediatamente.

### Passo 6.3: Procedimento de Rollback Imediato (Desativação de Emergência)
Se houver qualquer bloqueio indevido em relatórios executivos ou incidentes de produção:

1. **Rollback em 1 Tabela Específica:**
   > **Atenção:** Se a política a ser removida for a **única ou última** existente na tabela, o BigQuery exige `DROP ALL ROW ACCESS POLICIES`, caso contrário utilize o nome específico:
   ```sql
   -- Se for a única ou última política na tabela:
   DROP ALL ROW ACCESS POLICIES ON `ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf`;

   -- Se houverem outras políticas ativas na tabela:
   DROP ROW ACCESS POLICY IF EXISTS rap_auto_bukrs_bkpf ON `ce-sap-latam-genai.cortex7_sap_s4_raw.bkpf`;
   ```

2. **Rollback Global no Dataset:**
   ```sql
   CALL `gcp-data-lake.sap_governance.sp_revoke_sap_rls`('ce-sap-latam-genai', 'cortex7_sap_s4_raw', 'bukrs');
   ```

---

## Resumo das Stored Procedures Criadas

| Nome do Objeto | Localização | Finalidade |
| :--- | :--- | :--- |
| **`sp_refresh_sap_entitlements`** | `sap_governance` | Atualiza a tabela `sec_user_org_entitlements` a partir das tabelas CDC do SAP. |
| **`sp_apply_sap_rls`** | `sap_governance` | Aplica dinamicamente as políticas de RLS em todas as tabelas com a coluna informada. |
| **`sp_revoke_sap_rls`** | `sap_governance` | Remove em lote as políticas de RLS caso seja necessário um rollback emergencial. |
| **`sec_rls_audit_log`** | `sap_governance` | Tabela histórica com o registro de cada política aplicada ou revogada. |
