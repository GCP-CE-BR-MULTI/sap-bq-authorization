import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ReactECharts from 'echarts-for-react';
import {
  Shield,
  Users,
  Table2,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  Trash2,
  Play,
  Lock,
  Unlock,
  X,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Sparkles,
  Key,
  Layers,
  Eye,
  Code,
  UserCheck,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDateTime, formatNumber } from '../utils/formatters';

export default function ProfilesView({ activeSubmenu, setActiveSubmenu }) {
  const { activeConnection, rbac, darkMode, chartColors, showToast } = useApp();

  const canManageEntitlements = rbac?.permissions?.can_manage_entitlements !== false;
  const canApplyRls = rbac?.permissions?.can_apply_rls !== false;
  const canRevokeRls = rbac?.permissions?.can_revoke_rls !== false;

  // Submenu state ('roles' | 'access-matrix' | 'rls-matrix')
  const currentTab = activeSubmenu || 'roles';

  // Data states
  const [rolesData, setRolesData] = useState({ roles: [], master_profiles: [] });
  const [accessData, setAccessData] = useState({
    raw_entitlements: [],
    pivoted_users: [],
    custom_group_mappings: [],
    org_fields: [],
    companies: [],
  });
  const [rlsData, setRlsData] = useState({ tables: [], audit_logs: [] });

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

  // Filters & Selection
  const [searchQuery, setSearchQuery] = useState('');
  const [roleTypeFilter, setRoleTypeFilter] = useState('ALL');
  const [rlsStatusFilter, setRlsStatusFilter] = useState('ALL');
  const [orgFieldFilter, setOrgFieldFilter] = useState('ALL');

  // Slide-over inspection panel state
  const [selectedRole, setSelectedRole] = useState(null);
  const [selectedTableRls, setSelectedTableRls] = useState(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Modal for adding Group/User Entitlement Mapping
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMapping, setNewMapping] = useState({
    principal: 'group:gcp-financas-copel@copel.com',
    principal_type: 'GROUP',
    description: 'Analistas Financeiros Copel',
    sap_role_binding: 'Z_SAP_AUTH_FI',
    org_field: 'bukrs',
    org_values_str: '1010, 1710',
    is_all_access: false,
    sync_to_bigquery: true,
  });

  // Live RLS Simulator state inside Access Matrix
  const [simEmail, setSimEmail] = useState('fchagas@felipechagas.altostrat.com');
  const [simTable, setSimTable] = useState('bkpf');
  const [simField, setSimField] = useState('bukrs');
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState(null);

  const fetchCurrentTab = useCallback(async () => {
    setLoading(true);
    try {
      if (currentTab === 'roles') {
        const res = await axios.get('/api/profiles/roles');
        setRolesData(res.data);
      } else if (currentTab === 'access-matrix') {
        const res = await axios.get('/api/profiles/access-matrix');
        setAccessData(res.data);
      } else if (currentTab === 'rls-matrix' || currentTab === 'rls-bulk') {
        const res = await axios.get('/api/profiles/rls-matrix');
        setRlsData(res.data);
      }
    } catch (err) {
      showToast(
        err.response?.data?.detail || 'Erro ao consultar catálogo de segurança no BigQuery',
        'error'
      );
    } finally {
      setLoading(false);
    }
  }, [currentTab, showToast]);

  useEffect(() => {
    setPage(1);
    setSelectedRole(null);
    setSelectedTableRls(null);
    fetchCurrentTab();
  }, [currentTab, activeConnection?.id, fetchCurrentTab]);

  // Trigger sp_refresh_sap_entitlements directly
  const handleRefreshEntitlementsNow = async () => {
    if (!canManageEntitlements) {
      showToast('Seu perfil não possui permissão para atualizar entitlements.', 'error');
      return;
    }
    setActionLoading('refresh_ent');
    try {
      await axios.post('/api/setup/execute/step_5_refresh', { pilot_only: true });
      await fetchCurrentTab();
      showToast('Tabela sec_user_org_entitlements sincronizada com o SAP!', 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao atualizar entitlements', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateMapping = async (e) => {
    e.preventDefault();
    setActionLoading('create_mapping');
    try {
      const payload = {
        ...newMapping,
        org_values: newMapping.org_values_str
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      await axios.post('/api/profiles/group-mappings', payload);
      setShowAddModal(false);
      await fetchCurrentTab();
      showToast('Regra de acesso adicionada e sincronizada com o BigQuery!', 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao adicionar concessão', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteMapping = async (id) => {
    try {
      await axios.delete(`/api/profiles/group-mappings/${id}`);
      await fetchCurrentTab();
      showToast('Mapeamento de grupo removido.', 'info');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao remover mapeamento', 'error');
    }
  };

  const handleTableRlsAction = async (action, tableName, orgField) => {
    if (action === 'APPLY' && !canApplyRls) {
      showToast('Seu perfil não possui permissão para aplicar RLS.', 'error');
      return;
    }
    if (action === 'REVOKE' && !canRevokeRls) {
      showToast('Seu perfil não possui permissão para revogar RLS.', 'error');
      return;
    }
    const key = `${action}_${tableName}_${orgField}`;
    setActionLoading(key);
    try {
      const res = await axios.post('/api/profiles/rls-matrix/action', {
        action,
        table_name: tableName,
        org_field: orgField,
      });
      await fetchCurrentTab();
      showToast(
        `Política ${res.data.policy_name} (${action === 'APPLY' ? 'APLICADA' : 'REVOGADA'}) na tabela ${tableName.toUpperCase()}!`,
        action === 'APPLY' ? 'success' : 'info'
      );
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao executar DDL de RLS', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeAllRls = async (targetOrgField) => {
    if (!canRevokeRls) {
      showToast('Seu perfil não possui permissão para revogar políticas.', 'error');
      return;
    }
    const fieldToRevoke = targetOrgField || (orgFieldFilter !== 'ALL' ? orgFieldFilter : 'bukrs');
    const confirmed = window.confirm(
      `ATENÇÃO: Deseja realmente revogar TODAS as políticas de Row-Level Security para o campo "${fieldToRevoke.toUpperCase()}" em todo o dataset?\n\nEsta operação executará sp_revoke_sap_rls com DROP ALL nas tabelas afetadas.`
    );
    if (!confirmed) return;

    setActionLoading(`REVOKE_ALL_${fieldToRevoke}`);
    try {
      const res = await axios.post('/api/profiles/rls-matrix/revoke-all', {
        org_field: fieldToRevoke,
      });
      await fetchCurrentTab();
      showToast(
        `Rollback concluído! ${res.data.total_revoked} tabelas tiveram suas políticas de ${fieldToRevoke.toUpperCase()} revogadas via DROP ALL / IF EXISTS.`,
        'success'
      );
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao revogar políticas em lote', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // State and Handler for Module 4: Aplicação Massiva de RLS por Nível Organizacional
  const [bulkOrgField, setBulkOrgField] = useState('bukrs');
  const [bulkGrantees, setBulkGrantees] = useState('');
  const [bulkExecutionResult, setBulkExecutionResult] = useState(null);

  const handleApplyBulkRls = async () => {
    if (!canApplyRls) {
      showToast('Seu perfil não possui permissão para aplicar RLS em lote.', 'error');
      return;
    }
    const confirmed = window.confirm(
      `Confirma a aplicação massiva de Row Access Policies para o nível "${bulkOrgField.toUpperCase()}" em TODAS as tabelas elegíveis do dataset "${activeConnection?.raw_dataset || 'raw'}"?\n\nIsso criará ou atualizará as políticas RLS usando sp_apply_sap_rls no BigQuery.`
    );
    if (!confirmed) return;

    setActionLoading(`APPLY_BULK_${bulkOrgField}`);
    try {
      const res = await axios.post('/api/profiles/rls-matrix/apply-all', {
        org_field: bulkOrgField,
        grantees: bulkGrantees,
      });
      setBulkExecutionResult(res.data);
      await fetchCurrentTab();
      showToast(
        `RLS Massivo Aplicado com Sucesso! ${res.data.total_applied} tabelas com ${bulkOrgField.toUpperCase()} foram protegidas no BigQuery.`,
        'success'
      );
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao aplicar RLS massivo', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunSimulator = async (e) => {
    if (e) e.preventDefault();
    setSimLoading(true);
    try {
      const res = await axios.post('/api/simulator/run', {
        user_email: simEmail,
        table_name: simTable,
        org_field: simField,
      });
      setSimResult(res.data);
      showToast(`Simulação RLS executada na tabela ${simTable.toUpperCase()}!`, 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao executar simulação', 'error');
    } finally {
      setSimLoading(false);
    }
  };

  // Filtered lists
  const filteredRoles = (rolesData.roles || []).filter((r) => {
    const matchesSearch =
      !searchQuery ||
      r.role_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.assigned_users || []).some(
        (u) =>
          u.sap_uname?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          u.user_email?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    const matchesType = roleTypeFilter === 'ALL' || r.role_type === roleTypeFilter;
    return matchesSearch && matchesType;
  });

  const filteredRlsTables = (rlsData.tables || []).filter((t) => {
    const matchesSearch =
      !searchQuery ||
      t.table_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.policy_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = rlsStatusFilter === 'ALL' || t.rls_status === rlsStatusFilter;
    const matchesField = orgFieldFilter === 'ALL' || t.org_field === orgFieldFilter;
    return matchesSearch && matchesStatus && matchesField;
  });

  const totalPages =
    currentTab === 'roles'
      ? Math.max(1, Math.ceil(filteredRoles.length / pageSize))
      : Math.max(1, Math.ceil(filteredRlsTables.length / pageSize));

  const paginatedRoles = filteredRoles.slice((page - 1) * pageSize, page * pageSize);
  const paginatedRlsTables = filteredRlsTables.slice((page - 1) * pageSize, page * pageSize);

  // Charts
  const topRolesChart = {
    color: chartColors,
    tooltip: {
      trigger: 'axis',
      backgroundColor: darkMode ? '#18181b' : 'rgba(255,255,255,0.96)',
      borderColor: darkMode ? '#27272a' : '#dadce0',
      textStyle: { color: darkMode ? '#f4f4f5' : '#202124' },
    },
    legend: {
      top: 0,
      right: 8,
      textStyle: { color: darkMode ? '#a1a1aa' : '#5f6368', fontSize: 11 },
    },
    grid: { left: 16, right: 16, bottom: 16, top: 34, containLabel: true },
    xAxis: {
      type: 'category',
      data: (rolesData.roles || []).slice(0, 12).map((r) => r.role_name),
      axisLabel: {
        color: darkMode ? '#a1a1aa' : '#5f6368',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        rotate: 18,
      },
    },
    yAxis: {
      type: 'value',
      name: 'Regras / Objetos',
      nameTextStyle: {
        color: darkMode ? '#a1a1aa' : '#5f6368',
        align: 'left',
        padding: [0, 0, 4, 0],
      },
      axisLabel: { color: darkMode ? '#a1a1aa' : '#5f6368' },
      splitLine: { lineStyle: { color: darkMode ? '#27272a' : '#f1f3f4' } },
    },
    series: [
      {
        name: 'Níveis Org ($agr_1252)',
        type: 'bar',
        stack: 'total',
        barWidth: '40%',
        data: (rolesData.roles || []).slice(0, 12).map((r) => r.org_rules_count),
      },
      {
        name: 'Objetos Auth (agr_1251)',
        type: 'bar',
        stack: 'total',
        data: (rolesData.roles || []).slice(0, 12).map((r) => r.auth_objects_count),
      },
    ],
  };

  const rlsFieldSummary = ['bukrs', 'werks', 'vkorg', 'ekorg', 'gsber', 'prctr'].map((fld) => {
    const tbls = (rlsData.tables || []).filter((t) => t.org_field === fld);
    const applied = tbls.filter((t) => t.rls_status === 'APPLIED').length;
    const unprotected = tbls.length - applied;
    return { field: fld.toUpperCase(), applied, unprotected, total: tbls.length };
  });

  const rlsCoverageChart = {
    color: [chartColors[1] || '#1e8e3e', chartColors[2] || '#f9ab00'],
    tooltip: {
      trigger: 'axis',
      backgroundColor: darkMode ? '#18181b' : 'rgba(255,255,255,0.96)',
      borderColor: darkMode ? '#27272a' : '#dadce0',
      textStyle: { color: darkMode ? '#f4f4f5' : '#202124' },
    },
    legend: {
      top: 0,
      right: 8,
      textStyle: { color: darkMode ? '#a1a1aa' : '#5f6368', fontSize: 11 },
    },
    grid: { left: 16, right: 16, bottom: 12, top: 34, containLabel: true },
    xAxis: {
      type: 'category',
      data: rlsFieldSummary.map((x) => x.field),
      axisLabel: {
        color: darkMode ? '#a1a1aa' : '#5f6368',
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 600,
      },
    },
    yAxis: {
      type: 'value',
      name: 'Tabelas SAP Raw',
      nameTextStyle: {
        color: darkMode ? '#a1a1aa' : '#5f6368',
        align: 'left',
        padding: [0, 0, 4, 0],
      },
      axisLabel: { color: darkMode ? '#a1a1aa' : '#5f6368' },
      splitLine: { lineStyle: { color: darkMode ? '#27272a' : '#f1f3f4' } },
    },
    series: [
      {
        name: 'Com Política RLS Ativa (APPLIED)',
        type: 'bar',
        stack: 'rls',
        barWidth: '38%',
        data: rlsFieldSummary.map((x) => x.applied),
      },
      {
        name: 'Desprotegida / Elegível',
        type: 'bar',
        stack: 'rls',
        data: rlsFieldSummary.map((x) => x.unprotected),
      },
    ],
  };

  const matrixOrgFields = ['bukrs', 'werks', 'vkorg', 'ekorg', 'gsber', 'prctr'];

  return (
    <div className="space-y-5">
      {/* Header & Submenu Navigation */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
        <div className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[#dadce0] dark:border-zinc-800">
          <div>
            <h1 className="text-lg font-semibold text-[#202124] dark:text-zinc-50">
              Perfis SAP (PFCG), Matriz de Acesso e Políticas RLS
            </h1>
            <p className="text-xs text-[#5f6368] dark:text-zinc-400 mt-0.5 max-w-2xl">
              Inspecione as roles importadas do SAP, gerencie concessões por usuário ou grupo IAM em <code className="font-mono">sec_user_org_entitlements</code> e aplique políticas RLS por tabela.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRefreshEntitlementsNow}
              disabled={actionLoading === 'refresh_ent' || !canManageEntitlements}
              className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 hover:bg-[#f8f9fa] dark:hover:bg-zinc-800 text-[#202124] dark:text-zinc-200 border border-[#dadce0] dark:border-zinc-700 rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#1a73e8] shrink-0 ${
                  actionLoading === 'refresh_ent' ? 'animate-spin' : ''
                }`}
              />
              <span>Sincronizar entitlements SAP</span>
            </button>

            <button
              type="button"
              onClick={fetchCurrentTab}
              disabled={loading}
              className="inline-flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span>Atualizar dados</span>
            </button>
          </div>
        </div>

        {/* Submenu Tabs */}
        <div className="px-5 bg-[#f8f9fa]/60 dark:bg-zinc-900/40 flex flex-wrap items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveSubmenu('roles')}
            className={`py-2.5 text-xs font-semibold inline-flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              currentTab === 'roles'
                ? 'border-[#1a73e8] text-[#1a73e8] dark:text-blue-400'
                : 'border-transparent text-[#5f6368] hover:text-[#202124] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <Key className="w-3.5 h-3.5 shrink-0" />
            <span>Roles criadas (PFCG e SAP_ALL)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubmenu('access-matrix')}
            className={`py-2.5 text-xs font-semibold inline-flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              currentTab === 'access-matrix'
                ? 'border-[#1a73e8] text-[#1a73e8] dark:text-blue-400'
                : 'border-transparent text-[#5f6368] hover:text-[#202124] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span>Matriz de acesso (Usuários e Grupos × Níveis Org)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubmenu('rls-matrix')}
            className={`py-2.5 text-xs font-semibold inline-flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              currentTab === 'rls-matrix'
                ? 'border-[#1a73e8] text-[#1a73e8] dark:text-blue-400'
                : 'border-transparent text-[#5f6368] hover:text-[#202124] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <Table2 className="w-3.5 h-3.5 shrink-0" />
            <span>Matriz de RLS por tabela</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubmenu('rls-bulk')}
            className={`py-2.5 text-xs font-semibold inline-flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              currentTab === 'rls-bulk'
                ? 'border-[#1a73e8] text-[#1a73e8] dark:text-blue-400'
                : 'border-transparent text-[#5f6368] hover:text-[#202124] dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#1e8e3e]" />
            <span>Aplicação RLS por Nível Org</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          SUBMENU 1: VER AS ROLES CRIADAS (PFCG)
         ===================================================================== */}
      {currentTab === 'roles' && (
        <div className="space-y-5">
          {/* Chart */}
          <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
                  Regras organizacionais (<code className="font-mono">agr_1252</code>) e objetos de autorização (<code className="font-mono">agr_1251</code>) por role SAP
                </h2>
                <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                  Selecione qualquer role na tabela abaixo para inspecionar usuários e objetos vinculados
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-[#5f6368] bg-[#f8f9fa] border border-[#dadce0] px-2.5 py-0.5 rounded">
                {(rolesData.roles || []).length} roles PFCG
              </span>
            </div>
            <ReactECharts option={topRolesChart} style={{ height: '230px', width: '100%' }} />
          </div>

          {/* Main Content Split: Table + Sliding Details Side Panel */}
          <div className="flex flex-col lg:flex-row gap-5 items-start">
            <div
              className={`bg-white dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden transition-all duration-300 ${
                selectedRole ? 'w-full lg:w-2/3' : 'w-full'
              }`}
            >
              {/* Toolbar */}
              <div className="p-3.5 border-b border-[#dadce0] dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 relative z-30">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="w-4 h-4 text-[#5f6368] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Buscar por role SAP (ex: Z_SAP_AUTH_FI) ou usuário..."
                    className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded pl-9 pr-3 py-1.5 text-xs text-[#202124] dark:text-zinc-100"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={roleTypeFilter}
                    onChange={(e) => {
                      setRoleTypeFilter(e.target.value);
                      setPage(1);
                    }}
                    className="bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs text-[#202124] dark:text-zinc-200"
                  >
                    <option value="ALL">Todos os tipos de role</option>
                    <option value="SINGLE_ROLE">Single role (simples)</option>
                    <option value="COMPOSITE_ROLE">Composite role (composta)</option>
                  </select>
                </div>
              </div>

              {/* Roles Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#f8f9fa] dark:bg-zinc-900 z-10 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800 whitespace-nowrap">
                    <tr>
                      <th className="py-2.5 px-4">Role SAP (<code className="font-mono">agr_name</code>)</th>
                      <th className="py-2.5 px-4">Tipo no PFCG</th>
                      <th className="py-2.5 px-4 text-right">Usuários atribuídos</th>
                      <th className="py-2.5 px-4 text-right">Níveis org (<code className="font-mono">1252</code>)</th>
                      <th className="py-2.5 px-4 text-right">Objetos auth (<code className="font-mono">1251</code>)</th>
                      <th className="py-2.5 px-4">Valores organizacionais</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1f3f4] dark:divide-zinc-800 text-xs">
                    {paginatedRoles.map((role) => {
                      const isSelected = selectedRole?.role_name === role.role_name;
                      const orgSample = (role.org_values || []).slice(0, 3);
                      return (
                        <tr
                          key={role.role_name}
                          onClick={() => setSelectedRole(role)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#e8f0fe]/70 dark:bg-blue-900/40 hover:bg-[#e8f0fe]'
                              : 'hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60'
                          }`}
                        >
                          <td className="py-3 px-4 font-mono font-bold text-[#1a73e8] dark:text-blue-400 whitespace-nowrap">
                            {role.role_name}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {role.role_type === 'COMPOSITE_ROLE' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#fef7e0] text-[#b06000] whitespace-nowrap">
                                Role Composta ({role.child_roles?.length || 0} filhas)
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#e8f0fe] text-[#1a73e8] whitespace-nowrap">
                                Single Role
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-[#202124] dark:text-zinc-200">
                            {role.user_count}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#202124] dark:text-zinc-200">
                            {role.org_rules_count}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#5f6368] dark:text-zinc-400">
                            {role.auth_objects_count}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {orgSample.length === 0 ? (
                                <span className="text-[#80868b]">—</span>
                              ) : (
                                orgSample.map((ov, idx) => (
                                  <span
                                    key={idx}
                                    className="px-1.5 py-0.5 rounded bg-[#f1f3f4] dark:bg-zinc-800 font-mono text-[11px] text-[#202124] dark:text-zinc-200 whitespace-nowrap"
                                  >
                                    {ov.org_field}: {ov.val_low}
                                    {ov.val_high ? `..${ov.val_high}` : ''}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls (Icon-only per framework rules) */}
              <div className="px-4 py-3 border-t border-[#dadce0] dark:border-zinc-800 flex items-center justify-between text-xs text-[#5f6368] dark:text-zinc-400">
                <span>
                  Exibindo {paginatedRoles.length} de {filteredRoles.length} roles SAP
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Slide-Over Inspection Panel for Selected Role */}
            {selectedRole && (
              <div className="w-full lg:w-1/3 bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-xl p-5 shadow-sm transition-all duration-300 space-y-4">
                <div className="flex items-start justify-between border-b border-[#dadce0] dark:border-zinc-800 pb-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#1a73e8]">
                      Inspeção de Role SAP PFCG
                    </span>
                    <h4 className="text-base font-bold font-mono text-[#202124] dark:text-zinc-100 mt-0.5">
                      {selectedRole.role_name}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedRole(null)}
                    className="p-1 rounded-lg hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 text-[#5f6368]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Users Assigned */}
                <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-bold text-[#202124] dark:text-zinc-100">
                    Usuários Vinculados na AGR_USERS ({selectedRole.user_count})
                  </div>
                  {(selectedRole.assigned_users || []).length === 0 ? (
                    <div className="text-xs text-[#5f6368]">Nenhum usuário diretamente atribuído.</div>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {(selectedRole.assigned_users || []).map((u, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-xs bg-white dark:bg-zinc-800 px-2.5 py-1.5 rounded border border-[#dadce0] dark:border-zinc-700"
                        >
                          <span className="font-mono font-bold text-[#202124] dark:text-zinc-200">
                            {u.sap_uname}
                          </span>
                          <span className="font-mono text-[11px] text-[#1a73e8] dark:text-blue-400">
                            {u.user_email || 'Sem e-mail ADR6'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Org Values (AGR_1252) */}
                <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-bold text-[#202124] dark:text-zinc-100">
                    Níveis Organizacionais na AGR_1252 ({selectedRole.org_rules_count})
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
                    {(selectedRole.org_values || []).length === 0 ? (
                      <span className="text-xs text-[#5f6368]">Sem variáveis $ na AGR_1252.</span>
                    ) : (
                      (selectedRole.org_values || []).map((ov, i) => (
                        <span
                          key={i}
                          className={`px-2 py-1 rounded text-xs font-mono border ${
                            ov.val_low === '*'
                              ? 'bg-[#e6f4ea] text-[#1e8e3e] border-[#ceead6]'
                              : 'bg-white dark:bg-zinc-800 text-[#202124] dark:text-zinc-200 border-[#dadce0] dark:border-zinc-700'
                          }`}
                        >
                          <strong>{ov.org_field}</strong> = {ov.val_low}
                          {ov.val_high ? ` ATÉ ${ov.val_high}` : ''}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Auth Objects (AGR_1251) */}
                <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-bold text-[#202124] dark:text-zinc-100">
                    Objetos de Autorização na AGR_1251 ({selectedRole.auth_objects_count})
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto text-xs font-mono">
                    {(selectedRole.auth_fields || []).slice(0, 20).map((af, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between bg-white dark:bg-zinc-800 px-2.5 py-1 rounded border border-[#dadce0] dark:border-zinc-700"
                      >
                        <span className="text-[#5f6368] dark:text-zinc-400">{af.auth_object}</span>
                        <span className="text-[#1a73e8] dark:text-blue-400">
                          {af.field_name}: {af.val_low}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 2: MATRIZ DE ACESSO PARA CADA GRUPO OU USUÁRIO + SIMULADOR
         ===================================================================== */}
      {currentTab === 'access-matrix' && (
        <div className="space-y-5">
          {/* Matrix Header & Add Mapping Button */}
          <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
            <div className="p-5 border-b border-[#dadce0] dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
                  Matriz consolidada de entitlements por usuário SAP e grupo IAM
                </h2>
                <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                  Visão pivotada de <code className="font-mono">sec_user_org_entitlements</code> cruzando identidades com os níveis organizacionais do SAP (<code className="font-mono">bukrs</code>, <code className="font-mono">werks</code>, <code className="font-mono">vkorg</code>, <code className="font-mono">ekorg</code>, <code className="font-mono">gsber</code>, <code className="font-mono">prctr</code>).
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                disabled={!canManageEntitlements}
                className="inline-flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Vincular grupo IAM ou usuário</span>
              </button>
            </div>

            {/* Pivoted Access Matrix Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f8f9fa] dark:bg-zinc-900 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800 whitespace-nowrap">
                  <tr>
                    <th className="py-2.5 px-4">Identidade (<code className="font-mono">SESSION_USER</code> / IAM)</th>
                    <th className="py-2.5 px-4">Usuário SAP (<code className="font-mono">bname</code>)</th>
                    <th className="py-2.5 px-4">Roles de origem</th>
                    {matrixOrgFields.map((fld) => (
                      <th key={fld} className="py-2.5 px-4 font-mono text-center">
                        {fld}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#dadce0]/60 dark:divide-zinc-800 text-xs">
                  {/* SAP Synced Users */}
                  {(accessData.pivoted_users || []).map((u) => (
                    <tr
                      key={u.principal}
                      className="hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-semibold text-[#1a73e8] dark:text-blue-400">
                          {u.principal}
                        </div>
                        <div className="text-[11px] text-[#5f6368] dark:text-zinc-400 tabular-nums">
                          Sincronizado em {formatDateTime(u.updated_at)}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#f8f9fa] border border-[#dadce0] text-[#202124] font-mono text-[11px] font-medium whitespace-nowrap">
                          {u.sap_uname}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {(u.source_roles || []).map((sr) => (
                            <span
                              key={sr}
                              className="px-1.5 py-0.5 rounded bg-[#f1f3f4] dark:bg-zinc-800 font-mono text-[10px] text-[#202124] dark:text-zinc-200 whitespace-nowrap"
                            >
                              {sr}
                            </span>
                          ))}
                        </div>
                      </td>
                      {matrixOrgFields.map((fld) => {
                        const cell = u.fields?.[fld];
                        const isSuper = u.is_superuser || cell?.is_all_access;
                        const vals = cell?.values || [];
                        return (
                          <td key={fld} className="py-3 px-4 text-center whitespace-nowrap">
                            {isSuper ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-[#fef7e0] text-[#b06000] border border-[#feefc3] whitespace-nowrap">
                                * (Acesso total)
                              </span>
                            ) : vals.length > 0 ? (
                              <div className="flex flex-wrap justify-center gap-1">
                                {vals.map((v) => (
                                  <span
                                    key={v}
                                    className="px-2 py-0.5 rounded bg-[#e8f0fe] text-[#1a73e8] font-mono font-semibold text-[11px] whitespace-nowrap"
                                  >
                                    {v}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-[#80868b]">Bloqueado</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* IAM Group Mappings */}
                  {(accessData.custom_group_mappings || []).map((grp) => (
                    <tr
                      key={grp.id}
                      className="bg-[#f8f9fa]/50 dark:bg-zinc-900/40 hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60 transition-colors"
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-[#202124] dark:text-zinc-100">
                            {grp.principal}
                          </span>
                          {canManageEntitlements && (
                            <button
                              type="button"
                              onClick={() => handleDeleteMapping(grp.id)}
                              className="text-[#80868b] hover:text-[#d93025] transition-colors shrink-0"
                              title="Remover grupo"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="text-[11px] text-[#5f6368] dark:text-zinc-400">
                          {grp.description}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#f1f3f4] text-[#5f6368] font-mono text-[11px] font-medium whitespace-nowrap">
                          IAM {grp.principal_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded bg-[#f1f3f4] dark:bg-zinc-800 font-mono text-[10px] whitespace-nowrap">
                          {grp.sap_role_binding}
                        </span>
                      </td>
                      {matrixOrgFields.map((fld) => {
                        const applies = grp.org_field === '*' || grp.org_field === fld;
                        return (
                          <td key={fld} className="py-3 px-4 text-center whitespace-nowrap">
                            {applies && grp.is_all_access ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-[#fef7e0] text-[#b06000] border border-[#feefc3] whitespace-nowrap">
                                * (Acesso total)
                              </span>
                            ) : applies ? (
                              <div className="flex flex-wrap justify-center gap-1">
                                {(grp.org_values || []).map((v) => (
                                  <span
                                    key={v}
                                    className="px-2 py-0.5 rounded bg-[#e8f0fe] text-[#1a73e8] font-mono font-semibold text-[11px] whitespace-nowrap"
                                  >
                                    {v}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-[#80868b]">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Interactive RLS Simulator Workbench ("Test as User") */}
          <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
            <div className="px-5 py-4 bg-[#f8f9fa] dark:bg-zinc-900 border-b border-[#dadce0] dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
                  Simulador de política RLS no BigQuery ("Test as User")
                </h2>
                <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                  Execute uma consulta real no BigQuery simulando o filtro <code className="font-mono">SESSION_USER()</code> de qualquer identidade para verificar linhas liberadas e bloqueadas.
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <form onSubmit={handleRunSimulator} className="grid grid-cols-1 md:grid-cols-4 gap-3.5 items-end">
                <div>
                  <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                    Identidade simulada (<code className="font-mono">SESSION_USER</code>)
                  </label>
                  <input
                    type="text"
                    value={simEmail}
                    onChange={(e) => setSimEmail(e.target.value)}
                    list="sim-users-list"
                    className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                  />
                  <datalist id="sim-users-list">
                    {(accessData.pivoted_users || []).map((u) => (
                      <option key={u.principal} value={u.principal} />
                    ))}
                    <option value="usuario.bloqueado@copel.com" />
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                    Tabela SAP alvo
                  </label>
                  <select
                    value={simTable}
                    onChange={(e) => setSimTable(e.target.value)}
                    className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                  >
                    <option value="bkpf">bkpf (Cabeçalho contábil)</option>
                    <option value="bseg">bseg (Segmentos contábeis)</option>
                    <option value="acdoca">acdoca (Universal Journal)</option>
                    <option value="tvko">tvko (Organizações de vendas)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                    Coluna organizacional
                  </label>
                  <select
                    value={simField}
                    onChange={(e) => setSimField(e.target.value)}
                    className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                  >
                    <option value="bukrs">bukrs (Empresa)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={simLoading}
                  className="inline-flex items-center justify-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded px-4 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                  <span>{simLoading ? 'Executando simulação...' : 'Simular consulta RLS'}</span>
                </button>
              </form>

              {simResult && (
                <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-[#dadce0] dark:divide-zinc-800">
                    <div className="pr-3">
                      <div className="text-xs text-[#5f6368] dark:text-zinc-400">
                        Linhas visíveis pelo usuário vs total da tabela
                      </div>
                      <div className="text-base font-semibold font-mono tabular-nums text-[#202124] dark:text-zinc-100 mt-1">
                        {formatNumber(simResult.summary?.visible_rows)} de {formatNumber(simResult.summary?.total_rows)} linhas
                      </div>
                      <div className="mt-2 w-full bg-[#dadce0] dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#1e8e3e] h-full"
                          style={{
                            width: `${
                              simResult.summary?.total_rows
                                ? Math.round(
                                    (simResult.summary.visible_rows / simResult.summary.total_rows) * 100
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="sm:px-4 pt-3 sm:pt-0">
                      <div className="text-xs text-[#5f6368] dark:text-zinc-400">
                        Valores liberados (<code className="font-mono">{simResult.org_field}</code>)
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(simResult.summary?.visible_org_values || []).length === 0 ? (
                          <span className="px-2 py-0.5 rounded bg-[#fce8e6] text-[#d93025] text-xs font-medium">
                            Nenhuma empresa autorizada (0 linhas)
                          </span>
                        ) : (
                          (simResult.summary?.visible_org_values || []).map((v) => (
                            <span
                              key={v}
                              className="px-2 py-0.5 rounded bg-[#e6f4ea] text-[#1e8e3e] font-mono text-xs font-semibold"
                            >
                              {v}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="sm:pl-4 pt-3 sm:pt-0">
                      <div className="text-xs text-[#5f6368] dark:text-zinc-400">
                        Empresas existentes em <code className="font-mono">{simResult.table_name}</code>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(simResult.summary?.all_table_org_values || []).map((v) => (
                          <span
                            key={v}
                            className="px-2 py-0.5 rounded bg-white border border-[#dadce0] dark:bg-zinc-800 dark:border-zinc-700 font-mono text-xs text-[#5f6368] dark:text-zinc-300"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 3: MATRIZ DE RLS PARA CADA TABELA
         ===================================================================== */}
      {currentTab === 'rls-matrix' && (
        <div className="space-y-5">
          {/* Cobertura de RLS Chart */}
          <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
                  Cobertura de políticas Row-Level Security por nível organizacional
                </h2>
                <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                  Comparativo entre tabelas protegidas (<code className="font-mono">APPLIED</code>) e tabelas elegíveis descobertas via <code className="font-mono">INFORMATION_SCHEMA.COLUMNS</code>
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-[#1e8e3e] bg-[#e6f4ea] px-2.5 py-0.5 rounded font-semibold whitespace-nowrap shrink-0">
                {(rlsData.tables || []).filter((t) => t.rls_status === 'APPLIED').length} políticas ativas
              </span>
            </div>
            <ReactECharts option={rlsCoverageChart} style={{ height: '230px', width: '100%' }} />
          </div>

          {/* Main Content Split: RLS Table Matrix + Sliding DDL Inspector */}
          <div className="flex flex-col lg:flex-row gap-5 items-start">
            <div
              className={`bg-white dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden transition-all duration-300 ${
                selectedTableRls ? 'w-full lg:w-2/3' : 'w-full'
              }`}
            >
              {/* Toolbar */}
              <div className="p-3.5 border-b border-[#dadce0] dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 relative z-30">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-[#5f6368] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Buscar tabela SAP (ex: bkpf, bseg, acdoca, tvko, vbak)..."
                    className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded pl-9 pr-3 py-1.5 text-xs text-[#202124] dark:text-zinc-100"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={orgFieldFilter}
                    onChange={(e) => {
                      setOrgFieldFilter(e.target.value);
                      setPage(1);
                    }}
                    className="bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-200"
                  >
                    <option value="ALL">Todos os campos org</option>
                    <option value="bukrs">bukrs (Empresa)</option>
                    <option value="werks">werks (Centro)</option>
                    <option value="vkorg">vkorg (Org. Vendas)</option>
                    <option value="ekorg">ekorg (Org. Compras)</option>
                    <option value="gsber">gsber (Divisão)</option>
                    <option value="prctr">prctr (Centro Lucro)</option>
                  </select>

                  <select
                    value={rlsStatusFilter}
                    onChange={(e) => {
                      setRlsStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    className="bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs text-[#202124] dark:text-zinc-200"
                  >
                    <option value="ALL">Todos os estados RLS</option>
                    <option value="APPLIED">Protegida (APPLIED)</option>
                    <option value="UNPROTECTED">Desprotegida (elegível)</option>
                    <option value="REVOKED">Revogada (REVOKED)</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => handleRevokeAllRls(orgFieldFilter !== 'ALL' ? orgFieldFilter : 'bukrs')}
                    disabled={!canRevokeRls || actionLoading?.startsWith('REVOKE_ALL')}
                    title="Varre o dataset e revoga todas as políticas RLS para o campo selecionado utilizando DROP ALL ROW ACCESS POLICIES quando necessário."
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#fce8e6] hover:bg-[#fad2cf] text-[#d93025] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed border border-[#f5c2c7]"
                  >
                    <Unlock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {actionLoading?.startsWith('REVOKE_ALL')
                        ? 'Revogando em lote...'
                        : `Revogar todas RLS (${orgFieldFilter !== 'ALL' ? orgFieldFilter : 'bukrs'})`}
                    </span>
                  </button>
                </div>
              </div>

              {/* Table Matrix */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#f8f9fa] dark:bg-zinc-900 z-10 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800 whitespace-nowrap">
                    <tr>
                      <th className="py-2.5 px-4">Tabela SAP Raw</th>
                      <th className="py-2.5 px-4">Coluna org</th>
                      <th className="py-2.5 px-4 text-right">Linhas</th>
                      <th className="py-2.5 px-4">Política RLS</th>
                      <th className="py-2.5 px-4">Clustering FinOps</th>
                      <th className="py-2.5 px-4 text-center">Estado RLS</th>
                      <th className="py-2.5 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1f3f4] dark:divide-zinc-800 text-xs">
                    {paginatedRlsTables.map((row) => {
                      const rowKey = `${row.table_name}_${row.org_field}`;
                      const isSelected =
                        selectedTableRls &&
                        selectedTableRls.table_name === row.table_name &&
                        selectedTableRls.org_field === row.org_field;
                      const isApplying = actionLoading === `APPLY_${row.table_name}_${row.org_field}`;
                      const isRevoking = actionLoading === `REVOKE_${row.table_name}_${row.org_field}`;

                      return (
                        <tr
                          key={rowKey}
                          onClick={() => setSelectedTableRls(row)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#e8f0fe]/70 dark:bg-blue-900/40'
                              : 'hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60'
                          }`}
                        >
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-mono font-bold text-[#1a73e8] dark:text-blue-400 uppercase">
                              {row.table_name}
                            </div>
                            <div className="text-[11px] text-[#5f6368] dark:text-zinc-400">
                              {row.size_mb} MB
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded bg-[#f1f3f4] dark:bg-zinc-800 font-mono font-bold text-[#202124] dark:text-zinc-200">
                              {row.org_field}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#202124] dark:text-zinc-200 whitespace-nowrap">
                            {formatNumber(row.row_count)}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-[#5f6368] dark:text-zinc-300 whitespace-nowrap">
                            {row.policy_name}
                            {row.applied_at && (
                              <div className="text-[10px] text-[#80868b]">
                                {formatDateTime(row.applied_at)}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {row.is_org_clustered ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#e6f4ea] text-[#1e8e3e] whitespace-nowrap">
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                <span>Cluster ({row.clustering_fields})</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#fef7e0] text-[#b06000] whitespace-nowrap">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>Sem Cluster ({row.org_field})</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center whitespace-nowrap">
                            {row.rls_status === 'APPLIED' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#e6f4ea] text-[#1e8e3e] whitespace-nowrap">
                                <Lock className="w-3 h-3 shrink-0" />
                                <span>APPLIED</span>
                              </span>
                            ) : row.rls_status === 'REVOKED' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#fce8e6] text-[#d93025] whitespace-nowrap">
                                <Unlock className="w-3 h-3 shrink-0" />
                                <span>REVOKED</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#f1f3f4] dark:bg-zinc-800 text-[#5f6368] dark:text-zinc-400 whitespace-nowrap">
                                DESPROTEGIDA
                              </span>
                            )}
                          </td>
                          <td
                            className="py-3 px-4 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleTableRlsAction('APPLY', row.table_name, row.org_field)
                                }
                                disabled={isApplying || isRevoking || !canApplyRls}
                                className="px-2.5 py-1 rounded bg-[#1a73e8] hover:bg-[#1557b0] text-white text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isApplying ? 'Aplicando...' : 'Aplicar RLS'}
                              </button>
                              {row.rls_status === 'APPLIED' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleTableRlsAction('REVOKE', row.table_name, row.org_field)
                                  }
                                  disabled={isApplying || isRevoking || !canRevokeRls}
                                  className="px-2 py-1 rounded bg-[#fce8e6] hover:bg-[#fad2cf] text-[#d93025] text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isRevoking ? '...' : 'Revogar'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="px-4 py-3 border-t border-[#dadce0] dark:border-zinc-800 flex items-center justify-between text-xs text-[#5f6368] dark:text-zinc-400">
                <span>
                  Exibindo {paginatedRlsTables.length} de {filteredRlsTables.length} combinações Tabela × Coluna Org
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 font-mono">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="p-1.5 rounded hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Slide-Over Inspection Panel for Selected Table RLS */}
            {selectedTableRls && (
              <div className="w-full lg:w-1/3 bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-xl p-5 shadow-sm transition-all duration-300 space-y-4">
                <div className="flex items-start justify-between border-b border-[#dadce0] dark:border-zinc-800 pb-3">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#1a73e8]">
                      Inspeção de Política RLS & FinOps
                    </span>
                    <h4 className="text-base font-bold font-mono text-[#202124] dark:text-zinc-100 mt-0.5 uppercase">
                      {selectedTableRls.table_name} ({selectedTableRls.org_field})
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTableRls(null)}
                    className="p-1 rounded-lg hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 text-[#5f6368]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-lg p-3">
                    <div className="text-[#5f6368] dark:text-zinc-400">Nome da Row Access Policy</div>
                    <div className="font-mono font-bold text-[#1a73e8] dark:text-blue-400 mt-0.5">
                      {selectedTableRls.policy_name}
                    </div>
                  </div>

                  <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-lg p-3">
                    <div className="text-[#5f6368] dark:text-zinc-400">Grantees (GRANT TO)</div>
                    <div className="font-mono text-[#202124] dark:text-zinc-200 mt-0.5 break-all">
                      {selectedTableRls.grantees}
                    </div>
                  </div>

                  <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded-lg p-3">
                    <div className="text-[#5f6368] dark:text-zinc-400 mb-1">
                      Expressão de Filtro Não Correlacionada (FILTER USING)
                    </div>
                    <pre className="font-mono text-[11px] whitespace-pre-wrap bg-white dark:bg-zinc-950 p-2.5 rounded border border-[#dadce0] dark:border-zinc-800 text-[#202124] dark:text-zinc-200">
                      {selectedTableRls.filter_expression}
                    </pre>
                  </div>

                  {!selectedTableRls.is_org_clustered && (
                    <div className="bg-[#fef7e0] dark:bg-amber-900/20 border border-[#feefc3] dark:border-amber-800/40 rounded-lg p-3 text-[#b06000] dark:text-amber-300 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" /> Recomendação FinOps (Block Pruning)
                      </div>
                      <p className="text-[11px]">
                        Para otimizar o custo de leitura com RLS, clusterize a tabela por{' '}
                        <code className="font-mono font-bold">{selectedTableRls.org_field}</code>:
                      </p>
                      <pre className="font-mono text-[10px] bg-white/80 dark:bg-zinc-950 p-2 rounded">
                        {`CREATE OR REPLACE TABLE \`${activeConnection?.project_id}.${activeConnection?.raw_dataset}.${selectedTableRls.table_name}\`\nCLUSTER BY ${selectedTableRls.org_field}\nAS SELECT * FROM \`${activeConnection?.project_id}.${activeConnection?.raw_dataset}.${selectedTableRls.table_name}\`;`}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleTableRlsAction(
                        'APPLY',
                        selectedTableRls.table_name,
                        selectedTableRls.org_field
                      )
                    }
                    disabled={!canApplyRls}
                    className="flex-1 bg-[#1e8e3e] hover:bg-[#187031] text-white rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Aplicar / Atualizar Policy
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleTableRlsAction(
                        'REVOKE',
                        selectedTableRls.table_name,
                        selectedTableRls.org_field
                      )
                    }
                    disabled={!canRevokeRls}
                    className="flex-1 bg-[#d93025] hover:bg-[#b3261e] text-white rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    Revogar Policy
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUBMENU 4: APLICAÇÃO MASSIVA DE RLS POR NÍVEL ORGANIZACIONAL
         ===================================================================== */}
      {currentTab === 'rls-bulk' && (() => {
        const selectedFieldTables = (rlsData.tables || []).filter(
          (t) => t.org_field === bulkOrgField
        );
        const protectedCount = selectedFieldTables.filter((t) => t.rls_status === 'APPLIED').length;
        const unprotectedCount = selectedFieldTables.filter((t) => t.rls_status !== 'APPLIED').length;
        const totalRows = selectedFieldTables.reduce((acc, t) => acc + (t.row_count || 0), 0);
        const totalMb = selectedFieldTables.reduce((acc, t) => acc + (t.size_mb || 0), 0);

        return (
          <div className="space-y-5">
            {/* Header Card */}
            <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-6">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#e6f4ea] text-[#1e8e3e] mb-2">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Automação DDL Orientada a Metadados</span>
                  </div>
                  <h2 className="text-base font-bold text-[#202124] dark:text-zinc-50">
                    Aplicação Massiva de RLS por Nível Organizacional
                  </h2>
                  <p className="text-xs text-[#5f6368] dark:text-zinc-400 mt-1 max-w-3xl">
                    Selecione um nível organizacional SAP (ex: <code className="font-mono font-bold text-[#1a73e8]">bukrs</code>, <code className="font-mono font-bold text-[#1a73e8]">werks</code>) para varrer automaticamente o catálogo <code className="font-mono">INFORMATION_SCHEMA.COLUMNS</code> do dataset raw e aplicar políticas de Row Access em lote via procedure <code className="font-mono">sp_apply_sap_rls</code>.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRevokeAllRls(bulkOrgField)}
                    disabled={!canRevokeRls || actionLoading?.startsWith('REVOKE_ALL')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-[#fce8e6] hover:bg-[#fad2cf] text-[#d93025] text-xs font-semibold transition-colors whitespace-nowrap border border-[#fad2cf] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Unlock className="w-4 h-4 shrink-0" />
                    <span>
                      {actionLoading === `REVOKE_ALL_${bulkOrgField}`
                        ? 'Revogando...'
                        : `Revogar todas (${bulkOrgField.toUpperCase()})`}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleApplyBulkRls}
                    disabled={!canApplyRls || actionLoading?.startsWith('APPLY_BULK') || selectedFieldTables.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-semibold transition-colors shadow-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>
                      {actionLoading === `APPLY_BULK_${bulkOrgField}`
                        ? 'Aplicando DDL em lote...'
                        : `Aplicar RLS em todas (${selectedFieldTables.length} tabelas)`}
                    </span>
                  </button>
                </div>
              </div>

              {/* Selection Bar & Parameter Controls */}
              <div className="mt-6 pt-5 border-t border-[#dadce0] dark:border-zinc-800 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#202124] dark:text-zinc-200 mb-1.5">
                    Nível Organizacional SAP (Coluna Alvo):
                  </label>
                  <select
                    value={bulkOrgField}
                    onChange={(e) => setBulkOrgField(e.target.value)}
                    className="w-full bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-700 rounded px-3 py-2 text-xs font-mono font-bold text-[#1a73e8] dark:text-blue-400 focus:outline-none"
                  >
                    <option value="bukrs">bukrs — Empresa / Company Code (FI)</option>
                    <option value="werks">werks — Centro / Plant (MM/PP/SD)</option>
                    <option value="vkorg">vkorg — Organização de Vendas (SD)</option>
                    <option value="ekorg">ekorg — Organização de Compras (MM)</option>
                    <option value="gsber">gsber — Divisão de Negócio (FI/CO)</option>
                    <option value="prctr">prctr — Centro de Lucro (CO-PCA)</option>
                  </select>
                  <span className="text-[11px] text-[#5f6368] dark:text-zinc-400 mt-1 block">
                    Nome exato da coluna filtrada nas tabelas do dataset raw.
                  </span>
                </div>

                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-[#202124] dark:text-zinc-200">
                      Membros IAM Consumidores (<code className="font-mono font-normal">GRANT TO (...)</code>):
                    </label>
                    <span className="text-[11px] font-medium text-[#1e8e3e] dark:text-emerald-400 bg-[#e6f4ea] dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                      Deixe vazio para Modo Dinâmico ⚡
                    </span>
                  </div>
                  <input
                    type="text"
                    value={bulkGrantees}
                    onChange={(e) => setBulkGrantees(e.target.value)}
                    placeholder="Vazio = Coletar dinamicamente todos os usuários com acesso ativo da tabela sec_user_org_entitlements"
                    className="w-full bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-700 rounded px-3 py-2 text-xs font-mono text-[#202124] dark:text-zinc-100 focus:outline-none placeholder:text-[#80868b] placeholder:italic"
                  />
                  <span className="text-[11px] text-[#5f6368] dark:text-zinc-400 mt-1 block">
                    <strong>Modo Dinâmico Automático:</strong> Se nenhum usuário for informado, a Stored Procedure inspeciona <code className="font-mono">sec_user_org_entitlements</code> e injeta no <code className="font-mono">GRANT TO</code> todos os e-mails com permissão para este nível organizacional. Ou informe identidades específicas manualmente (ex: <code className="font-mono">'group:bi-analistas@copel.com'</code>).
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Metrics Bar for Selected Org Field */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-4">
                <div className="text-[11px] font-medium text-[#5f6368] dark:text-zinc-400 uppercase">
                  Tabelas com {bulkOrgField.toUpperCase()}
                </div>
                <div className="text-xl font-bold font-mono text-[#202124] dark:text-zinc-50 mt-1">
                  {selectedFieldTables.length}
                </div>
                <div className="text-[11px] text-[#5f6368] dark:text-zinc-500 mt-0.5">
                  Descobertas via COLUMNS
                </div>
              </div>

              <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-4">
                <div className="text-[11px] font-medium text-[#5f6368] dark:text-zinc-400 uppercase">
                  Políticas Ativas (APPLIED)
                </div>
                <div className="text-xl font-bold font-mono text-[#1e8e3e] mt-1">
                  {protectedCount}
                </div>
                <div className="text-[11px] text-[#1e8e3e] mt-0.5">
                  {selectedFieldTables.length > 0
                    ? `${Math.round((protectedCount / selectedFieldTables.length) * 100)}% protegidas`
                    : '0%'}
                </div>
              </div>

              <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-4">
                <div className="text-[11px] font-medium text-[#5f6368] dark:text-zinc-400 uppercase">
                  Tabelas Pendentes
                </div>
                <div className="text-xl font-bold font-mono text-[#b06000] mt-1">
                  {unprotectedCount}
                </div>
                <div className="text-[11px] text-[#b06000] mt-0.5">
                  Prontas para receber DDL
                </div>
              </div>

              <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-4">
                <div className="text-[11px] font-medium text-[#5f6368] dark:text-zinc-400 uppercase">
                  Volumetria Alvo
                </div>
                <div className="text-xl font-bold font-mono text-[#1a73e8] dark:text-blue-400 mt-1">
                  {formatNumber(totalRows)} lin
                </div>
                <div className="text-[11px] text-[#5f6368] dark:text-zinc-500 mt-0.5">
                  {Math.round(totalMb)} MB no dataset raw
                </div>
              </div>
            </div>

            {/* Execution Result Banner (if just executed) */}
            {bulkExecutionResult && (
              <div className="bg-[#e6f4ea] dark:bg-emerald-950/40 border border-[#ceead6] dark:border-emerald-800 rounded-md p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[#1e8e3e] shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-bold text-[#1e8e3e]">
                        Execução Concluída com Sucesso! ({bulkExecutionResult.total_applied} tabelas protegidas)
                      </h4>
                      <p className="text-xs text-[#202124] dark:text-zinc-200 mt-1">
                        A Stored Procedure compilou as políticas <code className="font-mono">rap_auto_{bulkOrgField}_*</code> e registrou cada transação na tabela de auditoria <code className="font-mono">sec_rls_audit_log</code>.
                      </p>
                      <div className="mt-2 text-[11px] font-mono text-[#5f6368] dark:text-zinc-400">
                        Job ID: {bulkExecutionResult.job_meta?.job_id} | Tempo: {bulkExecutionResult.job_meta?.elapsed_ms}ms
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBulkExecutionResult(null)}
                    className="text-[#5f6368] hover:text-[#202124] p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Target Tables Table Preview */}
            <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
              <div className="p-4 border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
                    Tabelas Elegíveis no Dataset Raw com a Coluna <span className="font-mono text-[#1a73e8]">{bulkOrgField}</span>
                  </h3>
                  <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                    O procedimento aplicará a política padrão com filtro desnormalizado em <code className="font-mono">sec_user_org_entitlements</code>.
                  </p>
                </div>
                <span className="text-xs font-mono font-medium text-[#5f6368] bg-[#f1f3f4] dark:bg-zinc-800 px-2.5 py-1 rounded">
                  {selectedFieldTables.length} tabelas encontradas
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#f8f9fa] dark:bg-zinc-900 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800 whitespace-nowrap">
                    <tr>
                      <th className="py-2.5 px-4">Tabela SAP Raw</th>
                      <th className="py-2.5 px-4">Coluna Org</th>
                      <th className="py-2.5 px-4 text-right">Linhas</th>
                      <th className="py-2.5 px-4 text-right">Tamanho</th>
                      <th className="py-2.5 px-4">Clustering Físico</th>
                      <th className="py-2.5 px-4">Política Gerada</th>
                      <th className="py-2.5 px-4 text-center">Estado Atual</th>
                      <th className="py-2.5 px-4 text-right">Ação Individual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f1f3f4] dark:divide-zinc-800 text-xs">
                    {selectedFieldTables.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-xs text-[#80868b]">
                          Nenhuma tabela encontrada no dataset contendo o campo '{bulkOrgField}'.
                        </td>
                      </tr>
                    ) : (
                      selectedFieldTables.map((t) => {
                        const isApplying = actionLoading === `APPLY_${t.table_name}_${t.org_field}`;
                        const isRevoking = actionLoading === `REVOKE_${t.table_name}_${t.org_field}`;
                        return (
                          <tr key={`${t.table_name}_${t.org_field}`} className="hover:bg-[#f8f9fa] dark:hover:bg-zinc-900/60">
                            <td className="py-3 px-4 font-mono font-bold text-[#1a73e8] dark:text-blue-400 uppercase">
                              {t.table_name}
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-[#202124] dark:text-zinc-200">
                              {t.org_field}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-[#202124] dark:text-zinc-200">
                              {formatNumber(t.row_count)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-[#5f6368] dark:text-zinc-400">
                              {t.size_mb} MB
                            </td>
                            <td className="py-3 px-4">
                              {t.is_org_clustered ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-[#1e8e3e]">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Otimizada ({t.clustering_fields})</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-[#b06000]">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  <span>Sem cluster em {t.org_field}</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-[#5f6368] dark:text-zinc-400">
                              {t.policy_name}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {t.rls_status === 'APPLIED' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#e6f4ea] text-[#1e8e3e]">
                                  <Lock className="w-3 h-3" />
                                  <span>APPLIED</span>
                                </span>
                              ) : t.rls_status === 'REVOKED' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#fce8e6] text-[#d93025]">
                                  <Unlock className="w-3 h-3" />
                                  <span>REVOKED</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#f1f3f4] dark:bg-zinc-800 text-[#5f6368]">
                                  DESPROTEGIDA
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleTableRlsAction('APPLY', t.table_name, t.org_field)}
                                  disabled={isApplying || isRevoking || !canApplyRls}
                                  className="px-2.5 py-1 rounded bg-[#1a73e8] hover:bg-[#1557b0] text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
                                >
                                  {isApplying ? 'Aplicando...' : 'Aplicar'}
                                </button>
                                {t.rls_status === 'APPLIED' && (
                                  <button
                                    type="button"
                                    onClick={() => handleTableRlsAction('REVOKE', t.table_name, t.org_field)}
                                    disabled={isApplying || isRevoking || !canRevokeRls}
                                    className="px-2 py-1 rounded bg-[#fce8e6] hover:bg-[#fad2cf] text-[#d93025] text-[11px] font-semibold transition-colors disabled:opacity-50"
                                  >
                                    {isRevoking ? '...' : 'Revogar'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal for Adding Custom Group / User Entitlement */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0c0c0f] rounded-xl border border-[#dadce0] dark:border-zinc-800 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#dadce0] dark:border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-[#202124] dark:text-zinc-100">
                Nova Concessão na Matriz de Acesso
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-[#5f6368] hover:text-[#202124]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateMapping} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-[#5f6368] mb-1">Tipo de Principal</label>
                <select
                  value={newMapping.principal_type}
                  onChange={(e) => setNewMapping({ ...newMapping, principal_type: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded-lg px-3 py-2"
                >
                  <option value="GROUP">Grupo Google Cloud IAM (group:...)</option>
                  <option value="USER">Usuário Individual (user:...)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-[#5f6368] mb-1">
                  E-mail do Grupo ou Usuário
                </label>
                <input
                  type="text"
                  required
                  value={newMapping.principal}
                  onChange={(e) => setNewMapping({ ...newMapping, principal: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded-lg px-3 py-2 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#5f6368] mb-1">Role SAP Referência</label>
                  <input
                    type="text"
                    value={newMapping.sap_role_binding}
                    onChange={(e) =>
                      setNewMapping({ ...newMapping, sap_role_binding: e.target.value })
                    }
                    className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded-lg px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#5f6368] mb-1">Nível Organizacional</label>
                  <select
                    value={newMapping.org_field}
                    onChange={(e) => setNewMapping({ ...newMapping, org_field: e.target.value })}
                    className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded-lg px-3 py-2 font-mono"
                  >
                    <option value="bukrs">bukrs (Empresa)</option>
                    <option value="werks">werks (Centro)</option>
                    <option value="vkorg">vkorg (Org. Vendas)</option>
                    <option value="ekorg">ekorg (Org. Compras)</option>
                    <option value="*">* (Todos / Global)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-[#5f6368] mb-1">
                  Valores Organizacionais Permitidos (separados por vírgula)
                </label>
                <input
                  type="text"
                  value={newMapping.org_values_str}
                  onChange={(e) =>
                    setNewMapping({ ...newMapping, org_values_str: e.target.value })
                  }
                  placeholder="1010, 1710"
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded-lg px-3 py-2 font-mono"
                />
              </div>

              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newMapping.is_all_access}
                  onChange={(e) =>
                    setNewMapping({ ...newMapping, is_all_access: e.target.checked })
                  }
                  className="rounded text-[#1a73e8]"
                />
                <span>Conceder Acesso Coringa Irrestrito (is_all_access = TRUE)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newMapping.sync_to_bigquery}
                  onChange={(e) =>
                    setNewMapping({ ...newMapping, sync_to_bigquery: e.target.checked })
                  }
                  className="rounded text-[#1a73e8]"
                />
                <span>Inserir imediatamente na tabela sec_user_org_entitlements no BigQuery</span>
              </label>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#dadce0] dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg border border-[#dadce0] dark:border-zinc-700 text-[#5f6368]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === 'create_mapping'}
                  className="px-4 py-2 rounded-lg bg-[#1a73e8] hover:bg-[#1557b0] text-white font-semibold"
                >
                  {actionLoading === 'create_mapping' ? 'Salvando...' : 'Salvar Concessão'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
