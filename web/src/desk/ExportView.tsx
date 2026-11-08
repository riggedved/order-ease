import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { DeskLanguage } from './i18n';
import { deskTranslations } from './i18n';
import type { DeskOrderSummary } from './types';
import { fetchDeskOrders } from './api';
import { formatINR, formatDateOnly, formatTimeOnly, getDefaultDateRange } from './formatters';

export interface ExportViewProps {
  token: string;
  lang: DeskLanguage;
}

export const ExportView: React.FC<ExportViewProps> = ({ token, lang }) => {
  const t = deskTranslations[lang];

  const defaultDates = useRef(getDefaultDateRange());
  const [fromDate, setFromDate] = useState(defaultDates.current.from_date);
  const [toDate, setToDate] = useState(defaultDates.current.to_date);
  const [format, setFormat] = useState<'xml' | 'csv'>('xml');

  const [orders, setOrders] = useState<DeskOrderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApprovedOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDeskOrders(token, {
        status: 'approved',
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        limit: 100,
        sort: 'newest',
      });
      setOrders(res.items);
    } catch (err: any) {
      setError(err.message || 'Failed to load approved orders');
    } finally {
      setLoading(false);
    }
  }, [token, fromDate, toDate]);

  useEffect(() => {
    loadApprovedOrders();
  }, [loadApprovedOrders]);

  const handleDownload = async () => {
    const params = new URLSearchParams();
    params.append('format', format);
    params.append('include_exported', 'true');
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);

    try {
      const res = await fetch(`/desk/export/tally?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Export failed');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tally_export_${format}_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Failed to download export');
    }
  };

  return (
    <div className="w-full flex-1 h-full min-h-0 flex flex-col bg-white overflow-hidden select-none">
      {/* Fixed Header Toolbar (Zone 1) */}
      <div className="h-16 shrink-0 px-6 py-2 border-b border-border flex items-center justify-between bg-white gap-4">
        <h2 className="desk-title text-ink shrink-0">{t.title_export}</h2>

        {/* Date range filters shifted to the right */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center border border-border rounded bg-white h-9 px-2">
            <span className="desk-meta font-medium text-ink-muted mr-1.5 uppercase">
              {t.from_date}
            </span>
            <input
              type="date"
              lang="en-IN"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="desk-body text-ink bg-transparent focus:outline-none cursor-pointer"
            />
          </div>
          <span className="text-ink-muted desk-meta">→</span>
          <div className="flex items-center border border-border rounded bg-white h-9 px-2">
            <span className="desk-meta font-medium text-ink-muted mr-1.5 uppercase">
              {t.to_date}
            </span>
            <input
              type="date"
              lang="en-IN"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="desk-body text-ink bg-transparent focus:outline-none cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Scrollable Results Area (Zone 2) */}
      <div className="w-full flex-1 min-h-0 overflow-y-auto p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 text-ink-muted desk-body">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
            <span>{t.loading_orders}</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 desk-body">
            <p className="text-error font-medium mb-3">{error}</p>
            <button
              type="button"
              onClick={loadApprovedOrders}
              className="px-4 py-1.5 border border-border rounded text-ink hover:bg-gray-50 desk-body font-semibold"
            >
              {t.btn_retry}
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-ink-muted desk-body text-center">
            <p className="desk-title text-ink mb-1">{t.title_export}</p>
            <p className="desk-meta">{t.no_export_orders}</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="h-9 border-b border-border text-ink-muted desk-meta font-semibold">
                <th className="px-3 font-semibold bg-gray-50">{t.order_number.replace('{id}', 'ID')}</th>
                <th className="px-3 font-semibold bg-gray-50">{t.col_retailer}</th>
                <th className="px-3 font-semibold text-right tabular-nums bg-gray-50">{t.col_total}</th>
                <th className="px-3 font-semibold tabular-nums bg-gray-50">{t.col_date}</th>
                <th className="px-3 font-semibold text-right tabular-nums bg-gray-50">{t.col_time}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => (
                <tr key={o.id} className="h-9 desk-body hover:bg-gray-50 transition-colors">
                  <td className="px-3 font-medium text-ink">#{o.id}</td>
                  <td className="px-3 text-ink truncate max-w-[200px]">{o.retailer}</td>
                  <td className="px-3 text-right font-semibold text-ink tabular-nums">
                    {formatINR(o.total)}
                  </td>
                  <td className="px-3 text-ink-muted desk-meta tabular-nums whitespace-nowrap">
                    {formatDateOnly(o.created_at)}
                  </td>
                  <td className="px-3 text-right text-ink-muted desk-meta tabular-nums whitespace-nowrap">
                    {formatTimeOnly(o.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pinned Footer Toolbar (Zone 3) */}
      <div className="h-14 shrink-0 px-6 border-t border-border bg-white flex items-center justify-between">
        <div>
          <span className="text-ink-muted desk-meta">
            {t.export_summary.replace('{count}', String(orders.length))}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Format selection */}
          <div className="flex items-center border border-border rounded bg-white h-10 px-2.5 shrink-0">
            <span className="desk-meta font-medium text-ink-muted mr-1.5">
              {t.export_format}:
            </span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'xml' | 'csv')}
              className="desk-body text-ink bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="xml">Tally XML</option>
              <option value="csv">CSV</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            disabled={orders.length === 0}
            className={`desk-body font-semibold h-10 px-6 rounded transition-colors ${
              orders.length === 0
                ? 'bg-gray-100 text-ink-muted cursor-not-allowed font-medium'
                : 'bg-primary text-white hover:bg-[#0a6f1a]'
            }`}
          >
            {t.btn_download}
          </button>
        </div>
      </div>
    </div>
  );
};
