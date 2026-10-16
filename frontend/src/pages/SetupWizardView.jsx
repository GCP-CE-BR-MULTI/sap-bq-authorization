import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  Play,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Terminal,
  Copy,
  Check,
  RefreshCw,
  ShieldAlert,
  FileCode,
  History,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatDateTime, formatBytes } from '../utils/formatters';

export default function SetupWizardView() {
  const { activeConnection, rbac, showToast } = useApp();
  const canRunSetup = rbac?.permissions?.can_run_setup !== false;

  const [steps, setSteps] = useState([]);
  const [setupRuns, setSetupRuns] = useState([]);
  const [selectedStepId, setSelectedStepId] = useState('step_1_prereq');
  const [customSqlMap, setCustomSqlMap] = useState({});
  const [runningStepId, setRunningStepId] = useState(null);
  const [runningAll, setRunningAll] = useState(false);
  const [pilotOnly, setPilotOnly] = useState(true);
  const [liveLogs, setLiveLogs] = useState([]);
  const [copiedSql, setCopiedSql] = useState(false);

  const loadSetupData = useCallback(async () => {
    try {
      const res = await axios.get('/api/setup/steps');
      const loadedSteps = res.data.steps || [];
      setSteps(loadedSteps);
      setSetupRuns(res.data.setup_runs || []);
      if (loadedSteps.length > 0 && !selectedStepId) {
        setSelectedStepId(loadedSteps[0].id);
      }
      if (liveLogs.length === 0 && res.data.setup_runs?.length > 0) {
        setLiveLogs(res.data.setup_runs[0].logs || []);
      }
    } catch (err) {
      showToast('Erro ao carregar etapas do setup', 'error');
    }
  }, [selectedStepId, liveLogs.length, showToast]);

  useEffect(() => {
    loadSetupData();
  }, [activeConnection?.id]);

  const selectedStep = steps.find((s) => s.id === selectedStepId) || steps[0];
  const currentSql = selectedStep
    ? customSqlMap[selectedStep.id] ?? selectedStep.sql
    : '';

  const handleRunSingleStep = async (step) => {
    if (!canRunSetup) {
      showToast('Seu perfil atual não possui permissão para executar DDLs no BigQuery.', 'error');
      return;
    }
    setSelectedStepId(step.id);
    setRunningStepId(step.id);
    setLiveLogs([
      {
        timestamp: new Date().toISOString().slice(11, 23),
        level: 'INFO',
        message: `Submetendo etapa ${step.step_number} (${step.title}) ao BigQuery...`,
      },
    ]);

    try {
      const res = await axios.post(`/api/setup/execute/${step.id}`, {
        custom_sql: customSqlMap[step.id] || null,
        pilot_only: pilotOnly,
      });
      setLiveLogs(res.data.logs || []);
      await loadSetupData();
      if (res.data.status === 'SUCCESS') {
        showToast(
          `Etapa ${step.step_number} concluída em ${res.data.job_meta?.elapsed_ms} ms.`,
          'success'
        );
      } else {
        showToast(`Falha na etapa ${step.step_number}. Verifique os logs.`, 'error');
      }
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      setLiveLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toISOString().slice(11, 23),
          level: 'ERROR',
          message: `Falha na execução: ${msg}`,
        },
      ]);
      showToast(msg, 'error');
    } finally {
      setRunningStepId(null);
    }
  };

  const handleRunAllSequential = async () => {
    if (!canRunSetup) {
      showToast('Seu perfil atual não possui permissão para executar DDLs no BigQuery.', 'error');
      return;
    }
    setRunningAll(true);
    setLiveLogs([
      {
        timestamp: new Date().toISOString().slice(11, 23),
        level: 'INFO',
        message: 'Iniciando execução sequencial das 6 etapas de governança SAP RLS...',
      },
    ]);

    for (const step of steps) {
      setSelectedStepId(step.id);
      setRunningStepId(step.id);
      setLiveLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toISOString().slice(11, 23),
          level: 'INFO',
          message: `▶ Etapa ${step.step_number}/6: ${step.title}`,
        },
      ]);
      try {
        const res = await axios.post(`/api/setup/execute/${step.id}`, {
          custom_sql: customSqlMap[step.id] || null,
          pilot_only: pilotOnly,
        });
        setLiveLogs((prev) => [...prev, ...(res.data.logs || [])]);
        if (res.data.status === 'FAILED') {
          showToast(`Execução interrompida na etapa ${step.step_number}.`, 'error');
          break;
        }
      } catch (err) {
        const msg = err.response?.data?.detail || err.message;
        setLiveLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString().slice(11, 23),
            level: 'ERROR',
            message: `Erro na etapa ${step.step_number}: ${msg}`,
          },
        ]);
        showToast(msg, 'error');
        break;
      }
    }

    setRunningStepId(null);
    setRunningAll(false);
    await loadSetupData();
    showToast('Pipeline de setup concluído.', 'success');
  };

  const copySqlToClipboard = () => {
    navigator.clipboard.writeText(currentSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const completedStepsCount = steps.filter((s) => s.status === 'SUCCESS').length;

  return (
    <div className="space-y-5">
      {/* Header + Inline Pipeline Progress Strip */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
        <div className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-[#dadce0] dark:border-zinc-800">
          <div>
            <h1 className="text-lg font-semibold text-[#202124] dark:text-zinc-50">
              Setup da solução SAP RLS no BigQuery
            </h1>
            <p className="text-xs text-[#5f6368] dark:text-zinc-400 mt-0.5 max-w-2xl">
              Provisione datasets, tabelas clusterizadas (<code className="font-mono">sec_user_org_entitlements</code> e <code className="font-mono">sec_rls_audit_log</code>) e stored procedures com execução direta no motor BigQuery.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-2 text-xs text-[#5f6368] dark:text-zinc-300 bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 px-3 py-1.5 rounded cursor-pointer">
              <input
                type="checkbox"
                checked={pilotOnly}
                onChange={(e) => setPilotOnly(e.target.checked)}
                className="rounded text-[#1a73e8]"
              />
              <span>Etapa 6 em modo piloto (<code className="font-mono">bkpf</code>)</span>
            </label>

            <button
              type="button"
              onClick={handleRunAllSequential}
              disabled={runningAll || runningStepId !== null || !canRunSetup}
              className="inline-flex items-center gap-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {runningAll ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Executando etapas 1 a 6...
                </>
              ) : (
                <>
                  <PlayCircle className="w-3.5 h-3.5" />
                  Executar todas as etapas (1 a 6)
                </>
              )}
            </button>
          </div>
        </div>

        {/* Inline Progress Strip */}
        <div className="px-5 py-2.5 bg-[#f8f9fa]/70 dark:bg-zinc-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <span className="text-[#5f6368] dark:text-zinc-400">
              Destino:{' '}
              <code className="font-mono font-medium text-[#202124] dark:text-zinc-200">
                {activeConnection?.project_id}.{activeConnection?.governance_dataset}
              </code>
            </span>
            <span className="text-[#dadce0] dark:text-zinc-700">|</span>
            <span className="font-medium tabular-nums text-[#202124] dark:text-zinc-200">
              {completedStepsCount} de {steps.length || 6} etapas validadas nesta sessão
            </span>
          </div>

          <div className="w-full sm:w-64 bg-[#dadce0]/70 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[#1e8e3e] h-full transition-all duration-300"
              style={{
                width: `${steps.length ? Math.max(12, (completedStepsCount / steps.length) * 100) : 16}%`,
              }}
            />
          </div>
        </div>
      </div>

      {!canRunSetup && (
        <div className="bg-[#fef7e0] dark:bg-amber-900/20 border border-[#feefc3] dark:border-amber-800/40 text-[#b06000] dark:text-amber-300 rounded-md px-4 py-3 flex items-center gap-3 text-xs">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <div>
            Sessão somente leitura (<code className="font-mono">{rbac?.user?.email}</code> —{' '}
            <strong>{rbac?.role?.name}</strong>). Você pode inspecionar os scripts SQL e logs, mas a execução de DDLs exige perfil com permissão de setup.
          </div>
        </div>
      )}

      {/* Main Split: Connected Vertical Pipeline Stepper (5 cols) | BigQuery SQL Studio Split-Pane (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Connected Vertical Pipeline Stepper */}
        <div className="lg:col-span-5 bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md divide-y divide-[#dadce0] dark:divide-zinc-800 h-fit">
          <div className="px-4 py-3 bg-[#f8f9fa] dark:bg-zinc-900 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#202124] dark:text-zinc-100">
              Sequência de provisionamento (1 → 6)
            </span>
            <span className="text-[11px] text-[#5f6368] dark:text-zinc-400">
              Clique para inspecionar o SQL
            </span>
          </div>

          {steps.map((step, idx) => {
            const isSelected = step.id === selectedStep?.id;
            const isRunning = runningStepId === step.id;
            const isSuccess = step.status === 'SUCCESS';
            const isFailed = step.status === 'FAILED';

            return (
              <div
                key={step.id}
                onClick={() => {
                  setSelectedStepId(step.id);
                  if (step.last_run?.logs) {
                    setLiveLogs(step.last_run.logs);
                  }
                }}
                className={`relative p-4 cursor-pointer transition-colors border-l-[3px] ${
                  isSelected
                    ? 'border-l-[#1a73e8] bg-[#e8f0fe]/35 dark:bg-blue-950/30'
                    : 'border-l-transparent hover:bg-[#f8f9fa] dark:hover:bg-zinc-900/60'
                }`}
              >
                {/* Vertical connector line between step numbers */}
                {idx < steps.length - 1 && (
                  <div className="absolute left-[27px] top-11 bottom-0 w-px bg-[#dadce0] dark:bg-zinc-800" />
                )}

                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div
                      className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold tabular-nums shrink-0 mt-0.5 border ${
                        isRunning
                          ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#1a73e8]'
                          : isSuccess
                          ? 'bg-[#e6f4ea] text-[#1e8e3e] border-[#ceead6]'
                          : isFailed
                          ? 'bg-[#fce8e6] text-[#d93025] border-[#fad2cf]'
                          : isSelected
                          ? 'bg-[#1a73e8] text-white border-[#1a73e8]'
                          : 'bg-white dark:bg-zinc-900 text-[#5f6368] dark:text-zinc-300 border-[#dadce0] dark:border-zinc-700'
                      }`}
                    >
                      {isRunning ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : isSuccess ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : isFailed ? (
                        <XCircle className="w-3.5 h-3.5" />
                      ) : (
                        step.step_number
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] text-[#5f6368] dark:text-zinc-400">
                        <span className="font-medium text-[#1a73e8] dark:text-blue-400">
                          {step.phase}
                        </span>
                        <span>·</span>
                        <span className="tabular-nums">{step.estimated_time}</span>
                      </div>
                      <h3 className="text-xs font-semibold text-[#202124] dark:text-zinc-100 mt-0.5">
                        {step.title}
                      </h3>
                      <p className="text-xs text-[#5f6368] dark:text-zinc-400 mt-1 leading-relaxed">
                        {step.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <code className="px-1.5 py-0.5 rounded bg-[#f8f9fa] dark:bg-zinc-900 border border-[#dadce0] dark:border-zinc-800 text-[11px] font-mono text-[#202124] dark:text-zinc-300 break-all">
                          {step.target_object}
                        </code>
                        {step.last_run && (
                          <span className="text-[11px] text-[#5f6368] dark:text-zinc-400 tabular-nums whitespace-nowrap">
                            {formatDateTime(step.last_run.executed_at)} ({step.last_run.job_meta?.elapsed_ms || 0} ms)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRunSingleStep(step);
                    }}
                    disabled={isRunning || runningAll || !canRunSetup}
                    className="shrink-0 whitespace-nowrap self-start inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white dark:bg-zinc-900 hover:bg-[#e8f0fe] text-[#1a73e8] border border-[#dadce0] dark:border-zinc-700 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-3 h-3 fill-current shrink-0" />
                    <span>{isRunning ? 'Executando...' : 'Executar'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: BigQuery SQL Studio Split-Pane (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Unified SQL Editor + Real-time Console Card */}
          <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
            {/* Top Bar: SQL Editor Header */}
            <div className="bg-[#f8f9fa] dark:bg-zinc-900 border-b border-[#dadce0] dark:border-zinc-800 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-[#1a73e8]" />
                <span className="text-xs font-semibold text-[#202124] dark:text-zinc-100">
                  Etapa {selectedStep?.step_number}: {selectedStep?.title}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copySqlToClipboard}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white dark:bg-zinc-800 border border-[#dadce0] dark:border-zinc-700 text-xs font-medium text-[#5f6368] dark:text-zinc-300 hover:text-[#202124] transition-colors"
                >
                  {copiedSql ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#1e8e3e]" /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copiar SQL
                    </>
                  )}
                </button>

                {selectedStep && (
                  <button
                    type="button"
                    onClick={() => handleRunSingleStep(selectedStep)}
                    disabled={runningStepId !== null || runningAll || !canRunSetup}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    Executar etapa {selectedStep.step_number}
                  </button>
                )}
              </div>
            </div>

            {/* SQL Textarea */}
            <div className="p-3 bg-white dark:bg-[#09090b] border-b border-[#dadce0] dark:border-zinc-800">
              <textarea
                rows={11}
                value={currentSql}
                onChange={(e) =>
                  selectedStep &&
                  setCustomSqlMap({ ...customSqlMap, [selectedStep.id]: e.target.value })
                }
                className="w-full font-mono text-xs leading-relaxed bg-[#f8f9fa] dark:bg-zinc-950 text-[#202124] dark:text-zinc-200 border border-[#dadce0] dark:border-zinc-800 rounded p-3 focus:outline-none"
              />
            </div>

            {/* Bottom Pane: Execution Logs */}
            <div className="bg-[#f8f9fa] dark:bg-zinc-900 border-b border-[#dadce0] dark:border-zinc-800 px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-[#5f6368]" />
                <span className="text-xs font-semibold text-[#202124] dark:text-zinc-100">
                  Saída e telemetria do BigQuery
                </span>
              </div>
              <div className="flex items-center gap-2">
                {runningStepId && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[#e8f0fe] text-[#1a73e8]">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Executando no BigQuery...
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setLiveLogs([])}
                  className="text-xs text-[#5f6368] hover:text-[#202124] dark:text-zinc-400"
                >
                  Limpar saída
                </button>
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-zinc-950 font-mono text-xs space-y-1.5 max-h-[260px] overflow-y-auto">
              {liveLogs.length === 0 ? (
                <div className="text-[#5f6368] py-5 text-center font-sans">
                  Selecione <strong>Executar</strong> em qualquer etapa para acompanhar os jobs e resultados retornados pelo BigQuery.
                </div>
              ) : (
                liveLogs.map((log, i) => {
                  const badgeStyle =
                    log.level === 'SUCCESS'
                      ? 'bg-[#e6f4ea] text-[#1e8e3e] border-[#ceead6]'
                      : log.level === 'ERROR'
                      ? 'bg-[#fce8e6] text-[#d93025] border-[#fad2cf]'
                      : log.level === 'SQL'
                      ? 'bg-[#e8f0fe] text-[#1a73e8] border-[#d2e3fc]'
                      : log.level === 'DATA'
                      ? 'bg-[#fef7e0] text-[#b06000] border-[#feefc3]'
                      : 'bg-[#f8f9fa] dark:bg-zinc-800 text-[#5f6368] dark:text-zinc-300 border-[#dadce0] dark:border-zinc-700';

                  return (
                    <div
                      key={i}
                      className="bg-[#f8f9fa]/70 dark:bg-zinc-900 border border-[#dadce0]/80 dark:border-zinc-800 rounded px-2.5 py-2 flex items-start gap-2"
                    >
                      <span className="text-[11px] text-[#5f6368] tabular-nums shrink-0">
                        {log.timestamp}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border shrink-0 ${badgeStyle}`}
                      >
                        {log.level}
                      </span>
                      <pre className="whitespace-pre-wrap break-words text-[#202124] dark:text-zinc-200 flex-1 font-mono text-xs">
                        {log.message}
                      </pre>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Historical Setup Runs Table */}
          <div className="bg-white dark:bg-[#0c0c0f] border border-[#dadce0] dark:border-zinc-800 rounded-md overflow-hidden">
            <div className="px-4 py-3 bg-[#f8f9fa] dark:bg-zinc-900 border-b border-[#dadce0] dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-[#5f6368]" />
                <h2 className="text-xs font-semibold text-[#202124] dark:text-zinc-100">
                  Histórico de jobs executados
                </h2>
              </div>
              <span className="text-xs text-[#5f6368] dark:text-zinc-400 tabular-nums">
                {setupRuns.length} execuções registradas
              </span>
            </div>

            <div className="overflow-x-auto max-h-56">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900 text-xs font-semibold text-[#5f6368] dark:text-zinc-400 border-b border-[#dadce0] dark:border-zinc-800 z-10">
                  <tr>
                    <th className="py-2 px-4">Horário</th>
                    <th className="py-2 px-4">Etapa</th>
                    <th className="py-2 px-4">Job ID no BigQuery</th>
                    <th className="py-2 px-4 text-right">Duração</th>
                    <th className="py-2 px-4 text-right">Bytes lidos</th>
                    <th className="py-2 px-4 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#dadce0]/60 dark:divide-zinc-800 text-xs">
                  {setupRuns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[#5f6368]">
                        Nenhum job executado manualmente nesta sessão.
                      </td>
                    </tr>
                  ) : (
                    setupRuns.map((run) => (
                      <tr
                        key={run.run_id}
                        onClick={() => setLiveLogs(run.logs || [])}
                        className="hover:bg-[#f8f9fa] dark:hover:bg-zinc-800/60 cursor-pointer transition-colors"
                      >
                        <td className="py-2 px-4 text-[#5f6368] dark:text-zinc-400 whitespace-nowrap tabular-nums">
                          {formatDateTime(run.executed_at)}
                        </td>
                        <td className="py-2 px-4 font-medium text-[#202124] dark:text-zinc-200">
                          {run.step_number}. {run.step_title}
                        </td>
                        <td className="py-2 px-4 font-mono text-[11px] text-[#1a73e8] dark:text-blue-400">
                          {run.job_meta?.job_id || '—'}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-[#202124] dark:text-zinc-200">
                          {run.job_meta?.elapsed_ms ? `${run.job_meta.elapsed_ms} ms` : '—'}
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-[#5f6368] dark:text-zinc-400">
                          {formatBytes(run.job_meta?.total_bytes_processed)}
                        </td>
                        <td className="py-2 px-4 text-center">
                          {run.status === 'SUCCESS' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#e6f4ea] text-[#1e8e3e]">
                              <CheckCircle2 className="w-3 h-3" /> Concluído
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#fce8e6] text-[#d93025]">
                              <XCircle className="w-3 h-3" /> Falhou
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
