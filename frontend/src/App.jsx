import React, { useState } from 'react';
import {
  Database,
  Layers,
  Shield,
  Key,
  Users,
  Table2,
  Settings,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Info,
  FolderGit2,
  UserCheck,
  Menu,
  Cloud,
  Sparkles,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import ConnectionsView from './pages/ConnectionsView';
import SetupWizardView from './pages/SetupWizardView';
import ProfilesView from './pages/ProfilesView';
import AppAdminView from './pages/AppAdminView';
import ChatPanel from './components/ChatPanel';

function MainConsoleLayout() {
  const {
    activeConnection,
    connections,
    rbac,
    appUsers,
    darkMode,
    setDarkMode,
    toast,
    setToast,
    switchUser,
    switchConnection,
  } = useApp();

  // Active module: 'connections' | 'setup' | 'profiles' | 'admin'
  const [activeModule, setActiveModule] = useState('connections');
  // Submenu for Module 3: 'roles' | 'access-matrix' | 'rls-matrix'
  const [profilesSubmenu, setProfilesSubmenu] = useState('roles');
  const [infraExpanded, setInfraExpanded] = useState(true);
  const [profilesExpanded, setProfilesExpanded] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const isInfraActive = ['connections', 'setup', 'admin'].includes(activeModule);

  const navigateToInfraSubmenu = (mod) => {
    setActiveModule(mod);
    setInfraExpanded(true);
  };

  const navigateToProfilesSubmenu = (sub) => {
    setActiveModule('profiles');
    setProfilesSubmenu(sub);
    setProfilesExpanded(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fa] dark:bg-[#09090b] text-[#202124] dark:text-zinc-100 transition-colors">
      {/* =====================================================================
          GOOGLE CLOUD CONSOLE TOP HEADER BAR
         ===================================================================== */}
      <header className="sticky top-0 z-40 h-14 bg-white dark:bg-[#0c0c0f] border-b border-[#dadce0] dark:border-zinc-800 px-4 flex items-center justify-between gap-3">
        {/* Left: Hamburger + GCP Brand + Project Selector */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="p-1.5 rounded-md hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 text-[#5f6368] dark:text-zinc-400 transition-colors shrink-0"
            title="Alternar menu lateral"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2.5 shrink-0 whitespace-nowrap">
            <div className="w-6 h-6 rounded bg-[#e8f0fe] dark:bg-blue-950/80 border border-[#d2e3fc] dark:border-blue-800 flex items-center justify-center shrink-0">
              <Cloud className="w-3.5 h-3.5 text-[#1a73e8] dark:text-blue-400" />
            </div>
            <div className="flex items-center gap-2 text-sm whitespace-nowrap">
              <span className="font-semibold text-[#202124] dark:text-zinc-50">
                Google Cloud
              </span>
              <span className="text-[#dadce0] dark:text-zinc-700">/</span>
              <span className="font-semibold text-[#1a73e8] dark:text-blue-400">
                Copel SAP-BQ RLS Governance
              </span>
            </div>
          </div>

          {/* GCP Project Selector */}
          <div className="hidden xl:flex items-center gap-1.5 ml-1 bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-700 rounded px-2.5 py-1 text-xs shrink-0 whitespace-nowrap">
            <FolderGit2 className="w-3.5 h-3.5 text-[#5f6368] shrink-0" />
            <span className="text-[#5f6368] dark:text-zinc-400">Projeto:</span>
            <select
              value={activeConnection?.id || ''}
              onChange={(e) => switchConnection(e.target.value)}
              className="bg-transparent font-mono font-medium text-[#202124] dark:text-zinc-100 focus:outline-none cursor-pointer max-w-[200px] 2xl:max-w-[320px] truncate"
              title={
                activeConnection
                  ? `${activeConnection.project_id} (${activeConnection.governance_dataset})`
                  : 'Selecionar projeto GCP'
              }
            >
              {connections.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                  className="bg-white dark:bg-zinc-900 text-[#202124] dark:text-zinc-100"
                >
                  {c.project_id} ({c.location || 'US'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right: CDC Status + Gemini Assistant + RBAC Switcher + Theme Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#e6f4ea] dark:bg-emerald-950/50 border border-[#ceead6] dark:border-emerald-800/50 text-[#1e8e3e] dark:text-emerald-400 text-xs font-medium whitespace-nowrap shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1e8e3e] shrink-0" />
            <span>BigQuery CDC ativo</span>
          </div>

          {/* Gemini AI Assistant Toggle Button */}
          <button
            type="button"
            onClick={() => setIsChatOpen((o) => !o)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors border whitespace-nowrap shrink-0 ${
              isChatOpen
                ? 'bg-[#1a73e8] text-white border-[#1a73e8]'
                : 'bg-[#e8f0fe] hover:bg-[#d2e3fc] text-[#1a73e8] border-[#d2e3fc] dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800'
            }`}
            title="Consultar governança SAP e BigQuery com Gemini"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Assistente Gemini</span>
          </button>

          {/* Quick RBAC User Switcher */}
          <div className="flex items-center gap-1.5 bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded px-2.5 py-1 text-xs whitespace-nowrap shrink-0">
            <UserCheck className="w-3.5 h-3.5 text-[#5f6368] shrink-0" />
            <span className="hidden 2xl:inline text-[#5f6368] dark:text-zinc-400">Sessão:</span>
            <select
              value={rbac?.user?.email || 'admin@felipechagas.altostrat.com'}
              onChange={(e) => switchUser(e.target.value)}
              className="bg-transparent font-medium text-[#202124] dark:text-zinc-100 focus:outline-none cursor-pointer max-w-[230px] truncate"
              title="Simular sessão com outro perfil RBAC da aplicação"
            >
              {appUsers.map((u) => (
                <option
                  key={u.id}
                  value={u.email}
                  className="bg-white dark:bg-zinc-900 text-[#202124] dark:text-zinc-100"
                >
                  {u.name} ({u.role_id})
                </option>
              ))}
            </select>
          </div>

          {/* Light / Dark Mode Toggle */}
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            className="p-1.5 rounded border border-[#dadce0] dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-[#f1f3f4] dark:hover:bg-zinc-800 text-[#5f6368] dark:text-zinc-300 transition-colors shrink-0"
            title={darkMode ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* =====================================================================
          BODY: LEFT NAVIGATION DRAWER + MAIN WORKSPACE CANVAS
         ===================================================================== */}
      <div className="flex-1 flex">
        {sidebarOpen && (
          <aside className="w-60 shrink-0 bg-white dark:bg-[#0c0c0f] border-r border-[#dadce0] dark:border-zinc-800 flex flex-col justify-between py-3 px-2 select-none">
            <nav className="space-y-2">
              {/* Menu Suspenso 1: Infraestrutura e Setup */}
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setInfraExpanded((e) => !e)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-r text-xs font-medium transition-colors border-l-[3px] whitespace-nowrap ${
                    isInfraActive
                      ? 'border-[#1a73e8] bg-[#e8f0fe]/40 text-[#1a73e8] font-semibold dark:bg-blue-950/40 dark:text-blue-400'
                      : 'border-transparent text-[#3c4043] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Server className="w-4 h-4 shrink-0" />
                    <span className="text-left truncate">Infraestrutura e Setup</span>
                  </div>
                  {infraExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )}
                </button>

                {infraExpanded && (
                  <div className="pl-5 space-y-0.5 border-l border-[#dadce0] dark:border-zinc-800 ml-4 my-1">
                    {/* Conexões com o BigQuery */}
                    <button
                      type="button"
                      onClick={() => navigateToInfraSubmenu('connections')}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors whitespace-nowrap ${
                        activeModule === 'connections'
                          ? 'bg-[#e8f0fe] text-[#1a73e8] font-semibold dark:bg-blue-950/70 dark:text-blue-300'
                          : 'text-[#5f6368] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                      }`}
                    >
                      <Database className="w-3.5 h-3.5 shrink-0" />
                      <span>Conexões BigQuery</span>
                    </button>

                    {/* Setup da Solução */}
                    <button
                      type="button"
                      onClick={() => navigateToInfraSubmenu('setup')}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors whitespace-nowrap ${
                        activeModule === 'setup'
                          ? 'bg-[#e8f0fe] text-[#1a73e8] font-semibold dark:bg-blue-950/70 dark:text-blue-300'
                          : 'text-[#5f6368] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5 shrink-0" />
                      <span>Setup da Solução</span>
                    </button>

                    {/* Administração da Aplicação */}
                    <button
                      type="button"
                      onClick={() => navigateToInfraSubmenu('admin')}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors whitespace-nowrap ${
                        activeModule === 'admin'
                          ? 'bg-[#e8f0fe] text-[#1a73e8] font-semibold dark:bg-blue-950/70 dark:text-blue-300'
                          : 'text-[#5f6368] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                      }`}
                    >
                      <Settings className="w-3.5 h-3.5 shrink-0" />
                      <span>Administração e RBAC</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Menu Suspenso 2: Governança de Acessos (Perfis e Matrizes SAP) */}
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModule('profiles');
                    setProfilesExpanded((e) => !e);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-r text-xs font-medium transition-colors border-l-[3px] whitespace-nowrap ${
                    activeModule === 'profiles'
                      ? 'border-[#1a73e8] bg-[#e8f0fe]/40 text-[#1a73e8] font-semibold dark:bg-blue-950/40 dark:text-blue-400'
                      : 'border-transparent text-[#3c4043] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Shield className="w-4 h-4 shrink-0" />
                    <span className="text-left truncate">Governança de Acessos</span>
                  </div>
                  {profilesExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )}
                </button>

                {profilesExpanded && (
                  <div className="pl-5 space-y-0.5 border-l border-[#dadce0] dark:border-zinc-800 ml-4 my-1">
                    <button
                      type="button"
                      onClick={() => navigateToProfilesSubmenu('roles')}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors whitespace-nowrap ${
                        activeModule === 'profiles' && profilesSubmenu === 'roles'
                          ? 'bg-[#e8f0fe] text-[#1a73e8] font-semibold dark:bg-blue-950/70 dark:text-blue-300'
                          : 'text-[#5f6368] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                      }`}
                    >
                      <Key className="w-3.5 h-3.5 shrink-0" />
                      <span>Roles criadas (PFCG)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateToProfilesSubmenu('access-matrix')}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors whitespace-nowrap ${
                        activeModule === 'profiles' && profilesSubmenu === 'access-matrix'
                          ? 'bg-[#e8f0fe] text-[#1a73e8] font-semibold dark:bg-blue-950/70 dark:text-blue-300'
                          : 'text-[#5f6368] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>Matriz Usuário × Org</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateToProfilesSubmenu('rls-matrix')}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors whitespace-nowrap ${
                        activeModule === 'profiles' && profilesSubmenu === 'rls-matrix'
                          ? 'bg-[#e8f0fe] text-[#1a73e8] font-semibold dark:bg-blue-950/70 dark:text-blue-300'
                          : 'text-[#5f6368] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                      }`}
                    >
                      <Table2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Matriz RLS por Tabela</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateToProfilesSubmenu('rls-bulk')}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors whitespace-nowrap ${
                        activeModule === 'profiles' && profilesSubmenu === 'rls-bulk'
                          ? 'bg-[#e8f0fe] text-[#1a73e8] font-semibold dark:bg-blue-950/70 dark:text-blue-300'
                          : 'text-[#5f6368] dark:text-zinc-400 hover:bg-[#f1f3f4] dark:hover:bg-zinc-900 hover:text-[#202124]'
                      }`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#1e8e3e]" />
                      <span>Aplicação RLS por Nível Org</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Assistente Gemini Data Analytics */}
              <div className="pt-3 mt-3 border-t border-[#dadce0] dark:border-zinc-800 px-1">
                <button
                  type="button"
                  onClick={() => setIsChatOpen(true)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded text-xs font-semibold bg-[#f8f9fa] hover:bg-[#e8f0fe] text-[#1a73e8] dark:bg-zinc-900 dark:text-blue-300 border border-[#dadce0] dark:border-zinc-800 transition-colors whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Assistente Gemini</span>
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[#e8f0fe] text-[#1a73e8] text-[10px] font-semibold shrink-0 whitespace-nowrap">
                    SQL IA
                  </span>
                </button>
              </div>
            </nav>

            {/* Sidebar Footer: Environment Context */}
            <div className="mx-1 bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 rounded p-2.5 space-y-1 text-[11px]">
              <div className="font-semibold text-[#202124] dark:text-zinc-100 flex items-center justify-between">
                <span>Datasets BigQuery</span>
                <span className="inline-flex items-center gap-1 text-[#1e8e3e] font-medium text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#1e8e3e]" />
                  Ativo
                </span>
              </div>
              <div className="text-[#5f6368] dark:text-zinc-400 font-mono truncate">
                {activeConnection?.raw_dataset}
              </div>
              <div className="text-[#5f6368] dark:text-zinc-400 font-mono truncate">
                {activeConnection?.governance_dataset}
              </div>
              <div className="pt-1 border-t border-[#dadce0] dark:border-zinc-800 text-[#5f6368] dark:text-zinc-400 flex items-center justify-between">
                <span>Perfil ativo:</span>
                <span className="font-mono font-medium text-[#1a73e8] dark:text-blue-400">
                  {rbac?.role?.id || 'SUPER_ADMIN'}
                </span>
              </div>
            </div>
          </aside>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 w-full max-w-[1600px] mx-auto px-6 py-5 overflow-x-hidden">
          {activeModule === 'connections' && <ConnectionsView />}
          {activeModule === 'setup' && <SetupWizardView />}
          {activeModule === 'profiles' && (
            <ProfilesView
              activeSubmenu={profilesSubmenu}
              setActiveSubmenu={setProfilesSubmenu}
            />
          )}
          {activeModule === 'admin' && <AppAdminView />}
        </main>
      </div>

      {/* Gemini Data Analytics Slide-Over Chat Panel */}
      <ChatPanel
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        contextText={`Módulo ativo: ${activeModule} | Projeto: ${activeConnection?.project_id || 'ce-sap-latam-genai'}.${activeConnection?.governance_dataset || 'cortex7_sap_s4_security'}`}
      />

      {/* Calm, Disciplined Notification Bar (no bounce) */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md transition-opacity duration-200">
          <div
            className={`rounded-md border px-4 py-3 shadow-md flex items-center gap-3 text-xs font-medium ${
              toast.type === 'error'
                ? 'bg-[#fce8e6] border-[#fad2cf] text-[#d93025]'
                : toast.type === 'info'
                ? 'bg-[#e8f0fe] border-[#d2e3fc] text-[#1a73e8]'
                : 'bg-white border-[#dadce0] text-[#202124]'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-[#d93025]" />
            ) : toast.type === 'info' ? (
              <Info className="w-4 h-4 shrink-0 text-[#1a73e8]" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1e8e3e]" />
            )}
            <span className="leading-snug">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 text-sm font-semibold text-[#5f6368] hover:text-[#202124]"
              aria-label="Fechar notificação"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainConsoleLayout />
    </AppProvider>
  );
}
