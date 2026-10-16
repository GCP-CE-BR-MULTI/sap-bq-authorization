import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import ReactECharts from 'echarts-for-react';
import {
  KeyRound,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Plus,
  Upload,
  Globe,
  FileJson,
  Trash2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDateTime, formatNumber } from '../utils/formatters';

export default function ConnectionsView() {
  const {
    activeConnection,
    connections,
    rbac,
    darkMode,
    chartColors,
    showToast,
    refreshContext,
    switchConnection,
  } = useApp();

  const canManage = rbac?.permissions?.can_manage_connections !== false;

  const [form, setForm] = useState({
    id: 'conn-copel-s4',
    name: 'Copel SAP S/4HANA & BigQuery (Ativo)',
    environment: 'PRODUCTION / HOMOLOG',
    auth_mode: 'oauth_adc',
    project_id: 'ce-sap-latam-genai',
    raw_dataset: 'cortex7_sap_s4_raw',
    governance_dataset: 'cortex7_sap_s4_security',
    location: 'US',
    corporate_domain: '@felipechagas.altostrat.com',
    default_grantees: "'user:admin@felipechagas.altostrat.com', 'user:fchagas@felipechagas.altostrat.com'",
    bypass_service_accounts: '%@ce-sap-latam-genai.iam.gserviceaccount.com, %@gcp-data-lake.iam.gserviceaccount.com',
    bypass_admins: 'admin@felipechagas.altostrat.com',
    oauth_client_id: 'copel-sap-rls-governance.apps.googleusercontent.com',
    oauth_user_email: 'admin@felipechagas.altostrat.com',
    oauth_access_token: '',
    service_account_json: '',
  });

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);

  useEffect(() => {
    if (activeConnection) {
      setForm({
        id: activeConnection.id || '',
        name: activeConnection.name || '',
        environment: activeConnection.environment || 'PRODUCTION',
        auth_mode: activeConnection.auth_mode || 'oauth_adc',
        project_id: activeConnection.project_id || 'ce-sap-latam-genai',
        raw_dataset: activeConnection.raw_dataset || 'cortex7_sap_s4_raw',
        governance_dataset: activeConnection.governance_dataset || 'cortex7_sap_s4_security',
        location: activeConnection.location || 'US',
        corporate_domain: activeConnection.corporate_domain || '@copel.com',
        default_grantees: activeConnection.default_grantees || '',
        bypass_service_accounts: (activeConnection.bypass_service_accounts || []).join(', '),
        bypass_admins: (activeConnection.bypass_admins || []).join(', '),
        oauth_client_id: activeConnection.oauth_client_id || '',
        oauth_user_email: activeConnection.oauth_user_email || 'admin@felipechagas.altostrat.com',
        oauth_access_token: '',
        service_account_json: '',
      });
    }
  }, [activeConnection]);

  const runDiagnostics = useCallback(
    async (connId) => {
      const targetId = connId || activeConnection?.id || 'conn-copel-s4';
      setTesting(true);
      try {
        const res = await axios.post(`/api/connections/${targetId}/test`);
        setDiagnostics(res.data);
        await refreshContext();
        showToast(
          `Conexão validada em ${res.data.project_id} (${res.data.auth_identity})`,
          'success'
        );
      } catch (err) {
        showToast(
          err.response?.data?.detail || 'Falha ao validar conexão com o BigQuery',
          'error'
        );
      } finally {
        setTesting(false);
      }
    },
    [activeConnection, refreshContext, showToast]
  );

  useEffect(() => {
    if (activeConnection?.id && !diagnostics) {
      runDiagnostics(activeConnection.id);
    }
  }, [activeConnection?.id]);

  const handleSaveConnection = async (e) => {
    e.preventDefault();
    if (!canManage) {
      showToast('Seu perfil atual não possui permissão para alterar conexões.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        bypass_service_accounts: form.bypass_service_accounts
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        bypass_admins: form.bypass_admins
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const res = await axios.post('/api/connections', payload);
      await refreshContext();
      showToast('Conexão BigQuery salva e ativada.', 'success');
      await runDiagnostics(res.data.active_connection_id);
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao salvar conexão', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConnection = async () => {
    if (!canManage || !form.id) return;
    if (connections.length <= 1) {
      showToast('Não é possível excluir a única conexão restante.', 'error');
      return;
    }
    setDeleting(true);
    try {
      const res = await axios.delete(`/api/connections/${form.id}`);
      await refreshContext();
      showToast(`Conexão '${form.name}' excluída com sucesso.`, 'info');
      if (res.data?.active_connection_id) {
        await runDiagnostics(res.data.active_connection_id);
      }
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao excluir conexão', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setForm((prev) => ({
        ...prev,
        auth_mode: 'service_account',
        service_account_json: String(ev.target?.result || ''),
      }));
      showToast(`Chave JSON '${file.name}' carregada para validação.`, 'info');
    };
    reader.readAsText(file);
  };

  const secTables = diagnostics?.security_tables || [];
  const presentTablesCount = secTables.filter((t) => t.exists && t.row_count > 0).length;
  const govRoutinesCount = diagnostics?.governance_objects?.routines?.length || 0;
  const govTablesCount = diagnostics?.governance_objects?.tables?.length || 0;

  const chartOption = {
    color: chartColors,
    tooltip: {
      trigger: 'axis',
      backgroundColor: darkMode ? '#18181b' : '#ffffff',
      borderColor: darkMode ? '#27272a' : '#dadce0',
      textStyle: { color: darkMode ? '#f4f4f5' : '#202124', fontFamily: 'Plus Jakarta Sans, sans-serif' },
    },
    grid: { left: 16, right: 16, bottom: 16, top: 34, containLabel: true },
    xAxis: {
      type: 'category',
      data: secTables.map((t) => t.table_name),
      axisLabel: {
        color: darkMode ? '#a1a1aa' : '#5f6368',
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 500,
      },
      axisLine: { lineStyle: { color: darkMode ? '#27272a' : '#dadce0' } },
    },
    yAxis: {
      type: 'value',
      name: 'Linhas replicadas (CDC)',
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
        name: 'Linhas no BigQuery',
        type: 'bar',
        barWidth: '38%',
        data: secTables.map((t) => t.row_count),
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: chartColors[0] || '#1a73e8',
        },
      },
    ],
  };

  return (
    <div className="space-y-5">
      {/* Page Header + Unified Telemetry Strip */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
        <div className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-[#dadce0] dark:border-zinc-800">
          <div>
            <h1 className="text-lg font-semibold text-[#202124] dark:text-zinc-50">
              Conexões com o Google Cloud BigQuery
            </h1>
            <p className="text-xs text-[#5f6368] dark:text-zinc-400 mt-0.5 max-w-2xl">
              Configure a autenticação via OAuth 2.0 (Application Default Credentials ou Token) ou Service Account JSON e valide a replicação das 8 tabelas de segurança SAP.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() =>
                setForm({
                  id: '',
                  name: 'Nova Conexão BigQuery SAP',
                  environment: 'SANDBOX',
                  auth_mode: 'oauth_adc',
                  project_id: 'ce-sap-latam-genai',
                  raw_dataset: 'cortex7_sap_s4_raw',
                  governance_dataset: 'sap_governance',
                  location: 'US',
                  corporate_domain: '@copel.com',
                  default_grantees: "'group:gcp-bi-analysts@copel.com'",
                  bypass_service_accounts: '%@ce-sap-latam-genai.iam.gserviceaccount.com',
                  bypass_admins: 'admin@felipechagas.altostrat.com',
                  oauth_client_id: '',
                  oauth_user_email: 'admin@felipechagas.altostrat.com',
                  oauth_access_token: '',
                  service_account_json: '',
                })
              }
              disabled={!canManage}
              className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 hover:bg-[#f8f9fa] dark:hover:bg-zinc-800 text-[#202124] dark:text-zinc-200 border border-[#dadce0] dark:border-zinc-700 rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5 text-[#1a73e8] shrink-0" />
              <span>Criar perfil de conexão</span>
            </button>

            <button
              type="button"
              onClick={() => runDiagnostics(form.id || activeConnection?.id)}
              disabled={testing}
              className="inline-flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${testing ? 'animate-spin' : ''}`} />
              <span>{testing ? 'Testando conexão...' : 'Testar conexão e validar tabelas SAP'}</span>
            </button>
          </div>
        </div>

        {/* Compact 4-Column Inline Telemetry Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#dadce0] dark:divide-zinc-800 bg-[#f8f9fa]/60 dark:bg-zinc-900/40">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between text-xs text-[#5f6368] dark:text-zinc-400">
              <span>Projeto conectado</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1e8e3e] dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1e8e3e]" />
                {diagnostics?.status || 'CONNECTED'}
              </span>
            </div>
            <div className="mt-1 text-sm font-mono font-semibold text-[#202124] dark:text-zinc-100 truncate">
              {activeConnection?.project_id || 'ce-sap-latam-genai'}
            </div>
            <div className="text-[11px] text-[#5f6368] dark:text-zinc-400 truncate">
              {diagnostics?.auth_identity || 'Google OAuth / ADC'}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-xs text-[#5f6368] dark:text-zinc-400">
              Tabelas de segurança SAP (PFCG)
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums text-[#202124] dark:text-zinc-100">
              {secTables.length > 0 ? `${presentTablesCount} de 8 tabelas` : '8 de 8 tabelas'}
            </div>
            <div className="text-[11px] text-[#5f6368] dark:text-zinc-400">
              Dataset: <code className="font-mono">{activeConnection?.raw_dataset}</code>
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-xs text-[#5f6368] dark:text-zinc-400">
              Identidades SAP mapeadas (<code className="font-mono">adr6</code>)
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums text-[#202124] dark:text-zinc-100">
              {diagnostics?.identity_coverage
                ? `${diagnostics.identity_coverage.users_with_valid_email} / ${diagnostics.identity_coverage.total_sap_users} (${diagnostics.identity_coverage.email_coverage_pct}%)`
                : 'Verificando...'}
            </div>
            <div className="text-[11px] text-[#5f6368] dark:text-zinc-400">
              Usuários ativos com e-mail corporativo
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-xs text-[#5f6368] dark:text-zinc-400">
              Objetos no dataset de governança
            </div>
            <div className="mt-1 text-base font-semibold tabular-nums text-[#202124] dark:text-zinc-100">
              {govTablesCount} tabelas · {govRoutinesCount} procedures
            </div>
            <div className="text-[11px] text-[#5f6368] dark:text-zinc-400">
              Dataset: <code className="font-mono">{activeConnection?.governance_dataset}</code>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split: Left Auth & Dataset Configuration | Right SAP 8-Table Health Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Form (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dadce0] dark:border-zinc-800 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
                Credenciais e datasets BigQuery
              </h2>
              <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                Defina o método de autenticação e as contas técnicas de bypass das políticas RLS.
              </p>
            </div>

            <div className="flex gap-1 bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 p-0.5 rounded">
              {connections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => switchConnection(c.id)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                    c.id === activeConnection?.id
                      ? 'bg-[#e8f0fe] dark:bg-blue-950/70 text-[#1a73e8] dark:text-blue-400 font-semibold'
                      : 'text-[#5f6368] dark:text-zinc-400 hover:text-[#202124]'
                  }`}
                >
                  {c.governance_dataset}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSaveConnection} className="space-y-4">
            {/* Authentication Mode Selector */}
            <div>
              <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1.5">
                Modo de autenticação
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, auth_mode: 'oauth_adc' })}
                  className={`p-3 rounded border text-left transition-colors ${
                    form.auth_mode === 'oauth_adc'
                      ? 'border-[#1a73e8] bg-[#e8f0fe]/40 dark:bg-blue-950/40'
                      : 'border-[#dadce0] dark:border-zinc-800 hover:bg-[#f8f9fa] dark:hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Globe className="w-4 h-4 text-[#1a73e8]" />
                    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#e6f4ea] text-[#1e8e3e]">
                      Recomendado
                    </span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-[#202124] dark:text-zinc-100">
                    OAuth 2.0 (Identity / ADC)
                  </div>
                  <div className="text-[11px] text-[#5f6368] dark:text-zinc-400 mt-0.5">
                    Usa a sessão Google Cloud ativa para avaliar <code className="font-mono">SESSION_USER()</code>.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setForm({ ...form, auth_mode: 'oauth_token' })}
                  className={`p-3 rounded border text-left transition-colors ${
                    form.auth_mode === 'oauth_token'
                      ? 'border-[#1a73e8] bg-[#e8f0fe]/40 dark:bg-blue-950/40'
                      : 'border-[#dadce0] dark:border-zinc-800 hover:bg-[#f8f9fa] dark:hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <KeyRound className="w-4 h-4 text-[#5f6368]" />
                    <span className="text-[11px] font-medium text-[#5f6368]">Token Bearer</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-[#202124] dark:text-zinc-100">
                    OAuth 2.0 Client / Token
                  </div>
                  <div className="text-[11px] text-[#5f6368] dark:text-zinc-400 mt-0.5">
                    Injeta Client ID e Access Token OAuth 2.0 explícito.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setForm({ ...form, auth_mode: 'service_account' })}
                  className={`p-3 rounded border text-left transition-colors ${
                    form.auth_mode === 'service_account'
                      ? 'border-[#1a73e8] bg-[#e8f0fe]/40 dark:bg-blue-950/40'
                      : 'border-[#dadce0] dark:border-zinc-800 hover:bg-[#f8f9fa] dark:hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <FileJson className="w-4 h-4 text-[#5f6368]" />
                    <span className="text-[11px] font-medium text-[#5f6368]">Chave JSON</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-[#202124] dark:text-zinc-100">
                    Service Account GCP
                  </div>
                  <div className="text-[11px] text-[#5f6368] dark:text-zinc-400 mt-0.5">
                    Credencial técnica para automação de jobs e DDL.
                  </div>
                </button>
              </div>
            </div>

            {/* Conditional Auth Details */}
            {form.auth_mode === 'oauth_adc' && (
              <div className="bg-[#f8f9fa] dark:bg-zinc-900/70 border border-[#dadce0] dark:border-zinc-800 rounded p-3 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#1e8e3e] shrink-0 mt-0.5" />
                <div className="text-xs text-[#202124] dark:text-zinc-200">
                  Credencial OAuth ativa:{' '}
                  <code className="font-mono font-semibold text-[#1a73e8] dark:text-blue-400">
                    {diagnostics?.auth_identity || form.oauth_user_email}
                  </code>
                  . As políticas RLS usam <code className="font-mono">SESSION_USER()</code> diretamente nas consultas.
                </div>
              </div>
            )}

            {form.auth_mode === 'oauth_token' && (
              <div className="bg-[#f8f9fa] dark:bg-zinc-900/70 border border-[#dadce0] dark:border-zinc-800 rounded p-3.5 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                      OAuth 2.0 Client ID
                    </label>
                    <input
                      type="text"
                      value={form.oauth_client_id}
                      onChange={(e) => setForm({ ...form, oauth_client_id: e.target.value })}
                      placeholder="seu-client-id.apps.googleusercontent.com"
                      className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                      E-mail da identidade OAuth
                    </label>
                    <input
                      type="email"
                      value={form.oauth_user_email}
                      onChange={(e) => setForm({ ...form, oauth_user_email: e.target.value })}
                      placeholder="usuario@copel.com"
                      className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                    Access Token OAuth 2.0 (opcional — usa ADC se em branco)
                  </label>
                  <input
                    type="password"
                    value={form.oauth_access_token}
                    onChange={(e) => setForm({ ...form, oauth_access_token: e.target.value })}
                    placeholder="ya29.a0AeDClZ..."
                    className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                  />
                </div>
              </div>
            )}

            {form.auth_mode === 'service_account' && (
              <div className="bg-[#f8f9fa] dark:bg-zinc-900/70 border border-[#dadce0] dark:border-zinc-800 rounded p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#202124] dark:text-zinc-200">
                    Chave JSON da Service Account (BigQuery Admin / Data Owner)
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white dark:bg-zinc-800 border border-[#dadce0] dark:border-zinc-700 text-xs font-medium text-[#1a73e8] cursor-pointer hover:bg-[#e8f0fe]/50 transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    Carregar arquivo .json
                    <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
                <textarea
                  rows={4}
                  value={form.service_account_json}
                  onChange={(e) => setForm({ ...form, service_account_json: e.target.value })}
                  placeholder='{"type": "service_account", "project_id": "ce-sap-latam-genai", "client_email": "sa-sap-rls@ce-sap-latam-genai.iam.gserviceaccount.com", ...}'
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded p-2.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                />
              </div>
            )}

            {/* Connection & Dataset Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Nome do perfil de conexão
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs text-[#202124] dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Google Cloud Project ID
                </label>
                <input
                  type="text"
                  value={form.project_id}
                  onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Dataset SAP Raw (tabelas replicadas CDC)
                </label>
                <input
                  type="text"
                  value={form.raw_dataset}
                  onChange={(e) => setForm({ ...form, raw_dataset: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Dataset de Governança e Segurança RLS
                </label>
                <input
                  type="text"
                  value={form.governance_dataset}
                  onChange={(e) => setForm({ ...form, governance_dataset: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Localização BigQuery
                </label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="US ou southamerica-east1"
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Domínio corporativo padrão (<code className="font-mono">adr6</code>)
                </label>
                <input
                  type="text"
                  value={form.corporate_domain}
                  onChange={(e) => setForm({ ...form, corporate_domain: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                Grantees IAM padrão nas cláusulas <code className="font-mono">GRANT TO</code>
              </label>
              <input
                type="text"
                value={form.default_grantees}
                onChange={(e) => setForm({ ...form, default_grantees: e.target.value })}
                className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Service Accounts com bypass de leitura
                </label>
                <input
                  type="text"
                  value={form.bypass_service_accounts}
                  onChange={(e) => setForm({ ...form, bypass_service_accounts: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Administradores com bypass de auditoria
                </label>
                <input
                  type="text"
                  value={form.bypass_admins}
                  onChange={(e) => setForm({ ...form, bypass_admins: e.target.value })}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-[#202124] dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="pt-3 flex items-center justify-between gap-3 border-t border-[#dadce0] dark:border-zinc-800">
              <button
                type="button"
                onClick={handleDeleteConnection}
                disabled={deleting || !canManage || !form.id || connections.length <= 1}
                title={
                  connections.length <= 1
                    ? 'Mantenha ao menos um perfil de conexão ativo'
                    : 'Excluir este perfil de conexão'
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-[#dadce0] dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-[#fce8e6]/70 hover:border-[#f6aea9] text-[#d93025] dark:text-red-400 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>{deleting ? 'Excluindo...' : 'Excluir conexão'}</span>
              </button>

              <button
                type="submit"
                disabled={saving || !canManage}
                className="inline-flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{saving ? 'Salvando conexão...' : 'Salvar e ativar conexão'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: SAP Security Tables Diagnostics (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-[#dadce0] dark:border-zinc-800 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
                  Integridade das 8 tabelas de segurança SAP
                </h2>
                <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                  Verificação ao vivo em <code className="font-mono">{form.raw_dataset}</code>
                </p>
              </div>
              <span className="text-xs text-[#5f6368] dark:text-zinc-400">
                {diagnostics?.tested_at ? formatDateTime(diagnostics.tested_at) : 'Sincronizado'}
              </span>
            </div>

            <div className="mt-3 overflow-x-auto border border-[#dadce0] dark:border-zinc-800 rounded">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#f8f9fa] dark:bg-zinc-900 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800 whitespace-nowrap">
                  <tr>
                    <th className="py-2 px-3">Tabela SAP</th>
                    <th className="py-2 px-2.5 text-right">Linhas</th>
                    <th className="py-2 px-2.5 text-right">Volume</th>
                    <th className="py-2 px-3 text-right">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#dadce0]/60 dark:divide-zinc-800 text-xs">
                  {secTables.map((t) => (
                    <tr
                      key={t.table_name}
                      className="hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60 transition-colors"
                    >
                      <td className="py-2 px-3 max-w-[165px]">
                        <div className="font-mono font-semibold text-[#1a73e8] dark:text-blue-400">
                          {t.table_name}
                        </div>
                        <div className="text-[11px] text-[#5f6368] dark:text-zinc-400 truncate" title={t.description}>
                          {t.description}
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums font-medium text-[#202124] dark:text-zinc-200 whitespace-nowrap">
                        {formatNumber(t.row_count)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums text-[#5f6368] dark:text-zinc-400 whitespace-nowrap">
                        {t.size_mb} MB
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {t.exists && t.row_count > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#e6f4ea] text-[#1e8e3e] dark:bg-emerald-900/30 dark:text-emerald-400 whitespace-nowrap">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            <span>Íntegra</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#fce8e6] text-[#d93025] dark:bg-rose-900/30 dark:text-rose-400 whitespace-nowrap">
                            <XCircle className="w-3 h-3 shrink-0" />
                            <span>Ausente</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Governance Objects Summary Box */}
          <div className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded p-3 space-y-2">
            <div className="text-xs font-semibold text-[#202124] dark:text-zinc-100">
              Artefatos provisionados em <code className="font-mono">{form.governance_dataset}</code>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(diagnostics?.governance_objects?.tables || []).map((tb) => (
                <span
                  key={tb.table_name}
                  className="px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-[#dadce0] dark:border-zinc-700 text-[11px] font-mono text-[#202124] dark:text-zinc-200"
                >
                  {tb.table_name} ({formatNumber(tb.row_count)})
                </span>
              ))}
              {(diagnostics?.governance_objects?.routines || []).map((rt) => (
                <span
                  key={rt.routine_name}
                  className="px-2 py-0.5 rounded bg-[#e8f0fe] dark:bg-blue-950/60 border border-[#d2e3fc] dark:border-blue-800 text-[11px] font-mono text-[#1a73e8] dark:text-blue-300"
                >
                  {rt.routine_name}()
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Volumetria Chart */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
              Registros replicados por tabela de segurança SAP
            </h2>
            <p className="text-xs text-[#5f6368] dark:text-zinc-400">
              Volume de registros lidos pela procedure <code className="font-mono">sp_refresh_sap_entitlements</code>
            </p>
          </div>
          <span className="px-2 py-0.5 rounded bg-[#f8f9fa] border border-[#dadce0] text-[#5f6368] text-xs font-mono">
            {activeConnection?.project_id}.{activeConnection?.raw_dataset}
          </span>
        </div>
        <ReactECharts option={chartOption} style={{ height: '260px', width: '100%' }} />
      </div>
    </div>
  );
}
