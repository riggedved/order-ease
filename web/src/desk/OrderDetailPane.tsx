import React, { useState, useEffect } from 'react';
import type { DeskLanguage } from './i18n';
import { deskTranslations } from './i18n';
import type { DeskOrderDetail, DeskCatalogueSKU } from './types';
import { formatINR, formatDateTime } from './formatters';
import { WarningIcon, ReloadIcon } from './icons';

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
      <div className="w-[40%] flex flex-col items-center justify-center p-8 bg-white text-ink-muted text-[14px]">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3"></div>
        <span>{t.loading_details}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-[40%] flex flex-col items-center justify-center p-8 bg-white text-[14px]">
        <p className="text-error font-medium mb-3">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-1.5 border border-border rounded text-ink hover:bg-gray-50 text-[14px]"
        >
          {t.btn_retry}
        </button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="w-[40%] flex flex-col items-center justify-center p-8 bg-white text-ink-muted text-[14px] text-center">
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
    if (isCreditHold) {
      // Credit hold requires override note
      if (!overrideReason.trim()) return;
      await onApprove(true, overrideReason.trim());
    } else {
      await onApprove(false);
    }
  };

  const handleApproveWithOverride = async () => {
    if (!overrideReason.trim()) return;
    await onApprove(true, overrideReason.trim());
  };

  // Credit Position calculations
  const cp = order.credit_position;
  const isOverLimit = cp.is_over_limit;
  const overAmount = isOverLimit
    ? Number(cp.projected_outstanding) - Number(cp.credit_limit)
    : 0;
  const availableAmount = Number(cp.available_credit);

  const canApproveNormal = isCreditHold ? overrideReason.trim().length > 0 : true;
  const canApproveOverride = overrideReason.trim().length > 0;

  return (
    <div className="w-[40%] flex flex-col p-5 bg-white overflow-y-auto min-h-[calc(100vh-56px)] select-none">
      {/* Order Header */}
      <div className="flex items-start justify-between pb-4 border-b border-border">
        <div>
          <h2 className="text-[18px] font-bold text-ink leading-tight">
            {order.retailer_name}
          </h2>
          <p className="text-[13px] text-ink-muted mt-1">
            {t.order_number.replace('{id}', String(order.id))} · {getSourceLabel(order.source)} · {formatDateTime(order.created_at)}
          </p>
        </div>
        <div className="text-right">
          {order.status === 'credit_hold' ? (
            <span className="text-[14px] font-semibold text-error">
              {t.status_credit_hold}
            </span>
          ) : order.status === 'approved' ? (
            <span className="text-[14px] font-semibold text-primary">
              {t.status_approved}
            </span>
          ) : (
            <span className="text-[14px] text-ink-muted">
              {t.status_pending}
            </span>
          )}
        </div>
      </div>

      {/* Amber Banner on 409 Conflict Only */}
      {isConflict && (
        <div className="my-3 flex items-center justify-between px-3 py-2 bg-[#fef3c7] border border-[#fcd34d] rounded text-[#92400e]">
          <div className="flex items-center gap-2">
            <WarningIcon className="w-4 h-4 text-[#92400e] shrink-0" />
            <span className="text-[13px] font-medium">{t.conflict_error}</span>
          </div>
          <button
            type="button"
            onClick={onReloadOrder}
            className="px-2.5 py-1 text-[13px] font-semibold rounded bg-white border border-[#fcd34d] text-[#92400e] hover:bg-[#fffbeb] transition-colors flex items-center gap-1"
          >
            <ReloadIcon className="w-3.5 h-3.5" />
            <span>{t.btn_reload}</span>
          </button>
        </div>
      )}

      {/* Plain Text Structured Error Banner */}
      {actionError && !isConflict && (
        <div className="my-3 p-3 bg-red-50 border border-red-200 rounded text-error text-[13px]">
          <p className="font-medium">{actionError}</p>
        </div>
      )}

      {/* Lines Table */}
      <div className="w-full my-4">
        <div className="text-[13px] font-semibold text-ink-muted uppercase tracking-wider pb-2">
          {t.order_items}
        </div>
        <table className="w-full text-left border-collapse text-[14px]">
          <thead>
            <tr className="h-8 border-b border-border text-[13px] text-ink-muted">
              <th className="font-medium pb-1">{t.col_product}</th>
              <th className="font-medium pb-1 text-center w-14">{t.col_cases}</th>
              <th className="font-medium pb-1 text-center w-12">{t.col_free}</th>
              <th className="font-medium pb-1 text-right w-14">{t.col_stock}</th>
              <th className="font-medium pb-1 text-right w-24">{t.col_line_total}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {editableLines.map((line, idx) => {
              const catSku = catalogue.find((c) => c.sku_code === line.sku_code);
              const stock = catSku?.stock_cases ?? 0;
              const needed = (Number(line.qty_cases) || 0) + (Number(line.free_cases) || 0);
              const isShort = needed > stock;
              const isAliasLearned =
                Boolean(line.original_words) && line.sku_code !== line.initial_sku_code;

              return (
                <tr key={line.line_id || idx} className="py-2.5">
                  {/* Product Dropdown or Read-only Label */}
                  <td className="py-2 pr-2 align-top">
                    {isApproved ? (
                      <div className="font-medium text-ink">
                        {catSku?.name || line.sku_code}
                      </div>
                    ) : (
                      <select
                        value={line.sku_code}
                        onChange={(e) => handleSkuChange(idx, e.target.value)}
                        className="w-full h-8 px-2 text-[14px] border border-border rounded bg-white text-ink focus:outline-none focus:border-primary truncate"
                      >
                        {catalogue.map((s) => (
                          <option key={s.sku_code} value={s.sku_code}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Original captured words in grey quotes */}
                    {line.original_words && (
                      <div className="text-[13px] text-ink-muted italic mt-0.5">
                        "{line.original_words}"
                      </div>
                    )}

                    {/* Alias learning notice */}
                    {isAliasLearned && (
                      <div className="text-[13px] text-primary font-medium mt-0.5">
                        {t.saves_as_alias}
                      </div>
                    )}
                  </td>

                  {/* Cases Input / Text */}
                  <td className="py-2 px-1 text-center align-top">
                    {isApproved ? (
                      <span className="text-ink">{line.qty_cases}</span>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        value={line.qty_cases}
                        onChange={(e) => handleQtyChange(idx, parseInt(e.target.value, 10) || 0)}
                        className="w-14 h-8 text-center border border-border rounded text-[14px] text-ink focus:outline-none focus:border-primary"
                      />
                    )}
                  </td>

                  {/* Free (Read-only Text) */}
                  <td className="py-2 px-1 text-center align-top text-ink-muted text-[14px] pt-3">
                    {line.free_cases || 0}
                  </td>

                  {/* Stock from Catalogue */}
                  <td className="py-2 px-1 text-right align-top pt-3 text-[14px] tabular-nums">
                    {isShort ? (
                      <span className="text-error font-medium">
                        {stock} ({t.stock_short})
                      </span>
                    ) : (
                      <span className="text-ink-muted">{stock}</span>
                    )}
                  </td>

                  {/* Line Total */}
                  <td className="py-2 pl-2 text-right align-top pt-3 font-semibold text-ink text-[14px] tabular-nums">
                    {formatINR(line.line_total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totals Breakdown from Server */}
      <div className="flex flex-col items-end gap-1 pb-4 mb-4 border-b border-border text-[14px]">
        {/* If server returns subtotal/gst, display them. Otherwise show Total */}
        {(order as any).subtotal !== undefined && (
          <div className="flex justify-between w-48 text-ink-muted">
            <span>{t.subtotal}</span>
            <span className="tabular-nums">{formatINR((order as any).subtotal)}</span>
          </div>
        )}
        {(order as any).gst !== undefined && (
          <div className="flex justify-between w-48 text-ink-muted">
            <span>{t.gst}</span>
            <span className="tabular-nums">{formatINR((order as any).gst)}</span>
          </div>
        )}
        <div className="flex justify-between w-48 font-bold text-ink pt-1 border-t border-border text-[16px]">
          <span>{t.total}</span>
          <span className="tabular-nums">{formatINR(order.total)}</span>
        </div>

        {/* Approved By & Override Note for Approved Orders */}
        {isApproved && (
          <div className="pt-2 text-right">
            <div className="text-[13px] text-ink-muted">
              {t.approved_by_info
                .replace('{name}', order.approved_by || 'Staff')
                .replace('{time}', formatDateTime(order.approved_at))}
            </div>
            {order.override_reason && (
              <div className="text-[13px] text-ink-muted mt-0.5">
                {t.override_reason_note.replace('{reason}', order.override_reason)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Credit Position Box */}
      <div className="p-3.5 border border-border rounded bg-white mb-4">
        <div className="text-[14px] font-semibold text-ink mb-2.5">
          {t.credit_position}
        </div>
        <div className="grid grid-cols-2 gap-y-1.5 text-[14px]">
          <span className="text-ink-muted">{t.credit_limit}</span>
          <span className="text-right font-medium text-ink tabular-nums">
            {formatINR(cp.credit_limit, false)}
          </span>
          <span className="text-ink-muted">{t.credit_outstanding}</span>
          <span className="text-right font-medium text-ink tabular-nums">
            {formatINR(cp.outstanding, false)}
          </span>
          <span className="text-ink-muted">{t.credit_this_order}</span>
          <span className="text-right font-medium text-ink tabular-nums">
            {formatINR(cp.current_order_total, false)}
          </span>
          <div className="col-span-2 border-t border-border my-1"></div>
          <span className="font-semibold text-ink">{t.credit_projected}</span>
          <span className="text-right font-semibold text-ink tabular-nums">
            {formatINR(cp.projected_outstanding, false)}
          </span>
        </div>

        {/* Status Line: Over limit by ₹X or Within limit (₹X available) */}
        <div className="mt-2.5 pt-2 border-t border-border flex items-center justify-end">
          {isOverLimit ? (
            <span className="text-[14px] font-semibold text-error tabular-nums">
              {t.over_limit_by.replace('{amount}', formatINR(overAmount, false))}
            </span>
          ) : (
            <span className="text-[14px] font-semibold text-primary tabular-nums">
              {t.within_limit.replace('{amount}', formatINR(availableAmount, false))}
            </span>
          )}
        </div>
      </div>

      {/* Action Controls for Non-Approved Orders */}
      {!isApproved && (
        <div className="flex flex-col gap-3 mt-auto">
          {/* Override Reason Field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink">
              {t.override_reason_label}
            </label>
            <input
              ref={overrideInputRef}
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder={t.override_placeholder}
              className="h-9 px-3 text-[14px] border border-border rounded text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1">
            {/* Save Edits Button */}
            <button
              type="button"
              disabled={actionLoading}
              onClick={handleSaveClick}
              className={`flex-1 h-9 px-3 border border-border rounded text-[14px] font-medium transition-colors ${
                actionLoading
                  ? 'bg-gray-100 text-ink-subtle cursor-not-allowed'
                  : 'text-ink hover:bg-gray-50'
              }`}
            >
              {actionLoading ? t.saving : t.btn_save_edits}
            </button>

            {/* Approve Button (Outlined, disabled for credit-hold orders until reason is typed) */}
            <button
              type="button"
              disabled={actionLoading || !canApproveNormal}
              onClick={handleApproveNormal}
              className={`flex-1 h-9 px-3 rounded text-[14px] font-medium transition-colors ${
                actionLoading || !canApproveNormal
                  ? 'border border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'border border-border text-ink hover:bg-gray-50'
              }`}
            >
              {actionLoading ? t.approving : t.btn_approve}
            </button>

            {/* Approve with Override Button (Green, needs the reason) */}
            <button
              type="button"
              disabled={actionLoading || !canApproveOverride}
              onClick={handleApproveWithOverride}
              className={`flex-1 h-9 px-3 rounded text-[14px] font-semibold transition-colors ${
                actionLoading || !canApproveOverride
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-[#0c831f] text-white hover:bg-[#0a6f1a]'
              }`}
            >
              {t.btn_approve_override}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

