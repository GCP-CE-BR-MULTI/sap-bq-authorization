import { format, parseISO, isValid } from 'date-fns';

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    const clean = String(dateStr).replace(' ', 'T');
    const parsed = parseISO(clean.endsWith('Z') || clean.includes('+') ? clean : `${clean}Z`);
    if (!isValid(parsed)) {
      const fallback = new Date(dateStr);
      if (isValid(fallback)) {
        return format(fallback, 'MMM dd, yyyy HH:mm');
      }
      return String(dateStr);
    }
    return format(parsed, 'MMM dd, yyyy HH:mm');
  } catch {
    return String(dateStr);
  }
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '0 B';
  const num = Number(bytes);
  if (isNaN(num) || num === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return `${parseFloat((num / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString('pt-BR');
}
