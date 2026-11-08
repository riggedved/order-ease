import React, { useState, useEffect } from 'react';
import type { DeskLanguage } from './i18n';
import { deskTranslations } from './i18n';
import type { SimpleRetailer } from './api';
import { fetchDeskRetailers, captureDeskOrder, postDeskOrder } from './api';
import { formatINR } from './formatters';

export interface CaptureViewProps {
  token: string;
  lang: DeskLanguage;
  onOrderCreated?: (orderId: number) => void;
}

export const CaptureView: React.FC<CaptureViewProps> = ({ token, lang, onOrderCreated }) => {
  const t = deskTranslations[lang];

  const [retailers, setRetailers] = useState<SimpleRetailer[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<number | ''>('');
  const [messageText, setMessageText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [parsedLines, setParsedLines] = useState<any[]>([]);
  const [payableAmount, setPayableAmount] = useState<number | null>(null);

  useEffect(() => {
    fetchDeskRetailers(token)
      .then((data) => {
        setRetailers(data);
        if (data.length > 0) {
          setSelectedRetailerId(data[0].id);
        }
      })
      .catch((err) => console.error('Error fetching retailers:', err));
  }, [token]);

  const handleParse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRetailerId || !messageText.trim()) return;

    setParsing(true);
    setParseError(null);
    setSuccessMsg(null);
    try {
      const res = await captureDeskOrder(token, Number(selectedRetailerId), messageText.trim());
      setParsedLines(res.lines || []);
      setPayableAmount(res.quote?.payable_amount ?? null);
    } catch (err: any) {
      setParseError(err.message || 'Failed to parse order');
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmOrder = async () => {
    if (!selectedRetailerId || parsedLines.length === 0) return;

    setConfirming(true);
    setParseError(null);
    try {
      const payloadLines = parsedLines.map((l) => ({
        sku_code: l.sku_code,
        qty_cases: l.qty_cases,
        original_words: l.original_words || null,
      }));
      const order = await postDeskOrder(token, Number(selectedRetailerId), payloadLines);
      setSuccessMsg(t.order_confirmed_msg.replace('{id}', String(order.id)));
      setParsedLines([]);
      setMessageText('');
      setPayableAmount(null);
      if (onOrderCreated) {
        onOrderCreated(order.id);
      }
    } catch (err: any) {
      setParseError(err.message || 'Failed to confirm order');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="w-full flex-1 h-full min-h-0 flex flex-col bg-white overflow-hidden select-none">
      {/* Fixed Header Toolbar (Zone 1) */}
      <div className="h-16 shrink-0 px-6 py-2 border-b border-border flex items-center justify-between bg-white gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h2 className="text-[18px] font-bold text-ink shrink-0">{t.title_capture}</h2>

          {/* Retailer Select */}
          <select
            value={selectedRetailerId}
            onChange={(e) => setSelectedRetailerId(e.target.value ? Number(e.target.value) : '')}
            className="h-9 px-3 text-[14px] border border-border rounded bg-white text-ink focus:outline-none focus:border-primary shrink-0 max-w-[220px]"
          >
            {retailers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          {/* Text Input */}
          <form onSubmit={handleParse} className="flex items-center gap-2 flex-1 min-w-0">
            <input
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={t.capture_input_placeholder}
              className="h-9 px-3 text-[14px] border border-border rounded text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary flex-1 min-w-0"
            />
            <button
              type="submit"
              disabled={parsing || !messageText.trim()}
              className={`h-9 px-4 rounded text-[13px] font-medium transition-colors shrink-0 ${
                parsing || !messageText.trim()
                  ? 'bg-gray-100 text-ink-subtle cursor-not-allowed'
                  : 'bg-primary text-white hover:bg-[#0a6f1a]'
              }`}
            >
              {parsing ? t.parsing : t.btn_parse}
            </button>
          </form>
        </div>
      </div>

      {/* Scrollable Results Area (Zone 2) */}
      <div className="w-full flex-1 min-h-0 overflow-y-auto p-6">
        {parseError && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-error text-[13px]">
            {parseError}
          </div>
        )}

        {successMsg && (
          <div className="mb-4 px-3 py-2 bg-[#f0fdf4] border border-[#bbf7d0] rounded text-primary text-[13px] font-semibold">
            {successMsg}
          </div>
        )}

        {parsedLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-ink-muted text-[14px] text-center">
            <p className="font-medium text-ink mb-1">{t.title_capture}</p>
            <p className="text-[13px]">{t.capture_empty}</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="h-9 border-b border-border text-ink-muted text-[13px]">
                <th className="px-3 font-medium bg-gray-50">{t.col_product}</th>
                <th className="px-3 font-medium text-center bg-gray-50">{t.col_cases}</th>
                <th className="px-3 font-medium text-center bg-gray-50">{t.col_free}</th>
                <th className="px-3 font-medium text-center bg-gray-50">{t.col_confidence}</th>
                <th className="px-3 font-medium bg-gray-50">{t.order_items}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {parsedLines.map((line, idx) => (
                <tr key={idx} className="h-9 text-[14px] hover:bg-gray-50 transition-colors">
                  <td className="px-3 font-medium text-ink">{line.sku_code}</td>
                  <td className="px-3 text-center tabular-nums">{line.qty_cases}</td>
                  <td className="px-3 text-center text-ink-muted tabular-nums">
                    {line.free_cases || 0}
                  </td>
                  <td className="px-3 text-center text-[13px] text-ink-muted">
                    {line.confidence ? `${Math.round(line.confidence * 100)}%` : '—'}
                  </td>
                  <td className="px-3 text-ink-muted text-[13px] italic truncate max-w-[200px]">
                    {line.original_words ? `"${line.original_words}"` : '—'}
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
          {payableAmount !== null && (
            <span className="font-semibold text-ink">
              {t.total}: <span className="tabular-nums font-bold text-primary">{formatINR(payableAmount)}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={confirming || parsedLines.length === 0}
          onClick={handleConfirmOrder}
          className={`h-10 px-6 rounded text-[13px] font-medium transition-colors ${
            confirming || parsedLines.length === 0
              ? 'bg-gray-100 text-ink-subtle cursor-not-allowed'
              : 'bg-primary text-white hover:bg-[#0a6f1a]'
          }`}
        >
          {confirming ? t.confirming : t.btn_confirm_order}
        </button>
      </div>
    </div>
  );
};

