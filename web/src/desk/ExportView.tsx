import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { DeskLanguage } from './i18n';
import { deskTranslations } from './i18n';
import type { DeskOrderSummary } from './types';
import { fetchDeskOrders } from './api';
import { formatINR, getDefaultDateRange } from './formatters';

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
  const [includeExported, setIncludeExported] = useState(false);

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
    if (includeExported) params.append('include_exported', 'true');
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
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <h2 className="text-[18px] font-bold text-ink shrink-0">{t.title_export}</h2>

          {/* Date range filters */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center border border-border rounded bg-white h-9 px-2">
              <span className="text-[13px] font-medium text-ink-muted mr-1.5 uppercase">
                {t.from_date}
              </span>
              <input
                type="date"
                lang="en-IN"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="text-[14px] text-ink bg-transparent focus:outline-none"
              />
            </div>
            <span className="text-ink-muted text-[13px]">→</span>
            <div className="flex items-center border border-border rounded bg-white h-9 px-2">
              <span className="text-[13px] font-medium text-ink-muted mr-1.5 uppercase">
                {t.to_date}
              </span>
              <input
                type="date"
                lang="en-IN"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="text-[14px] text-ink bg-transparent focus:outline-none"
              />
            </div>
          </div>

          {/* Format selection */}
          <div className="flex items-center border border-border rounded bg-white h-9 px-2 shrink-0">
            <span className="text-[13px] font-medium text-ink-muted mr-1.5">
              {t.export_format}:
            </span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'xml' | 'csv')}
              className="text-[14px] text-ink bg-transparent focus:outline-none"
            >
              <option value="xml">Tally XML</option>
              <option value="csv">CSV</option>
            </select>
          </div>

          {/* Include exported checkbox */}
          <label className="flex items-center gap-1.5 text-[13px] text-ink-muted cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={includeExported}
              onChange={(e) => setIncludeExported(e.target.checked)}
              className="rounded border-border text-primary focus:ring-0"
            />
            <span>{t.include_exported}</span>
          </label>
        </div>
      </div>

      {/* Scrollable Results Area (Zone 2) */}
      <div className="w-full flex-1 min-h-0 overflow-y-auto p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 text-ink-muted text-[14px]">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
            <span>{t.loading_orders}</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-[14px]">
            <p className="text-error font-medium mb-3">{error}</p>
            <button
              type="button"
              onClick={loadApprovedOrders}
              className="px-4 py-1.5 border border-border rounded text-ink hover:bg-gray-50 text-[14px]"
            >
              {t.btn_retry}
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-ink-muted text-[14px] text-center">
            <p className="font-semibold text-ink text-[16px] mb-1">{t.title_export}</p>
            <p className="text-[13px]">{t.no_export_orders}</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="h-9 border-b border-border text-ink-muted text-[13px]">
                <th className="px-3 font-medium bg-gray-50">{t.order_number.replace('{id}', 'ID')}</th>
                <th className="px-3 font-medium bg-gray-50">{t.col_retailer}</th>
                <th className="px-3 font-medium text-right bg-gray-50">{t.col_total}</th>
                <th className="px-3 font-medium bg-gray-50">{t.col_source}</th>
                <th className="px-3 font-medium text-right bg-gray-50">{t.col_age}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => (
                <tr key={o.id} className="h-9 text-[14px] hover:bg-gray-50 transition-colors">
                  <td className="px-3 font-medium text-ink">#{o.id}</td>
                  <td className="px-3 text-ink truncate max-w-[200px]">{o.retailer}</td>
                  <td className="px-3 text-right font-semibold text-ink tabular-nums">
                    {formatINR(o.total)}
                  </td>
                  <td className="px-3 text-ink-muted text-[13px]">{o.source}</td>
                  <td className="px-3 text-right text-ink-muted text-[13px] tabular-nums">
                    {o.age}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pinned Footer Toolbar (Zone 3) */}
      <div className="h-14 shrink-0 px-6 border-t border-border bg-white flex items-center justify-between text-[14px]">
        <div>
          <span className="text-ink-muted text-[13px]">
            {t.export_summary.replace('{count}', String(orders.length))}
          </span>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={orders.length === 0}
          className={`h-10 px-6 rounded text-[13px] font-medium transition-colors ${
            orders.length === 0
              ? 'bg-gray-100 text-ink-subtle cursor-not-allowed'
              : 'bg-primary text-white hover:bg-[#0a6f1a]'
          }`}
        >
          {t.btn_download}
        </button>
      </div>
    </div>
  );
};
