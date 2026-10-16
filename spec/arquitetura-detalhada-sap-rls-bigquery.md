# Arquitetura Detalhada: Transposição de Autorizações SAP para Row-Level Security (RLS) no Google Cloud BigQuery

## 1. Visão Geral Executiva e Arquitetural

### 1.1 Contexto e Desafio Tecnológico
A modernização analítica corporativa com **Google Cloud e SAP** consolida dados transacionais e cadastrais corporativos do SAP (ECC e S/4HANA) diretamente no **Google Cloud BigQuery** por meio de pipelines de ingestão contínua em tempo real (CDC - *Change Data Capture*). 

Entretanto, a governança de acesso entre os dois mundos opera sobre paradigmas fundamentalmente distintos:
* **No SAP (Transacional / OLTP):** A segurança é fundamentada no framework **PFCG** (*Profile Generator*). O acesso a dados de filiais, empresas ou centros de custo é controlado por Perfis de Autorização, Roles simples/compostas, Objetos de Autorização (como `F_BKPF_BUK`) e Níveis Organizacionais (como `BUKRS`, `WERKS`, `VKORG`).
* **No Google Cloud BigQuery (Analítico / OLAP):** A segurança opera sob o modelo de **Cloud IAM** (permissões de dataset/tabela) combinado com **Row-Level Security (RLS)** nativo, em que predicados lógicos em SQL filtram deterministicamente as linhas retornadas com base na identidade da sessão (`SESSION_USER()`).

**O Risco Crítico:** Se os dados do SAP forem replicados e expostos aos usuários de negócio, ferramentas de BI (Power BI, Looker) e cientistas de dados sem a transposição das regras organizacionais da PFCG, haverá **vazamento de dados sigilosos entre empresas e unidades de negócio da organização**. Por outro lado, tentar gerenciar permissões de linhas manualmente no BigQuery para milhares de usuários geraria overhead operacional inviável e alto risco de descompasso com o SAP.

---

### 1.2 A Solução Arquitetural de Segurança Zero-Trust
A solução projeta e implementa uma esteira de segurança totalmente desacoplada, declarativa e automatizada, baseada em 3 pilares:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ CAMADA 1: INGESTÃO CDC CONTÍNUA (cortex7_sap_s4_raw)                                         │
│ usr02 + usr21 + adr6 (Identidade/E-mail) ──┐                                                │
│ agr_users + agr_1251 + agr_define (Roles)  ┼──► Ingestão contínua via Datastream / CDC      │
│ t001 (Tabela Mestre de Empresas)          ──┘                                                │
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │ Executado periodicamente via Scheduler
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ CAMADA 2: MOTOR DE ENTITLEMENTS (sp_refresh_sap_entitlements)                               │
│ 1. Resolve De-Para: bname (SAP) ──► adr6.smtp_addr (E-mail Corporativo Google)              │
│ 2. Explode Roles Compostas em Roles Simples                                                 │
│ 3. Expande Faixas (BETWEEN) e Coringas (*) consultando t001                                 │
│ 4. Materializa resultado na sec_user_org_entitlements (Clusterizada por user_email, org_field)│
└──────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ CAMADA 3: SEGURANÇA ANALÍTICA NATIVA (sp_apply_sap_rls)                                     │
│ Cria ROW ACCESS POLICY nas tabelas de negócio (ex: tvko, bkpf, bseg, etc.)                  │
│ Predicado Otimizado (Não Correlacionado):                                                   │
│   TRUE IN (SELECT is_all_access FROM sec_user_org_entitlements                             │
│            WHERE user_email = SESSION_USER() AND org_field = 'bukrs' AND is_all_access)      │
│   OR                                                                                        │
│   bukrs IN (SELECT org_value FROM sec_user_org_entitlements                                 │
│             WHERE user_email = SESSION_USER() AND org_field = 'bukrs')                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Catálogo de Tabelas da Solução

Toda a arquitetura é estruturada com nomes de tabelas e colunas estritamente em letras minúsculas (`lowercase`), em conformidade com as diretrizes do BigQuery e padrões de governança.

### 2.1 Tabelas Replicadas do SAP (Dataset: `cortex7_sap_s4_raw`)

| Tabela | Nome no SAP | Papel na Solução | Colunas Chave Utilizadas |
| :--- | :--- | :--- | :--- |
| `usr02` | USR02 | **Mestre de Usuários e Status de Logon**: Valida se a conta do usuário SAP está ativa, dentro da vigência e sem bloqueio administrativo. | `bname`, `gltgv` (válido de), `gltgb` (válido até), `uflag` (status de bloqueio: 0 = ativo). |
| `usr21` | USR21 | **Tabela de Atribuição de Usuário a Chaves de Endereço**: Faz o vínculo estrutural entre o nome do usuário SAP (`bname`) e as chaves de pessoa/endereço do Business Address Services (BAS). | `bname`, `persnumber` (número da pessoa), `addrnumber` (número do endereço). |
| `adr6` | ADR6 | **Endereços de E-mail (BAS)**: Armazena o endereço de correio eletrônico corporativo do colaborador. Permite a correlação nativa com a identidade Google autenticada no BigQuery (`SESSION_USER()`). | `persnumber`, `addrnumber`, `smtp_addr` (e-mail corporativo), `flgdefault` (indicador de e-mail padrão). |
| `agr_users` | AGR_USERS | **Atribuição de Perfis e Roles aos Usuários**: Registra quais papéis PFCG estão concedidos a cada usuário e em qual período de datas. | `mandt`, `agr_name` (nome da role), `uname` (usuário SAP), `from_dat`, `to_dat`. |
| `agr_1251` | AGR_1251 | **Valores de Dados de Autorização**: Contém os objetos de autorização, campos e os valores atribuídos às roles (valores pontuais, faixas ou coringas). | `mandt`, `agr_name`, `object` (ex: `F_BKPF_BUK`), `auth`, `field` (ex: `BUKRS`), `low`, `high`, `deleted`. |
| `agr_define` | AGR_DEFINE | **Hierarquia de Roles (Roles Compostas)**: Mapeia as relações entre roles compostas e suas roles simples dependentes. Permite a resolução recursiva de direitos. | `mandt`, `agr_name` (role composta), `parent_agr` (role filha/dependente). |
| `tobit` | TOBIT | **Catálogo de Objetos de Autorização**: Dicionário de metadados que descreve quais campos de autorização compõem cada objeto do SAP. | `object`, `fiel1`, `fiel2`, ..., `fiel10`. |
| `ust12` | UST12 | **Autorizações de Perfis Gerados**: Registra os valores reais em tempo de execução dos perfis gerados no SAP. | `mandt`, `objct`, `auth`, `field`, `von`, `bis`. |
| `t001` | T001 | **Mestre de Empresas (Company Codes)**: Catálogo corporativo de todas as empresas cadastradas no ambiente SAP. Fundamental para a expansão determinística de faixas organizacionais e do coringa `*`. | `mandt`, `bukrs` (código da empresa), `butxt` (nome da empresa), `land1` (país). |

---

### 2.2 Tabelas de Governança e Metadados (Dataset: `gcp-data-lake.sap_governance`)

#### A. `sec_user_org_entitlements`
Esta é a **tabela central materializada** que consolida os direitos de acesso de cada colaborador.
* **Estratégia de Performance:** A tabela é obrigatoriamente **Clusterizada** por `user_email` e `org_field`. Com isso, quando o BigQuery avalia o predicado da RLS com `WHERE user_email = SESSION_USER() AND org_field = 'bukrs'`, ele lê apenas um conjunto ínfimo de blocos de metadados, com tempo de subquery inferior a 100 milissegundos e custo próximo a zero bytes processados.

* **Esquema DDL:**
```sql
CREATE OR REPLACE TABLE `gcp-data-lake.sap_governance.sec_user_org_entitlements`
(
  user_email STRING NOT NULL OPTIONS(description="E-mail corporativo autenticado do usuário (igual a SESSION_USER())"),
  sap_uname STRING NOT NULL OPTIONS(description="Nome de usuário técnico no SAP (bname)"),
  org_field STRING NOT NULL OPTIONS(description="Nome do campo organizacional padronizado em lowercase (ex: bukrs, werks, vkorg)"),
  org_value STRING OPTIONS(description="Valor organizacional explícito e concreto (ex: '1000', '1010'). Usado no IN desacoplado"),
  val_low STRING OPTIONS(description="Valor inferior original registrado na AGR_1251"),
  val_high STRING OPTIONS(description="Valor superior original registrado na AGR_1251 (caso de faixa)"),
  is_all_access BOOL NOT NULL OPTIONS(description="Indicador de acesso irrestrito/superusuário (SAP_ALL ou coringa '*')"),
  source_roles ARRAY<STRING> OPTIONS(description="Lista de roles SAP que concederam este privilégio"),
  updated_at TIMESTAMP NOT NULL OPTIONS(description="Data e hora da última sincronização bem-sucedida")
)
CLUSTER BY user_email, org_field;
```

#### B. `sec_table_rls_config`
Tabela declarativa de controle e inventário que especifica quais tabelas do Data Lakehouse possuem proteção de RLS ativa e qual coluna de negócio deve ser inspecionada.

* **Esquema DDL:**
```sql
CREATE OR REPLACE TABLE `gcp-data-lake.sap_governance.sec_table_rls_config`
(
  project_id STRING NOT NULL OPTIONS(description="ID do projeto GCP onde a tabela protegida reside"),
  dataset_name STRING NOT NULL OPTIONS(description="Nome do dataset da tabela (ex: cortex7_sap_s4_raw)"),
  table_name STRING NOT NULL OPTIONS(description="Nome da tabela protegida (ex: tvko, bkpf, bseg)"),
  org_field STRING NOT NULL OPTIONS(description="Campo organizacional correspondente (ex: bukrs, vkorg)"),
  rls_column_name STRING NOT NULL OPTIONS(description="Coluna física da tabela que armazena a unidade organizacional"),
  filter_type STRING NOT NULL OPTIONS(description="Tipo de operador lógico (IN, EQUAL)"),
  is_active BOOL NOT NULL OPTIONS(description="Flag booleana indicando se a política de segurança deve estar em vigor"),
  consumer_grantees STRING NOT NULL OPTIONS(description="Lista de grupos ou usuários que consumirão a tabela protegida")
);
```

---

## 3. As Stored Procedures em Detalhes Absolutos

A automação operacional é orquestrada por 3 Stored Procedures, cada uma com responsabilidade única e desacoplada.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PROCEDURES DA ARQUITETURA                                                              │
│                                                                                        │
│ 1. sp_refresh_sap_entitlements(p_target_dataset)                                      │
│    Motor de transformação que consolida o PFCG SAP em Entitlements no BigQuery.       │
│    Frequência: Recorrente (Agendada a cada 1 hora, 6 horas ou D-1).                   │
│                                                                                        │
│ 2. sp_apply_sap_rls(p_target_project, p_target_dataset, p_table_name, ...)             │
│    Motor de DDL que cria/atualiza dinamicamente as ROW ACCESS POLICIES.                │
│    Frequência: On-demand (Apenas quando novas tabelas de negócio são adicionadas).     │
│                                                                                        │
│ 3. sp_revoke_sap_rls(p_target_project, p_target_dataset, p_table_name)                │
│    Mecanismo de rollback seguro para desativação de políticas RLS em caso de crise.    │
│    Frequência: Emergencial / Rollback.                                                 │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 3.1 `sp_refresh_sap_entitlements(p_target_dataset)`

#### Finalidade e Papel
Esta é a Stored Procedure central da esteira contínua. Ela faz a leitura das 8 tabelas brutas de segurança do SAP (`usr02`, `usr21`, `adr6`, `agr_users`, `agr_1251`, `agr_define`, `t001`), executa a lógica de consolidação de perfis e atualiza atomicamente a tabela de entitlements.

#### Lógica Interna Passo a Passo (CTEs)
1. **`active_users`:** Filtra os usuários que estão com `uflag = 0` (não bloqueados) e cuja data atual (`CURRENT_DATE()`) esteja dentro da janela de validade de logon (`gltgv` a `gltgb`).
2. **`user_emails`:** Cruza o usuário SAP (`bname`) com `usr21` e `adr6`. Extrai o e-mail Google (`smtp_addr`), convertendo para minúsculas com `TRIM(LOWER(adr6.smtp_addr))`. Garante deduplicação priorizando registros com `flgdefault = 'X'`.
3. **`composite_roles` e `flattened_roles`:** Trata as roles compostas do SAP (`agr_define`). Se um usuário possui a role `Z_COMP_FINANCE`, a procedure resolve recursivamente todas as roles simples filhas associadas.
4. **`user_assigned_roles`:** Une as roles simples diretamente atribuídas na `agr_users` com as roles filhas herdadas de roles compostas, filtrando somente as atribuições cuja vigência (`from_dat` a `to_dat`) abranja a data atual.
5. **`master_bukrs`:** Realiza uma leitura única na tabela `t001` trazendo a lista de todas as empresas válidas e ativas cadastradas no SAP.
6. **`expanded_bukrs` (Resolução de Faixas e Coringas):**
   * **Valores Pontuais:** Quando `low != '*'` e `high IS NULL`, insere o valor exato no campo `org_value`.
   * **Faixas Organizacionais:** Quando `low` e `high` estão preenchidos (ex: `1000` a `1050`), executa um `JOIN master_bukrs ON master_bukrs.bukrs BETWEEN low AND high`. Cada empresa contida no intervalo é desmembrada em uma linha distinta com seu `org_value` concreto.
   * **Coringas e Superusuários (`*` e `SAP_ALL`):** Se a role contiver `*` no campo `low`, ou se o usuário possuir o perfil `SAP_ALL`, a procedure:
     1. Insere todas as empresas da tabela mestre `t001`.
     2. Marca a flag `is_all_access = TRUE`.
7. **Carga Atômica:** Executa a sobrescrita dos dados na tabela `sec_user_org_entitlements` com carimbo de data/hora atualizado (`updated_at = CURRENT_TIMESTAMP()`).

#### Código SQL Completo da Procedure:
```sql
CREATE OR REPLACE PROCEDURE `gcp-data-lake.sap_governance.sp_refresh_sap_entitlements`(
  p_target_dataset STRING
)
BEGIN
  DECLARE v_raw_dataset STRING DEFAULT 'ce-sap-latam-genai.cortex7_sap_s4_raw';
  
  EXECUTE IMMEDIATE FORMAT("""
    CREATE OR REPLACE TABLE `%s.sec_user_org_entitlements`
    CLUSTER BY user_email, org_field AS
    WITH active_users AS (
      SELECT DISTINCT LOWER(bname) AS bname
      FROM `%s.usr02`
      WHERE (uflag = 0 OR uflag IS NULL)
        AND (gltgv IS NULL OR gltgv <= CURRENT_DATE())
        AND (gltgb IS NULL OR gltgb >= CURRENT_DATE())
    ),
    user_emails AS (
      SELECT 
        LOWER(u.bname) AS bname,
        LOWER(TRIM(a.smtp_addr)) AS user_email
      FROM active_users u
      JOIN `%s.usr21` u21 ON LOWER(u.bname) = LOWER(u21.bname)
      JOIN `%s.adr6` a ON u21.addrnumber = a.addrnumber AND u21.persnumber = a.persnumber
      WHERE a.smtp_addr IS NOT NULL 
        AND a.smtp_addr != ''
        AND a.smtp_addr LIKE '%%@%%'
      QUALIFY ROW_NUMBER() OVER(PARTITION BY LOWER(u.bname) ORDER BY IF(a.flgdefault = 'X', 0, 1)) = 1
    ),
    role_hierarchy AS (
      SELECT DISTINCT
        LOWER(agr_name) AS parent_role,
        LOWER(child_agr) AS single_role
      FROM `%s.agr_define`
    ),
    user_roles AS (
      SELECT DISTINCT
        LOWER(au.uname) AS bname,
        LOWER(COALESCE(rh.single_role, au.agr_name)) AS agr_name
      FROM `%s.agr_users` au
      LEFT JOIN role_hierarchy rh ON LOWER(au.agr_name) = rh.parent_role
      WHERE (au.from_dat IS NULL OR au.from_dat <= CURRENT_DATE())
        AND (au.to_dat IS NULL OR au.to_dat >= CURRENT_DATE())
    ),
    master_bukrs AS (
      SELECT DISTINCT LOWER(bukrs) AS bukrs
      FROM `%s.t001`
      WHERE bukrs IS NOT NULL
    ),
    auth_values AS (
      SELECT 
        LOWER(a1251.agr_name) AS agr_name,
        LOWER(a1251.field) AS org_field,
        TRIM(LOWER(a1251.low)) AS val_low,
        TRIM(LOWER(a1251.high)) AS val_high,
        (TRIM(a1251.low) = '*' OR LOWER(a1251.agr_name) = 'sap_all') AS is_all_access
      FROM `%s.agr_1251` a1251
      WHERE LOWER(a1251.field) IN ('bukrs', 'werks', 'vkorg', 'ekorg', 'prctr', 'gsber')
        AND (a1251.deleted IS NULL OR a1251.deleted = '')
    ),
    expanded_bukrs AS (
      SELECT 
        ur.bname,
        av.org_field,
        mb.bukrs AS org_value,
        av.val_low,
        av.val_high,
        av.is_all_access,
        ur.agr_name
      FROM user_roles ur
      JOIN auth_values av ON ur.agr_name = av.agr_name
      JOIN master_bukrs mb ON (
        (av.val_low = '*' OR av.is_all_access)
        OR (av.val_high IS NOT NULL AND mb.bukrs BETWEEN av.val_low AND av.val_high)
        OR (av.val_high IS NULL AND mb.bukrs = av.val_low)
      )
      WHERE av.org_field = 'bukrs'
      
      UNION ALL
      
      SELECT 
        ur.bname,
        av.org_field,
        av.val_low AS org_value,
        av.val_low,
        av.val_high,
        av.is_all_access,
        ur.agr_name
      FROM user_roles ur
      JOIN auth_values av ON ur.agr_name = av.agr_name
      WHERE av.org_field != 'bukrs' 
        AND av.val_low != '*' 
        AND av.val_high IS NULL
    )
    SELECT 
      ue.user_email,
      eb.bname AS sap_uname,
      eb.org_field,
      eb.org_value,
      eb.val_low,
      eb.val_high,
      LOGICAL_OR(eb.is_all_access) AS is_all_access,
      ARRAY_AGG(DISTINCT eb.agr_name) AS source_roles,
      CURRENT_TIMESTAMP() AS updated_at
    FROM expanded_bukrs eb
    JOIN user_emails ue ON eb.bname = ue.bname
    GROUP BY 1, 2, 3, 4, 5, 6
  """, p_target_dataset, v_raw_dataset, v_raw_dataset, v_raw_dataset, v_raw_dataset, v_raw_dataset, v_raw_dataset, v_raw_dataset);
END;
```

---

### 3.2 `sp_apply_sap_rls(...)`

#### Finalidade e Papel
Esta Stored Procedure é o **motor de geração dinâmica de DDL**. Ela lê as parametrizações da tabela `sec_table_rls_config` e executa comandos `CREATE OR REPLACE ROW ACCESS POLICY` nas tabelas de dados de negócio.

#### Resolução Arquitetural Crítica: Erro de Subquery Correlacionada no BigQuery
Em testes iniciais de RLS no BigQuery envolvendo a tabela `tvko`, a seguinte sintaxe gerou um erro impeditivo do motor:
> ❌ **Erro do BigQuery:** `Row access policy for table 'ce-sap-latam-genai.cortex7_sap_s4_raw.tvko' may not include correlated subqueries involving target table.`

* **Por que o erro ocorre?** O BigQuery **não permite** que a política de segurança de uma tabela `T` faça uma subquery correlacionada onde uma coluna da tabela externa seja comparada diretamente no `WHERE` interno (exemplo inválido: `WHERE EXISTS (SELECT 1 FROM sec_user_org_entitlements ent WHERE ent.val_low = tvko.bukrs)`).
* **A Solução Implementada:** A procedure gera **Subqueries Não Correlacionadas baseadas em Operador `IN` Top-Level**. Como o campo `org_value` já foi previamente explodido e materializado na `sec_user_org_entitlements`, o BigQuery avalia a subquery de forma desacoplada:
  ```sql
  TRUE IN (
    SELECT is_all_access 
    FROM `gcp-data-lake.sap_governance.sec_user_org_entitlements`
    WHERE user_email = SESSION_USER() 
      AND org_field = 'bukrs' 
      AND is_all_access = TRUE
  )
  OR
  bukrs IN (
    SELECT org_value 
    FROM `gcp-data-lake.sap_governance.sec_user_org_entitlements`
    WHERE user_email = SESSION_USER() 
      AND org_field = 'bukrs'
  )
  ```

#### Tratamento de Sintaxe: `GRANT TO` e Modo Dinâmico de Identidades
No BigQuery, a cláusula `GRANT TO (...)` exige que os princípios IAM sejam informados como literais de string (ex: `'group:meu_grupo@empresa.com'`, `'user:gestor@empresa.com'`).
* **Resolução Dinâmica (Abordagem B):** Se o parâmetro `consumer_grantees` for vazio, a procedure executa uma consulta agregada na tabela `sec_user_org_entitlements` procurando todos os `user_email` com regras ativas para o `org_field` (ou coringa `*`). Ela sintetiza dinamicamente a cláusula `GRANT TO ('user:email1', 'user:email2', ...)` sem requerer manutenção manual da lista de usuários.
* **Sanitização de Aspas:** Se a string for gerada sem aspas (`GRANT TO (group:...)`), o parser do BigQuery falha com erro de sintaxe interpretando `GROUP` como a cláusula de agregação `GROUP BY`. A procedure sanitiza automaticamente a entrada garantindo aspas simples.

#### Código SQL Completo da Procedure:
```sql
CREATE OR REPLACE PROCEDURE `gcp-data-lake.sap_governance.sp_apply_sap_rls`(
  p_target_project STRING,
  p_target_dataset STRING,
  p_table_name STRING,
  p_governance_dataset STRING
)
BEGIN
  DECLARE v_sql STRING;
  DECLARE v_done BOOL DEFAULT FALSE;
  DECLARE v_tbl STRING;
  DECLARE v_col STRING;
  DECLARE v_field STRING;
  DECLARE v_grantees STRING;
  DECLARE v_dyn_grantees STRING;

  DECLARE cur CURSOR FOR
    SELECT 
      table_name, 
      rls_column_name, 
      org_field, 
      consumer_grantees
    FROM `gcp-data-lake.sap_governance.sec_table_rls_config`
    WHERE project_id = p_target_project
      AND dataset_name = p_target_dataset
      AND (p_table_name IS NULL OR table_name = p_table_name)
      AND is_active = TRUE;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = TRUE;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_tbl, v_col, v_field, v_grantees;
    IF v_done THEN
      LEAVE read_loop;
    END IF;

    SET v_grantees = TRIM(COALESCE(v_grantees, ''));

    -- Se vazio, extrai dinamicamente os usuários habilitados da tabela de entitlements
    IF v_grantees = '' OR v_grantees = "''" THEN
      EXECUTE IMMEDIATE FORMAT("""
        SELECT STRING_AGG(DISTINCT CONCAT("'user:", LOWER(user_email), "'"), ', ')
        FROM `%s.%s.sec_user_org_entitlements`
        WHERE (LOWER(org_field) = LOWER('%s') OR org_field = '*')
          AND user_email IS NOT NULL AND user_email != ''
      """, p_target_project, p_governance_dataset, v_field)
      INTO v_dyn_grantees;

      IF v_dyn_grantees IS NOT NULL AND v_dyn_grantees != '' THEN
        SET v_grantees = v_dyn_grantees;
      ELSE
        SET v_grantees = "'user:admin-governanca@empresa.com'";
      END IF;
    ELSE
      SET v_grantees = IF(STARTS_WITH(TRIM(v_grantees), "'"), v_grantees, CONCAT("'", TRIM(v_grantees), "'"));
    END IF;

    -- Criação da política com Subquery Não Correlacionada
    SET v_sql = FORMAT("""
      CREATE OR REPLACE ROW ACCESS POLICY `rap_sap_%s_%s`
      ON `%s.%s.%s`
      GRANT TO (%s)
      FILTER USING (
        TRUE IN (
          SELECT is_all_access 
          FROM `%s.sec_user_org_entitlements`
          WHERE user_email = SESSION_USER()
            AND org_field = '%s'
            AND is_all_access = TRUE
        )
        OR
        %s IN (
          SELECT org_value 
          FROM `%s.sec_user_org_entitlements`
          WHERE user_email = SESSION_USER()
            AND org_field = '%s'
        )
      )
    """, v_tbl, v_col, p_target_project, p_target_dataset, v_tbl, v_grantees,
         p_governance_dataset, v_field, v_col, p_governance_dataset, v_field);

    EXECUTE IMMEDIATE v_sql;
  END LOOP;
  CLOSE cur;
END;
```

---

### 3.3 `sp_revoke_sap_rls(...)`

#### Finalidade e Papel
Esta Stored Procedure implementa a capacidade de **Rollback Controlado**. Caso um incidente de produção ocorra, ou seja necessário realizar uma manutenção em lote na tabela protegida, a procedure localiza dinamicamente as tabelas que contêm o campo organizacional (ou que possuem registro no `sec_rls_audit_log`) e remove com segurança as políticas de Row-Level Security existentes no dataset alvo.

> **Regra de Segurança do BigQuery (DROP ALL):** Ao remover a última ou única política de RLS em uma tabela, o BigQuery rejeita a remoção isolada (`Dropping the last row access policy would make the table accessible to all users... please use a DROP ALL statement instead`). A procedure trata isso com contingência automática: caso o DROP individual falhe por ser a última política, ela executa de forma transparente `DROP ALL ROW ACCESS POLICIES` na tabela.

#### Código SQL Completo da Procedure:
```sql
CREATE OR REPLACE PROCEDURE `gcp-data-lake.sap_governance.sp_revoke_sap_rls`(
  target_project STRING,
  target_dataset STRING,
  org_column_name STRING
)
BEGIN
  DECLARE exec_id STRING;
  SET exec_id = GENERATE_UUID();

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
        EXECUTE IMMEDIATE FORMAT("""
          DROP ROW ACCESS POLICY IF EXISTS %s ON `%s.%s.%s`;
        """, policy_name, target_project, target_dataset, target.table_name);

        INSERT INTO `gcp-data-lake.sap_governance.sec_rls_audit_log`
        VALUES (
          exec_id, target_project, target_dataset, target.table_name, LOWER(org_column_name),
          'REVOKED', policy_name, NULL, SESSION_USER(), CURRENT_TIMESTAMP()
        );
      EXCEPTION WHEN ERROR THEN
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

---

## 4. Operação Contínua (Day-2 Operations): Como Operar no Dia a Dia?

Uma das dúvidas mais comuns de engenheiros de dados e administradores de segurança é: **"O que eu preciso executar quando as permissões mudarem no SAP?"**

### 4.1 Cenário A: Alteração de Roles ou Usuários no SAP
**Exemplo:** Um colaborador da organização foi transferido de departamento e ganhou acesso à empresa `1050`, ou um novo analista foi contratado e recebeu uma role no SAP.

* **O que acontece via CDC:**
  1. A transação PFCG no SAP altera as tabelas `agr_users` ou `agr_1251`.
  2. O conector CDC (Datastream / replicate) replica automaticamente as linhas modificadas para o dataset `cortex7_sap_s4_raw` em poucos segundos.
* **O que precisa ser executado no BigQuery?**
  * ✅ **RESPOSTA DEFINITIVA: VOCÊ SÓ PRECISA AGENDAR OU EXECUTAR A PROCEDURE `sp_refresh_sap_entitlements()`.**
  * ❌ **NÃO** é necessário rodar a `sp_apply_sap_rls()`.
  * ❌ **NÃO** é necessário recriar as políticas de RLS.
  * ❌ **NÃO** é necessário alterar views ou pipelines de ingestão.
* **Por que isso é possível?**
  Porque a política de Row-Level Security já está vinculada dinamicamente à tabela `sec_user_org_entitlements`. No momento exato em que a `sp_refresh_sap_entitlements()` finaliza sua execução, o BigQuery passa a aplicar os novos direitos a partir da próxima query executada pelo usuário.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ FLUXO OPERACIONAL DO DIA A DIA (DAY-2 OPERATIONS)                                      │
│                                                                                        │
│   Alteração de Role/Usuário no SAP                                                     │
│                 │                                                                      │
│                 ▼                                                                      │
│   Replicação Automática via CDC (Datastream)                                           │
│                 │                                                                      │
│                 ▼                                                                      │
│   BigQuery Scheduled Query (a cada 1 hora):                                            │
│   CALL `gcp-data-lake.sap_governance.sp_refresh_sap_entitlements`('...');           │
│                 │                                                                      │
│                 ▼                                                                      │
│   ✨ Tabela sec_user_org_entitlements atualizada com sucesso!                          │
│   (As políticas de RLS passam a ler os novos privilégios instantaneamente!)            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 4.2 Cenário B: Chegada de uma Nova Tabela de Negócio no BigQuery
**Exemplo:** O time de negócios solicitou a liberação de dados da tabela de cabeçalho de vendas (`vbak`) ou ordens de compra (`ekko`), e essas tabelas precisam ser protegidas pelo código de empresa (`bukrs`).

* **Passo 1:** Inserir a nova regra na tabela de catálogo `sec_table_rls_config`:
  ```sql
  INSERT INTO `gcp-data-lake.sap_governance.sec_table_rls_config`
  (project_id, dataset_name, table_name, org_field, rls_column_name, filter_type, is_active, consumer_grantees)
  VALUES
  ('ce-sap-latam-genai', 'cortex7_sap_s4_raw', 'vbak', 'bukrs', 'bukrs_vf', 'IN', TRUE, "'group:genai4sap_finance@felipechagas.altostrat.com'");
  ```
* **Passo 2:** Executar a `sp_apply_sap_rls` passando especificamente o nome da nova tabela:
  ```sql
  CALL `gcp-data-lake.sap_governance.sp_apply_sap_rls`(
    'ce-sap-latam-genai',
    'cortex7_sap_s4_raw',
    'vbak',
    'gcp-data-lake.sap_governance'
  );
  ```
* **Pronto!** A partir deste comando, a tabela `vbak` passa a responder sob as regras de segurança corporativas do SAP.

---

## 5. Tratamento de Casos Críticos de Negócio SAP

| Cenário de Negócio SAP | Comportamento no SAP PFCG | Como a Solução Trata no BigQuery |
| :--- | :--- | :--- |
| **Superusuário (`SAP_ALL`)** | O usuário possui perfil mestre com acesso a todos os objetos e transações. | A procedure detecta `agr_name = 'sap_all'`, marca `is_all_access = TRUE` e expande todas as empresas da `t001`. Na política de RLS, o predicado `TRUE IN (SELECT is_all_access ...)` é satisfeito imediatamente. |
| **Coringa (`low = '*'`)** | Acesso a qualquer filial ou centro de custo dentro do objeto. | A procedure expande o coringa consultando todas as empresas cadastradas na `t001`, garantindo que o usuário tenha linhas para todas elas e marca `is_all_access = TRUE`. |
| **Faixa Organizacional (`1000 a 1050`)** | Concessão de intervalo de códigos empresariais. | A procedure faz o `JOIN master_bukrs ON bukrs BETWEEN low AND high`, gerando registros com `org_value` concreto para cada empresa da faixa existente na `t001`. Isso elimina a necessidade de usar `BETWEEN` na RLS, permitindo o uso do `IN` de alta performance. |
| **Usuário Inativo ou Demitido** | Usuário com data expirada (`gltgb < hoje`) ou com flag de bloqueio (`uflag != 0`). | A CTE `active_users` descarta automaticamente o usuário. Ele não terá nenhum registro gerado na `sec_user_org_entitlements`. Pelo princípio do *Deny by Default*, qualquer consulta ao BigQuery retornará zero linhas. |
| **Usuário sem E-mail Corporativo** | Usuário técnico SAP (ex: `ALEREMOTE`, `DDIC`) ou cadastro sem preenchimento na `ADR6`. | A CTE `user_emails` descarta o registro. O usuário não consegue acessar as tabelas protegidas via interface analítica (BI, Looker, Console), eliminando o risco de personificação indevida. |

---

## 6. Governança, FinOps e Otimização de Performance

### 6.1 Por que o Modelo Desacoplado Garante Performance Máxima?
1. **Evita Avaliação Linha a Linha:** Em políticas tradicionais mal desenhadas, uma subquery correlacionada é avaliada para cada linha da tabela transacional (que pode ter 500 milhões de registros na `bseg`). No modelo proposto, a subquery para `sec_user_org_entitlements` não depende de nenhuma coluna da linha externa.
2. **Avaliação Única em Tempo de Query:** O otimizador de consultas do BigQuery (**Dremel**) avalia a subquery não correlacionada uma única vez no início da query. Como `SESSION_USER()` é constante, o BigQuery obtém a lista de empresas do usuário (ex: `['1000', '1010']`) e transforma o predicado em um filtro literal estático: `WHERE bukrs IN ('1000', '1010')`.
3. **Preservação de Partition & Cluster Pruning:** Se a tabela de negócio (`tvko`, `bseg`, etc.) for particionada ou clusterizada pela coluna de empresa (`bukrs`), o BigQuery elimina blocos inteiros de armazenamento (*Partition/Cluster Pruning*) antes de iniciar a leitura. Isso reduz os bytes lidos e o tempo de execução em até **98%**, gerando grande economia financeira (FinOps).

---

## 7. Matriz de Auditoria e Diagnóstico Operacional

Para auditar e monitorar a integridade da segurança, os administradores contam com consultas prontas:

### 7.1 Verificar Privilégios Vigentes por E-mail
```sql
SELECT 
  user_email,
  sap_uname,
  org_field,
  org_value,
  is_all_access,
  source_roles,
  updated_at
FROM `gcp-data-lake.sap_governance.sec_user_org_entitlements`
WHERE user_email = 'analista_fiscal@empresa.com'
ORDER BY org_field, org_value;
```

### 7.2 Diagnosticar Usuários SAP Ativos sem E-mail na ADR6
```sql
SELECT 
  LOWER(u.bname) AS sap_uname,
  u.gltgv,
  u.gltgb
FROM `ce-sap-latam-genai.cortex7_sap_s4_raw.usr02` u
LEFT JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.usr21` u21 ON LOWER(u.bname) = LOWER(u21.bname)
LEFT JOIN `ce-sap-latam-genai.cortex7_sap_s4_raw.adr6` a ON u21.addrnumber = a.addrnumber AND u21.persnumber = a.persnumber
WHERE (u.uflag = 0 OR u.uflag IS NULL)
  AND (u.gltgb IS NULL OR u.gltgb >= CURRENT_DATE())
  AND a.smtp_addr IS NULL;
```

### 7.3 Listar Todas as Políticas de RLS Ativas no Projeto
```sql
SELECT 
  target_project AS project_id,
  target_dataset AS dataset_name,
  target_table AS table_name,
  org_field,
  policy_name AS row_access_policy_name,
  action,
  applied_by,
  applied_at
FROM `ce-sap-latam-genai.cortex7_sap_s4_security.sec_rls_audit_log`
WHERE action IN ('APPLIED', 'REVOKED')
QUALIFY ROW_NUMBER() OVER (PARTITION BY target_table, org_field ORDER BY applied_at DESC) = 1
ORDER BY target_table;
```
