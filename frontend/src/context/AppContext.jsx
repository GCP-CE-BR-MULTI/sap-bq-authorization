import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AppContext = createContext(null);

export const DEFAULT_CHART_COLORS = [
  "#1a73e8", // Google Blue
  "#1e8e3e", // Google Green
  "#f9ab00", // Google Yellow
  "#d93025", // Google Red
  "#8b5cf6", // Violet
  "#06b6d4", // Cyan
  "#ec4899", // Pink
  "#f97316", // Orange
  "#84cc16", // Lime
  "#6366f1", // Indigo
];

export function AppProvider({ children }) {
  const [loadingContext, setLoadingContext] = useState(true);
  const [activeConnection, setActiveConnection] = useState(null);
  const [connections, setConnections] = useState([]);
  const [rbac, setRbac] = useState({
    user: null,
    role: null,
    permissions: {
      can_manage_connections: true,
      can_run_setup: true,
      can_view_roles: true,
      can_view_matrices: true,
      can_manage_entitlements: true,
      can_apply_rls: true,
      can_revoke_rls: true,
      can_manage_app_users: true,
    },
  });
  const [appUsers, setAppUsers] = useState([]);
  const [appRoles, setAppRoles] = useState([]);
  const [appSettings, setAppSettings] = useState({});
  const [darkMode, setDarkMode] = useState(false); // Light Mode default per user request
  const [chartColors, setChartColors] = useState(DEFAULT_CHART_COLORS);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ id: Date.now(), message, type });
    setTimeout(() => {
      setToast((prev) => (prev && Date.now() - prev.id >= 4000 ? null : prev));
    }, 4200);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    if (darkMode) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [darkMode]);

  const refreshContext = useCallback(async () => {
    try {
      const res = await axios.get('/api/context');
      setActiveConnection(res.data.active_connection);
      setConnections(res.data.connections || []);
      setRbac(res.data.rbac || {});
      setAppUsers(res.data.app_users || []);
      setAppRoles(res.data.app_roles || []);
      setAppSettings(res.data.app_settings || {});
    } catch (err) {
      console.error('Erro ao carregar contexto:', err);
    } finally {
      setLoadingContext(false);
    }
  }, []);

  useEffect(() => {
    refreshContext();
  }, [refreshContext]);

  const switchUser = async (email) => {
    try {
      const res = await axios.post('/api/admin/switch-user', { email });
      setRbac(res.data);
      await refreshContext();
      showToast(`Sessão alternada para ${res.data.user?.name} (${res.data.role?.name})`, 'info');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao alternar usuário', 'error');
    }
  };

  const switchConnection = async (connId) => {
    try {
      const res = await axios.post(`/api/connections/${connId}/activate`);
      setActiveConnection(res.data.active_connection);
      await refreshContext();
      showToast(`Conexão BigQuery ativa: ${res.data.active_connection?.name}`, 'success');
    } catch (err) {
      showToast(err.response?.data?.detail || 'Erro ao alternar conexão', 'error');
    }
  };

  return (
    <AppContext.Provider
      value={{
        loadingContext,
        activeConnection,
        connections,
        rbac,
        appUsers,
        appRoles,
        appSettings,
        darkMode,
        setDarkMode,
        chartColors,
        setChartColors,
        toast,
        setToast,
        showToast,
        refreshContext,
        switchUser,
        switchConnection,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
