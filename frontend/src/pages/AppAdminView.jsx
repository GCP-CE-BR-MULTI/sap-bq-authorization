import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Trash2,
  History,
  UserCheck,
  Palette,
  GripVertical,
  Save,
  Database,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDateTime } from '../utils/formatters';

function SortableColorSwatch({ id, color, index }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-[#dadce0] dark:border-zinc-700 bg-white dark:bg-zinc-800 cursor-grab active:cursor-grabbing select-none"
    >
      <GripVertical className="w-3.5 h-3.5 text-[#80868b]" />
      <span
        className="w-3.5 h-3.5 rounded-sm border border-black/10"
        style={{ backgroundColor: color }}
      />
      <span className="font-mono text-[11px] text-[#202124] dark:text-zinc-200 tabular-nums">
        {index + 1}. {color}
      </span>
    </div>
  );
}

const PERMISSION_LABELS = [
  {
    key: 'can_manage_connections',
    label: 'Configurar conexões BigQuery (OAuth / Service Account)',
    desc: 'Permite editar credenciais OAuth 2.0, chaves Service Account e datasets.',
  },
  {
    key: 'can_run_setup',
    label: 'Executar setup automatizado da solução',
    desc: 'Permite rodar as 6 etapas de DDL e deploy de stored procedures no BigQuery.',
  },
  {
    key: 'can_view_roles',
    label: 'Visualizar catálogo de roles SAP (PFCG)',
    desc: 'Acesso ao submenu de roles criadas, hierarquia e objetos de autorização.',
  },
  {
    key: 'can_view_matrices',
    label: 'Visualizar matrizes de acesso e RLS',
    desc: 'Acesso à matriz de grupos/usuários e à matriz de RLS por tabela.',
  },
  {
    key: 'can_manage_entitlements',
    label: 'Gerenciar concessões e refresh de entitlements',
    desc: 'Permite sincronizar sec_user_org_entitlements e cadastrar mapeamentos de grupos.',
  },
  {
    key: 'can_apply_rls',
    label: 'Aplicar políticas de RLS nas tabelas',
    desc: 'Permite executar CREATE OR REPLACE ROW ACCESS POLICY nas tabelas do SAP.',
  },
  {
    key: 'can_revoke_rls',
    label: 'Revogar políticas RLS (rollback)',
    desc: 'Permite executar DROP ROW ACCESS POLICY em tabelas protegidas.',
  },
  {
    key: 'can_manage_app_users',
    label: 'Administrar usuários e perfis da aplicação',
    desc: 'Controle administrativo sobre o RBAC interno e parâmetros operacionais.',
  },
];

export default function AppAdminView() {
  const {
    rbac,
    chartColors,
    setChartColors,
    showToast,
    refreshContext,
    switchUser,
  } = useApp();

  const canManageApp = rbac?.permissions?.can_manage_app_users !== false;

  const [adminState, setAdminState] = useState({
    app_roles: [],
    app_users: [],
    app_settings: {},
    app_audit_logs: [],
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const [newUser, setNewUser] = useState({
    email: '',
    name: '',
    sap_uname: '',
    department: 'Governança TI Copel',
    role_id: 'SECURITY_OPERATOR',
  });

  const sensors = useSensors(useSensor(PointerSensor));

  const fetchAdminData = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/state');
      setAdminState(res.data);
    } catch (err) {
      showToast('Erro ao carregar dados de administração da aplicação', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData, rbac?.user?.email]);

  const handleTogglePermission = async (roleId, permKey, currentVal) => {
    if (!canManageApp) {
      showToast(
        'Apenas o perfil Super Administrador pode alterar a matriz de permissões.',
        'error'
      );
      return;
    }
    try {
      const res = await axios.post('/api/admin/roles/permissions', {
        role_id: roleId,
        permissions: { [permKey]: !currentVal },
      });
      setAdminState((prev) => ({ ...prev, app_roles: res.data.app_roles }));
      await refreshContext();
      showToast(`Permissão '${permKey}' atualizada para o perfil ${roleId}.`, 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao atualizar permissão', 'error');
    }
  };

  const handleAddAppUser = async (e) => {
    e.preventDefault();
    if (!canManageApp) {
      showToast('Sem permissão para cadastrar usuários da aplicação.', 'error');
      return;
    }
    try {
      await axios.post('/api/admin/users', newUser);
      setNewUser({
        email: '',
        name: '',
        sap_uname: '',
        department: 'Governança TI Copel',
        role_id: 'SECURITY_OPERATOR',
      });
      await fetchAdminData();
      await refreshContext();
      showToast('Usuário da aplicação cadastrado.', 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao salvar usuário', 'error');
    }
  };

  const handleDeleteAppUser = async (userId) => {
    if (!canManageApp) return;
    try {
      await axios.delete(`/api/admin/users/${userId}`);
      await fetchAdminData();
      await refreshContext();
      showToast('Usuário removido da aplicação.', 'info');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao remover usuário', 'error');
    }
  };

  const handleSaveSettings = async () => {
    if (!canManageApp) return;
    setSavingSettings(true);
    try {
      await axios.post('/api/admin/settings', adminState.app_settings);
      await fetchAdminData();
      showToast('Parâmetros operacionais salvos.', 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao salvar configurações', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const [syncingBq, setSyncingBq] = useState(false);

  const handleSyncBqState = async () => {
    setSyncingBq(true);
    try {
      const res = await axios.post('/api/admin/sync-bq');
      await fetchAdminData();
      showToast(`Estado sincronizado em ${res.data.target_table}`, 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Falha ao sincronizar estado no BigQuery', 'error');
    } finally {
      setSyncingBq(false);
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setChartColors((items) => {
        const oldIndex = items.indexOf(active.id);
        const newIndex = items.indexOf(over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[#202124] dark:text-zinc-50">
            Administração da aplicação e controle de acesso (RBAC)
          </h1>
          <p className="text-xs text-[#5f6368] dark:text-zinc-400 mt-0.5 max-w-2xl">
            Defina quais perfis e operadores podem executar o setup, gerenciar conexões, visualizar matrizes, aplicar ou revogar políticas RLS e configurar parâmetros operacionais.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 px-3 py-1.5 rounded text-xs">
          <UserCheck className="w-3.5 h-3.5 text-[#1e8e3e]" />
          <div>
            <span className="text-[#5f6368] dark:text-zinc-400">Sessão ativa: </span>
            <strong className="font-mono text-[#202124] dark:text-zinc-100">
              {rbac?.user?.email}
            </strong>{' '}
            <span className="ml-1 px-1.5 py-0.5 rounded bg-[#e8f0fe] text-[#1a73e8] font-mono font-semibold text-[11px]">
              {rbac?.role?.id}
            </span>
          </div>
        </div>
      </div>

      {/* Section 1: Application RBAC Matrix (Roles x Capabilities) */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
        <div className="p-4 bg-[#f8f9fa] dark:bg-zinc-900 border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
              Matriz de permissões da aplicação por perfil funcional
            </h2>
            <p className="text-xs text-[#5f6368] dark:text-zinc-400">
              Marque ou desmarque as capacidades permitidas para cada perfil da plataforma
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#5f6368] bg-white border border-[#dadce0] px-2.5 py-0.5 rounded">
            {(adminState.app_roles || []).length} perfis
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-white dark:bg-zinc-900 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800">
              <tr>
                <th className="py-2.5 px-4 min-w-[260px]">Capacidade na aplicação</th>
                {(adminState.app_roles || []).map((role) => (
                  <th key={role.id} className="py-2.5 px-4 text-center min-w-[160px]">
                    <div className="font-mono text-xs text-[#1a73e8] dark:text-blue-400">
                      {role.id}
                    </div>
                    <div className="text-[11px] font-normal text-[#5f6368] dark:text-zinc-400 mt-0.5">
                      {role.name}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#dadce0]/60 dark:divide-zinc-800 text-xs">
              {PERMISSION_LABELS.map((perm) => (
                <tr
                  key={perm.key}
                  className="hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60 transition-colors"
                >
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-[#202124] dark:text-zinc-100">
                      {perm.label}
                    </div>
                    <div className="text-[11px] text-[#5f6368] dark:text-zinc-400">
                      {perm.desc}
                    </div>
                  </td>
                  {(adminState.app_roles || []).map((role) => {
                    const enabled = Boolean(role.permissions?.[perm.key]);
                    return (
                      <td key={role.id} className="py-2.5 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={!canManageApp}
                          onChange={() => handleTogglePermission(role.id, perm.key, enabled)}
                          className="w-4 h-4 rounded text-[#1a73e8] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 2: Application Users Management + Global Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Users List & Form (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-5 space-y-4">
          <div className="border-b border-[#dadce0] dark:border-zinc-800 pb-3">
            <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
              Operadores cadastrados na aplicação
            </h2>
            <p className="text-xs text-[#5f6368] dark:text-zinc-400">
              Adicione operadores ou selecione <strong>Assumir sessão</strong> para validar o comportamento da interface sob aquele perfil.
            </p>
          </div>

          {/* Add User Form */}
          <form
            onSubmit={handleAddAppUser}
            className="bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded p-3 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end text-xs"
          >
            <div className="sm:col-span-3">
              <label className="block font-medium text-[#5f6368] mb-1">E-mail corporativo</label>
              <input
                type="email"
                required
                placeholder="nome@copel.com"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                disabled={!canManageApp}
                className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-2.5 py-1.5 font-mono"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block font-medium text-[#5f6368] mb-1">Nome ou equipe</label>
              <input
                type="text"
                required
                placeholder="João Silva"
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                disabled={!canManageApp}
                className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-2.5 py-1.5"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block font-medium text-[#5f6368] mb-1">Perfil RBAC</label>
              <select
                value={newUser.role_id}
                onChange={(e) => setNewUser({ ...newUser, role_id: e.target.value })}
                disabled={!canManageApp}
                className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-2 py-1.5 font-mono text-[11px]"
              >
                {(adminState.app_roles || []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={!canManageApp}
                className="w-full bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded py-1.5 px-2 font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                Cadastrar
              </button>
            </div>
          </form>

          {/* Users Table */}
          <div className="overflow-x-auto border border-[#dadce0] dark:border-zinc-800 rounded">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#f8f9fa] dark:bg-zinc-900 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800 whitespace-nowrap">
                <tr>
                  <th className="py-2 px-2.5">Operador e e-mail</th>
                  <th className="py-2 px-2">Perfil RBAC</th>
                  <th className="py-2 px-2">Último acesso</th>
                  <th className="py-2 px-2.5 text-right">Sessão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dadce0]/60 dark:divide-zinc-800 text-xs">
                {(adminState.app_users || []).map((u) => {
                  const isCurrent =
                    rbac?.user?.email?.toLowerCase() === u.email.toLowerCase();
                  return (
                    <tr
                      key={u.id}
                      className={`transition-colors ${
                        isCurrent
                          ? 'bg-[#e8f0fe]/50 dark:bg-blue-950/30'
                          : 'hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60'
                      }`}
                    >
                      <td className="py-2 px-2.5 max-w-[195px]">
                        <div className="font-medium text-[#202124] dark:text-zinc-100 truncate">
                          {u.name}
                        </div>
                        <div
                          className="font-mono text-[11px] text-[#1a73e8] dark:text-blue-400 truncate"
                          title={u.email}
                        >
                          {u.email}
                        </div>
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded bg-[#f8f9fa] border border-[#dadce0] dark:bg-zinc-800 dark:border-zinc-700 text-[#202124] dark:text-zinc-200 font-mono font-medium text-[10.5px] whitespace-nowrap">
                          {u.role_id}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-[#5f6368] dark:text-zinc-400 tabular-nums text-[11px] whitespace-nowrap">
                        {formatDateTime(u.last_login)}
                      </td>
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                          {isCurrent ? (
                            <span className="px-2 py-0.5 rounded bg-[#e6f4ea] text-[#1e8e3e] text-[11px] font-medium whitespace-nowrap">
                              Ativa
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => switchUser(u.email)}
                              className="px-2 py-1 rounded bg-white dark:bg-zinc-800 border border-[#dadce0] dark:border-zinc-700 hover:border-[#1a73e8] text-[#1a73e8] text-[11px] font-medium transition-colors whitespace-nowrap shrink-0"
                            >
                              Assumir sessão
                            </button>
                          )}
                          {canManageApp && !isCurrent && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAppUser(u.id)}
                              className="p-1 text-[#80868b] hover:text-[#d93025] shrink-0"
                              title="Remover operador"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
        </div>

        {/* Global App Settings & Sortable Palette (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="border-b border-[#dadce0] dark:border-zinc-800 pb-3">
              <h2 className="text-sm font-semibold text-[#202124] dark:text-zinc-100">
                Parâmetros operacionais e FinOps
              </h2>
              <p className="text-xs text-[#5f6368] dark:text-zinc-400">
                Agendamento de refresh, higienização de variáveis e paleta visual
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-[#5f6368] dark:text-zinc-400 mb-1">
                  Expressão cron de sincronização (<code className="font-mono">sp_refresh_sap_entitlements</code>)
                </label>
                <input
                  type="text"
                  value={adminState.app_settings?.auto_refresh_schedule || '0 * * * *'}
                  onChange={(e) =>
                    setAdminState({
                      ...adminState,
                      app_settings: {
                        ...adminState.app_settings,
                        auto_refresh_schedule: e.target.value,
                      },
                    })
                  }
                  disabled={!canManageApp}
                  className="w-full bg-white dark:bg-[#09090b] border border-[#dadce0] dark:border-zinc-800 rounded px-3 py-1.5 font-mono"
                />
              </div>

              <label className="flex items-center justify-between p-3 rounded bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 cursor-pointer">
                <div>
                  <div className="font-medium text-[#202124] dark:text-zinc-100">
                    Higienizar variáveis não expandidas (<code className="font-mono">$bukrs</code>, <code className="font-mono">$werks</code>)
                  </div>
                  <div className="text-[11px] text-[#5f6368] dark:text-zinc-400">
                    Filtra variáveis residuais da <code className="font-mono">agr_1251</code> ao consolidar entitlements
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(adminState.app_settings?.sanitize_dollar_vars)}
                  onChange={(e) =>
                    setAdminState({
                      ...adminState,
                      app_settings: {
                        ...adminState.app_settings,
                        sanitize_dollar_vars: e.target.checked,
                      },
                    })
                  }
                  disabled={!canManageApp}
                  className="w-4 h-4 rounded text-[#1a73e8]"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 cursor-pointer">
                <div>
                  <div className="font-medium text-[#202124] dark:text-zinc-100">
                    Verificação FinOps de clustering por coluna organizacional
                  </div>
                  <div className="text-[11px] text-[#5f6368] dark:text-zinc-400">
                    Sinaliza tabelas com RLS ativo sem block pruning na coluna de filtro
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(adminState.app_settings?.enforce_clustering_check)}
                  onChange={(e) =>
                    setAdminState({
                      ...adminState,
                      app_settings: {
                        ...adminState.app_settings,
                        enforce_clustering_check: e.target.checked,
                      },
                    })
                  }
                  disabled={!canManageApp}
                  className="w-4 h-4 rounded text-[#1a73e8]"
                />
              </label>
            </div>

            {/* Drag-and-Drop Chart Palette Customization (@dnd-kit/sortable) */}
            <div className="pt-2 border-t border-[#dadce0] dark:border-zinc-800 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#202124] dark:text-zinc-100">
                <Palette className="w-3.5 h-3.5 text-[#5f6368]" />
                Sequência de cores dos gráficos (arraste para reordenar)
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={chartColors}
                  strategy={horizontalListSortingStrategy}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {chartColors.slice(0, 6).map((c, idx) => (
                      <SortableColorSwatch key={c} id={c} color={c} index={idx} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>

          <div className="pt-3 border-t border-[#dadce0] dark:border-zinc-800 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleSyncBqState}
              disabled={syncingBq}
              title="Gravar estado da aplicação e auditoria em app_governance_state no BigQuery"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#dadce0] dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-[#f8f9fa] dark:hover:bg-zinc-800 text-[#1a73e8] dark:text-blue-400 text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5 shrink-0" />
              <span>{syncingBq ? 'Sincronizando...' : 'Persistir no BigQuery'}</span>
            </button>

            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={savingSettings || !canManageApp}
              className="inline-flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5 shrink-0" />
              <span>{savingSettings ? 'Salvando...' : 'Salvar parâmetros'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 3: Application Audit Trail */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
        <div className="px-4 py-3 bg-[#f8f9fa] dark:bg-zinc-900 border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#5f6368]" />
            <h2 className="text-xs font-semibold text-[#202124] dark:text-zinc-100">
              Trilha de auditoria administrativa (Compliance e SOX)
            </h2>
          </div>
          <span className="text-xs text-[#5f6368] dark:text-zinc-400 tabular-nums">
            {(adminState.app_audit_logs || []).length} registros
          </span>
        </div>

        <div className="overflow-x-auto max-h-64">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white dark:bg-zinc-900 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800">
              <tr>
                <th className="py-2 px-4">Data e hora</th>
                <th className="py-2 px-4">Operador</th>
                <th className="py-2 px-4">Módulo</th>
                <th className="py-2 px-4">Ação</th>
                <th className="py-2 px-4">Descrição da operação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#dadce0]/60 dark:divide-zinc-800 text-xs">
              {(adminState.app_audit_logs || []).map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60 transition-colors"
                >
                  <td className="py-2 px-4 text-[#5f6368] dark:text-zinc-400 whitespace-nowrap tabular-nums">
                    {formatDateTime(log.timestamp)}
                  </td>
                  <td className="py-2 px-4 font-mono text-[#1a73e8] dark:text-blue-400">
                    {log.actor}
                  </td>
                  <td className="py-2 px-4">
                    <span className="px-2 py-0.5 rounded bg-[#f8f9fa] border border-[#dadce0] dark:bg-zinc-800 dark:border-zinc-700 font-medium text-[11px]">
                      {log.module}
                    </span>
                  </td>
                  <td className="py-2 px-4 font-mono font-medium text-[#202124] dark:text-zinc-200">
                    {log.action}
                  </td>
                  <td className="py-2 px-4 text-[#5f6368] dark:text-zinc-300">
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
