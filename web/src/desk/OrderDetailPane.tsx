import React, { useState, useEffect } from 'react';
import type { DeskLanguage } from './i18n';
import { deskTranslations } from './i18n';
import type { DeskOrderDetail, DeskCatalogueSKU } from './types';
import { formatINR, formatDateTime } from './formatters';
import { WarningIcon } from './icons';

export interface OrderDetailPaneProps {
  lang: DeskLanguage;
  order: DeskOrderDetail | null;
  catalogue: DeskCatalogueSKU[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSaveEdits: (lines: Array<{ sku_code: string; qty_cases: number; original_words?: string | null }>) => Promise<void>;
  onApprove: (overrideFlag?: boolean, overrideReason?: string) => Promise<void>;
  onReloadOrder: () => void;
  isConflict: boolean;
  actionError: string | null;
  actionLoading: boolean;
  overrideInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const OrderDetailPane: React.FC<OrderDetailPaneProps> = ({
  lang,
  order,
  catalogue,
  loading,
  error,
  onRetry,
  onSaveEdits,
  onApprove,
  onReloadOrder,
  isConflict,
  actionError,
  actionLoading,
  overrideInputRef,
}) => {
  const t = deskTranslations[lang];

  // Local lines edit state
  const [editableLines, setEditableLines] = useState<Array<{
    line_id: number;
    initial_sku_code: string;
    sku_code: string;
    qty_cases: number;
    free_cases: number;
    line_total: string | number;
    original_words?: string | null;
  }>>([]);

  const [overrideReason, setOverrideReason] = useState('');

  // Sync state when loaded order changes
  useEffect(() => {
    if (order) {
      setEditableLines(
        order.lines.map((l) => ({
          line_id: l.line_id,
          initial_sku_code: l.sku_code,
          sku_code: l.sku_code,
          qty_cases: l.qty_cases,
          free_cases: l.free_cases,
          line_total: l.line_total,
          original_words: l.original_words,
        }))
      );
      setOverrideReason(order.override_reason || '');
    } else {
      setEditableLines([]);
      setOverrideReason('');
    }
  }, [order]);

  if (loading) {
    return (
      <div className="w-[40%] flex-1 h-full min-h-0 flex flex-col items-center justify-center p-4 bg-white text-ink-muted desk-body">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
        <span>{t.loading_details}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-[40%] flex-1 h-full min-h-0 flex flex-col items-center justify-center p-4 bg-white desk-body">
        <p className="text-error font-medium mb-3">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-1.5 border border-border rounded text-ink hover:bg-gray-50 desk-body font-semibold"
        >
          {t.btn_retry}
        </button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="w-[40%] flex-1 h-full min-h-0 flex flex-col items-center justify-center p-4 bg-white text-ink-muted desk-body text-center">
        <p>{t.no_order_selected}</p>
      </div>
    );
  }

  const isApproved = order.status === 'approved';
  const isCreditHold = order.status === 'credit_hold';

  const getSourceLabel = (src: string) => {
    switch (src) {
      case 'retailer_app':
      case 'app':
        return t.source_app;
      case 'retailer_capture':
      case 'message':
        return t.source_message;
      case 'desk_capture':
      case 'desk':
        return t.source_desk;
      case 'salesman':
        return t.source_salesman;
      default:
        return src;
    }
  };

  const handleSkuChange = (index: number, newSku: string) => {
    setEditableLines((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], sku_code: newSku };
      return copy;
    });
  };

  const handleQtyChange = (index: number, newQty: number) => {
    setEditableLines((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], qty_cases: Math.max(0, newQty) };
      return copy;
    });
  };

  const handleSaveClick = async () => {
    const payloadLines = editableLines.map((l) => ({
      sku_code: l.sku_code,
      qty_cases: Number(l.qty_cases),
      original_words: l.original_words,
    }));
    await onSaveEdits(payloadLines);
  };

  const handleApproveNormal = async () => {
    if (isCreditHold) return;
    await onApprove(false);
  };

  const handleApproveWithOverride = async () => {
    if (!isCreditHold || !overrideReason.trim()) return;
    await onApprove(true, overrideReason.trim());
  };

  // Credit Position calculations
  const cp = order.credit_position;
  const isOverLimit = cp.is_over_limit;
  const overAmount = isOverLimit
    ? Number(cp.projected_outstanding) - Number(cp.credit_limit)
    : 0;
  const availableAmount = Number(cp.available_credit);

  // Totals calculations
  const subtotal =
    (order as any).subtotal !== undefined
      ? Number((order as any).subtotal)
      : (order.lines || []).reduce((acc, l) => acc + (Number(l.line_total) || 0), 0);
  const total = Number(order.total) || subtotal;
  const gst =
    (order as any).gst !== undefined
      ? Number((order as any).gst)
      : Math.max(0, total - subtotal);

  // Credit hold orders are ONLY eligible for override & approve; normal approve is disabled
  const canApproveNormal = !isCreditHold;
  // A normal pending order should not be eligible for override & approve; only credit hold can be overridden
  const canApproveOverride = isCreditHold && overrideReason.trim().length > 0;

  return (
    <div className="w-[40%] flex-1 h-full min-h-0 flex flex-col bg-white overflow-hidden select-none">
      {/* ZONE 1: Fixed Header (~64px): Retailer name, status, and one grey line */}
      <div className="h-16 shrink-0 px-4 py-2 border-b border-border flex flex-col justify-center bg-white">
        <div className="flex items-center justify-between">
          <h2 className="desk-title text-ink leading-tight truncate">
            {order.retailer_name}
          </h2>
          <div className="text-right shrink-0 ml-2">
            {order.status === 'credit_hold' ? (
              <span className="desk-body font-semibold text-error">
                {t.status_credit_hold}
              </span>
            ) : order.status === 'approved' ? (
              <span className="desk-body font-semibold text-primary">
                {t.status_approved}
              </span>
            ) : (
              <span className="desk-body text-ink-muted">
                {t.status_pending}
              </span>
            )}
          </div>
        </div>
        <p className="desk-meta text-ink-muted truncate mt-0.5">
          {t.order_number.replace('{id}', String(order.id))} · {getSourceLabel(order.source)} · {formatDateTime(order.created_at)}
        </p>
      </div>

      {/* ZONE 2: Body Zone with scrollable content and pinned error line directly above footer */}
      <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden">
        {/* Scrollable Content (lines table, totals, credit position) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
          {/* Lines Table without 'ORDER ITEMS' label */}
          <div className="w-full">
            <table className="w-full text-left border-collapse desk-body">
              <thead>
                <tr className="h-8 border-b border-border desk-meta font-semibold text-ink-muted">
                  <th className="font-semibold pb-1">{t.col_product}</th>
                  <th className="font-semibold pb-1 text-right tabular-nums w-14">{t.col_cases}</th>
                  <th className="font-semibold pb-1 text-right tabular-nums w-12">{t.col_free}</th>
                  <th className="font-semibold pb-1 text-right tabular-nums w-14">{t.col_stock}</th>
                  <th className="font-semibold pb-1 text-right tabular-nums w-20">{t.col_line_total}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {editableLines.map((line, idx) => {
                  const catSku = catalogue.find((c) => c.sku_code === line.sku_code);
                  const stock = catSku?.stock_cases ?? 0;
                  const needed = (Number(line.qty_cases) || 0) + (Number(line.free_cases) || 0);
                  const isShort = needed > stock;

                  return (
                    <tr key={line.line_id || idx} className="h-10 py-1 desk-body">
                      {/* Product Dropdown (with title tooltip) or Read-only Label */}
                      <td className="py-1.5 pr-2 align-middle">
                        {isApproved ? (
                          <div
                            className="font-medium text-ink truncate desk-body"
                            title={catSku?.name || line.sku_code}
                          >
                            {catSku?.name || line.sku_code}
                          </div>
                        ) : (
                          <select
                            value={line.sku_code}
                            title={catSku?.name || line.sku_code}
                            onChange={(e) => handleSkuChange(idx, e.target.value)}
                            className="w-full h-8 px-2 desk-body border border-border rounded bg-white text-ink focus:outline-none focus:border-primary truncate"
                          >
                            {catalogue.map((s) => (
                              <option key={s.sku_code} value={s.sku_code} title={s.name}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>

                      {/* Cases Input / Text (right-aligned, tabular-nums) */}
                      <td className="py-1.5 px-1 text-right align-middle">
                        {isApproved ? (
                          <span className="text-ink tabular-nums">{line.qty_cases}</span>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            value={line.qty_cases}
                            onChange={(e) => handleQtyChange(idx, parseInt(e.target.value, 10) || 0)}
                            className="w-14 h-8 text-right px-1.5 border border-border rounded desk-body text-ink focus:outline-none focus:border-primary tabular-nums"
                          />
                        )}
                      </td>

                      {/* Free (Read-only Text, right-aligned, tabular-nums) */}
                      <td className="py-1.5 px-1 text-right align-middle text-ink-muted tabular-nums">
                        {line.free_cases || 0}
                      </td>

                      {/* Stock from Catalogue (right-aligned, tabular-nums) */}
                      <td className="py-1.5 px-1 text-right align-middle tabular-nums">
                        {isShort ? (
                          <span className="text-error font-medium">
                            {stock} ({t.stock_short})
                          </span>
                        ) : (
                          <span className="text-ink-muted">{stock}</span>
                        )}
                      </td>

                      {/* Line Total (right-aligned, tabular-nums) */}
                      <td className="py-1.5 pl-2 text-right align-middle font-semibold text-ink tabular-nums">
                        {formatINR(line.line_total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals Breakdown */}
          <div className="flex flex-col items-end gap-1 pb-2 border-b border-border shrink-0">
            <div className="flex justify-between w-48 text-ink-muted desk-body">
              <span>{t.subtotal}</span>
              <span className="tabular-nums text-right">{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between w-48 text-ink-muted desk-body">
              <span>{t.gst}</span>
              <span className="tabular-nums text-right">{formatINR(gst)}</span>
            </div>
            <div className="flex justify-between w-48 text-ink pt-1 border-t border-border desk-money-lg">
              <span>{t.total}</span>
              <span className="tabular-nums text-right">{formatINR(total)}</span>
            </div>
          </div>

          {/* Credit Position: Compact 2x2 grid with status text on its own line under it */}
          <div className="p-3 border border-border rounded bg-white shrink-0">
            <div className="desk-meta font-semibold text-ink mb-2">
              {t.credit_position}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 desk-body">
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.credit_limit}</span>
                <span className="font-medium text-ink tabular-nums text-right">{formatINR(cp.credit_limit, false)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.credit_outstanding}</span>
                <span className="font-medium text-ink tabular-nums text-right">{formatINR(cp.outstanding, false)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.credit_this_order}</span>
                <span className="font-medium text-ink tabular-nums text-right">{formatINR(cp.current_order_total, false)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">{t.credit_projected}</span>
                <span className="font-medium text-ink tabular-nums text-right">{formatINR(cp.projected_outstanding, false)}</span>
              </div>
            </div>

            {/* Over limit / Within limit on its own line under 2x2 grid */}
            <div className="mt-2 pt-1.5 border-t border-border flex justify-end">
              {isOverLimit ? (
                <span className="desk-body font-semibold text-error tabular-nums">
                  {t.over_limit_by.replace('{amount}', formatINR(overAmount, false))}
                </span>
              ) : (
                <span className="desk-body font-semibold text-primary tabular-nums">
                  {t.within_limit.replace('{amount}', formatINR(availableAmount, false))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Error and 409 messages appear as a single line directly above footer, inside body zone's bottom edge */}
        {isConflict && (
          <div className="px-4 py-2 border-t border-border bg-white shrink-0">
            <div className="flex items-center justify-between px-3 py-1 bg-[#fef3c7] border border-[#fcd34d] rounded text-[#92400e] desk-meta">
              <div className="flex items-center gap-1.5 truncate mr-2">
                <WarningIcon className="w-4 h-4 text-[#92400e] shrink-0" />
                <span className="truncate">{t.conflict_error}</span>
              </div>
              <button
                type="button"
                onClick={onReloadOrder}
                className="px-2 py-0.5 desk-body font-semibold rounded bg-white border border-[#fcd34d] text-[#92400e] hover:bg-[#fffbeb] transition-colors shrink-0"
              >
                {t.btn_reload}
              </button>
            </div>
          </div>
        )}

        {actionError && !isConflict && (
          <div className="px-4 py-2 border-t border-border bg-white shrink-0">
            <div className="px-3 py-1 bg-red-50 border border-red-200 rounded text-error desk-meta truncate">
              <p className="truncate font-medium">{actionError}</p>
            </div>
          </div>
        )}
      </div>

      {/* ZONE 3: Fixed Footer at bottom of panel (p-3 border-t bg-white) */}
      <div className="shrink-0 p-3 border-t border-border bg-white flex flex-col gap-2.5">
        {isApproved ? (
          /* Approved orders: footer shows only 'Approved by NAME, date' line; no reason or buttons */
          <div className="flex flex-col items-end justify-center min-h-[40px] text-right">
            <div className="desk-meta text-ink-muted">
              {t.approved_by_info
                .replace('{name}', order.approved_by || 'Staff')
                .replace('{time}', formatDateTime(order.approved_at))}
            </div>
            {order.override_reason && (
              <div className="desk-meta text-ink-muted mt-0.5">
                {t.override_reason_note.replace('{reason}', order.override_reason)}
              </div>
            )}
          </div>
        ) : (
          /* Non-approved orders: override reason input + 3 evenly-sized 40px buttons */
          <>
            {/* Override reason field: 36px, one line */}
            <input
              ref={overrideInputRef}
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              disabled={!isCreditHold}
              placeholder={t.override_placeholder}
              className={`h-9 px-3 desk-body border border-border rounded text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary w-full ${
                !isCreditHold ? 'bg-gray-50 text-ink-muted cursor-not-allowed' : 'bg-white'
              }`}
            />

            {/* Row of three buttons, 40px tall (h-10), sized evenly, no text wrap */}
            <div className="flex items-center gap-1.5 w-full">
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleSaveClick}
                className={`desk-body font-semibold flex-1 h-10 px-1 border border-border rounded transition-colors flex items-center justify-center text-center whitespace-nowrap truncate ${
                  actionLoading
                    ? 'bg-gray-100 text-ink-muted cursor-not-allowed font-medium'
                    : 'text-ink hover:bg-gray-50'
                }`}
              >
                {actionLoading ? t.saving : t.btn_save_edits}
              </button>

              <button
                type="button"
                disabled={actionLoading || !canApproveNormal}
                onClick={handleApproveNormal}
                className={`desk-body font-semibold flex-1 h-10 px-1 rounded transition-colors flex items-center justify-center text-center whitespace-nowrap truncate ${
                  actionLoading || !canApproveNormal
                    ? 'border border-gray-200 bg-gray-100 text-ink-muted cursor-not-allowed font-medium'
                    : 'bg-[#0c831f] text-white hover:bg-[#0a6f1a]'
                }`}
              >
                {actionLoading ? t.approving : t.btn_approve}
              </button>

              <button
                type="button"
                disabled={actionLoading || !canApproveOverride}
                onClick={handleApproveWithOverride}
                className={`desk-body font-semibold flex-1 h-10 px-1 rounded transition-colors flex items-center justify-center text-center whitespace-nowrap truncate ${
                  actionLoading || !canApproveOverride
                    ? 'border border-gray-200 bg-gray-100 text-ink-muted cursor-not-allowed font-medium'
                    : 'bg-[#0c831f] text-white hover:bg-[#0a6f1a]'
                }`}
              >
                {t.btn_approve_override}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
