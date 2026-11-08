import React, { useState, useEffect, useRef } from 'react';
import type { DeskLanguage } from './i18n';
import { deskTranslations } from './i18n';
import type { DeskCatalogueSKU } from './types';
import type { SimpleRetailer } from './api';
import { fetchDeskRetailers, captureDeskOrder, postDeskOrder } from './api';
import { formatINR } from './formatters';

export interface CaptureViewProps {
  token: string;
  lang: DeskLanguage;
  catalogue?: DeskCatalogueSKU[];
  onOrderCreated?: (orderId: number) => void;
}

export const CaptureView: React.FC<CaptureViewProps> = ({
  token,
  lang,
  catalogue = [],
  onOrderCreated,
}) => {
  const t = deskTranslations[lang];

  // Retailer Selection State
  const [retailers, setRetailers] = useState<SimpleRetailer[]>([]);
  const [selectedRetailerId, setSelectedRetailerId] = useState<number | ''>('');
  const [retailerQuery, setRetailerQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const retailerContainerRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<any>(null);

  // Message & Parsing State
  const [messageText, setMessageText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Parsed Results & Preview Quote State
  const [parsedLines, setParsedLines] = useState<any[]>([]);
  const [previewQuote, setPreviewQuote] = useState<any | null>(null);

  const sampleOrderText =
    'bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti';

  // Fetch initial retailers
  useEffect(() => {
    fetchDeskRetailers(token)
      .then((data) => {
        setRetailers(data);
        if (data.length > 0 && !selectedRetailerId) {
          setSelectedRetailerId(data[0].id);
          setRetailerQuery(data[0].name);
        }
      })
      .catch((err) => console.error('Error fetching retailers:', err));
  }, [token]);

  // Click outside listener for retailer dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        retailerContainerRef.current &&
        !retailerContainerRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
        const selected = retailers.find((r) => r.id === selectedRetailerId);
        if (selected) {
          setRetailerQuery(selected.name);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [retailers, selectedRetailerId]);

  // Handle typing to search retailer
  const handleRetailerInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRetailerQuery(val);
    setIsDropdownOpen(true);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      fetchDeskRetailers(token, val.trim())
        .then((data) => setRetailers(data))
        .catch((err) => console.error('Retailer search error:', err));
    }, 250);
  };

  const handleSelectRetailer = (ret: SimpleRetailer) => {
    setSelectedRetailerId(ret.id);
    setRetailerQuery(ret.name);
    setIsDropdownOpen(false);
  };

  // Parse Message Handler
  const handleParse = async () => {
    if (!selectedRetailerId || !messageText.trim() || parsing) return;

    setParsing(true);
    setParseError(null);
    setSuccessMsg(null);
    try {
      const res = await captureDeskOrder(token, Number(selectedRetailerId), messageText.trim());
      setParsedLines(res.lines || []);
      setPreviewQuote(res.preview_quote || null);
    } catch (err: any) {
      setParseError(err.message || 'Failed to read message');
    } finally {
      setParsing(false);
    }
  };

  // Unit toggle handler for "Cases or pieces?" choice
  const handleSetUnit = (index: number, unit: 'case' | 'piece') => {
    setParsedLines((prev) => {
      const updated = [...prev];
      const target = { ...updated[index] };
      const flags = (target.flags || []).filter((f: string) => f !== 'needs_unit');
      target.unit = unit;
      target.flags = flags;
      updated[index] = target;
      return updated;
    });
  };

  // Handle quantity edit
  const handleQtyChange = (index: number, newQty: number) => {
    const qty = Math.max(1, newQty);
    setParsedLines((prev) => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        qty,
        qty_cases: qty,
      };
      return updated;
    });
  };

  // Alternative SKU selector handler
  const handleSelectAlternative = (index: number, altSkuCode: string) => {
    setParsedLines((prev) => {
      const updated = [...prev];
      const target = { ...updated[index] };
      const altSku = catalogue.find((s) => s.sku_code === altSkuCode);
      const flags = (target.flags || []).filter(
        (f: string) => f !== 'no_match' && f !== 'out_of_stock'
      );
      if (altSku && altSku.stock_cases <= 0) {
        flags.push('out_of_stock');
      }
      target.sku_code = altSkuCode;
      target.flags = flags;
      updated[index] = target;
      return updated;
    });
  };

  // Discard action
  const handleDiscard = () => {
    setParsedLines([]);
    setPreviewQuote(null);
    setParseError(null);
    setSuccessMsg(null);
  };

  // Confirm Order Handler
  const handleConfirmOrder = async () => {
    if (!canConfirm || !selectedRetailerId) return;

    setConfirming(true);
    setParseError(null);
    try {
      const validLines = parsedLines
        .filter(
          (l) =>
            l.sku_code &&
            l.unit === 'case' &&
            !l.flags?.includes('out_of_stock') &&
            !l.flags?.includes('no_match')
        )
        .map((l) => ({
          sku_code: l.sku_code,
          qty_cases: Number(l.qty || l.qty_cases || 1),
          original_words: l.original_words || null,
        }));

      if (validLines.length === 0) {
        setParseError('No valid items to order');
        setConfirming(false);
        return;
      }

      const order = await postDeskOrder(token, Number(selectedRetailerId), validLines);
      setSuccessMsg(t.order_confirmed_msg.replace('{id}', String(order.id)));
      setParsedLines([]);
      setMessageText('');
      setPreviewQuote(null);
      if (onOrderCreated) {
        onOrderCreated(order.id);
      }
    } catch (err: any) {
      setParseError(err.message || 'Failed to confirm order');
    } finally {
      setConfirming(false);
    }
  };

  // Calculations for footer & validation
  const hasResult = parsedLines.length > 0;
  const hasOpenQuestion = parsedLines.some(
    (l) =>
      !l.flags?.includes('out_of_stock') &&
      (!l.unit || l.unit === 'unknown' || l.flags?.includes('needs_unit'))
  );
  const canConfirm = hasResult && !hasOpenQuestion && !confirming && !parsing;

  const previewPayable =
    parsedLines.reduce((acc, line) => {
      if (
        line.flags?.includes('out_of_stock') ||
        line.flags?.includes('no_match') ||
        line.unit !== 'case'
      ) {
        return acc;
      }
      const ql = previewQuote?.lines?.find((q: any) => q.sku_code === line.sku_code);
      const sku = catalogue.find((s) => s.sku_code === line.sku_code);
      const price = Number(ql?.case_price || sku?.case_price || 0);
      const qty = Number(line.qty || line.qty_cases || 1);
      return acc + price * qty;
    }, 0) || (previewQuote?.subtotal ? Number(previewQuote.subtotal) : 0);

  const excludedCount = parsedLines.filter(
    (l) =>
      l.flags?.includes('out_of_stock') ||
      l.flags?.includes('no_match') ||
      (l.unit && l.unit !== 'case')
  ).length;

  return (
    <div className="w-full flex-1 h-full min-h-0 flex flex-col bg-white overflow-hidden select-none">
      {/* 1. Heading row (48px) */}
      <div className="h-12 shrink-0 px-6 border-b border-border flex items-center justify-between bg-white">
        <h2 className="text-[18px] font-bold text-ink shrink-0 leading-none">
          {t.title_capture}
        </h2>

        {/* Labelled Searchable Retailer Selector (~280px wide) */}
        <div className="flex items-center shrink-0">
          <label
            htmlFor="retailer-search"
            className="text-[13px] font-medium text-ink-muted mr-2 shrink-0"
          >
            {t.retailer_label}:
          </label>
          <div ref={retailerContainerRef} className="relative w-[280px]">
            <input
              id="retailer-search"
              type="text"
              value={retailerQuery}
              onChange={handleRetailerInputChange}
              onFocus={() => setIsDropdownOpen(true)}
              placeholder={t.select_retailer}
              className="h-9 w-full px-3 pr-8 text-[14px] border border-border rounded bg-white text-ink focus:outline-none focus:border-primary truncate"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {isDropdownOpen && retailers.length > 0 && (
              <ul className="absolute left-0 top-full mt-1 w-full max-h-48 overflow-y-auto bg-white border border-border rounded z-50 divide-y divide-border shadow-sm">
                {retailers.map((r) => (
                  <li
                    key={r.id}
                    onClick={() => handleSelectRetailer(r)}
                    className={`px-3 py-2 text-[14px] text-ink hover:bg-gray-50 cursor-pointer truncate ${
                      r.id === selectedRetailerId ? 'bg-gray-50 font-semibold' : ''
                    }`}
                  >
                    {r.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* 2. Message area (textarea full width, read button below) */}
      <div className="shrink-0 px-6 py-2.5 border-b border-border bg-white flex flex-col gap-2">
        <textarea
          rows={3}
          value={messageText}
          onChange={(e) => {
            setMessageText(e.target.value);
            if (parseError) setParseError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (!parsing && messageText.trim() && selectedRetailerId) {
                handleParse();
              }
            }
          }}
          placeholder={t.capture_input_placeholder}
          className="w-full text-[14px] text-ink border border-border rounded p-2.5 min-h-[72px] max-h-[144px] resize-y focus:outline-none focus:border-primary placeholder:text-ink-muted leading-snug"
        />

        {/* Below textarea: Example line on the left, Read message button on the right */}
        <div className="flex items-center justify-between gap-4">
          <div className="text-[13px] text-ink-muted flex-1 min-w-0">
            <span>{t.capture_example_label} · </span>
            <button
              type="button"
              onClick={() => {
                setMessageText(sampleOrderText);
                if (parseError) setParseError(null);
              }}
              className="text-primary hover:underline font-medium ml-1 cursor-pointer focus:outline-none"
            >
              {t.capture_try_example}
            </button>
          </div>

          <button
            type="button"
            onClick={handleParse}
            disabled={parsing || !messageText.trim() || !selectedRetailerId}
            className={`h-10 px-6 rounded text-[13px] font-semibold transition-colors shrink-0 flex items-center justify-center whitespace-nowrap ${
              parsing || !messageText.trim() || !selectedRetailerId
                ? 'bg-gray-100 text-ink-subtle cursor-not-allowed font-medium'
                : 'bg-primary text-white hover:bg-[#0a6f1a]'
            }`}
          >
            {parsing ? t.reading_message : t.btn_read_message}
          </button>
        </div>

        {/* Failure message with Retry button */}
        {parseError && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-red-50 border border-red-200 rounded text-error text-[13px]">
            <span>{parseError}</span>
            <button
              type="button"
              onClick={handleParse}
              className="font-semibold underline ml-2 hover:text-red-800"
            >
              {t.btn_retry}
            </button>
          </div>
        )}

        {/* Success message */}
        {successMsg && (
          <div className="px-3 py-1.5 bg-[#f0fdf4] border border-[#bbf7d0] rounded text-primary text-[13px] font-semibold">
            {successMsg}
          </div>
        )}
      </div>

      {/* 3. Results region (flex-1, min-h-0, overflow-y-auto) */}
      <div className="w-full flex-1 min-h-0 overflow-y-auto px-6 py-4">
        {!hasResult ? (
          <div className="flex items-center justify-center h-48 text-ink-muted text-[14px]">
            {t.capture_empty_short}
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10 border-b border-border">
              <tr className="h-9 text-ink-muted text-[13px]">
                <th className="px-3 font-medium bg-gray-50">{t.col_original_words}</th>
                <th className="px-3 font-medium bg-gray-50">{t.col_product}</th>
                <th className="px-3 font-medium text-center bg-gray-50">{t.col_cases}</th>
                <th className="px-3 font-medium text-center bg-gray-50">{t.col_unit}</th>
                <th className="px-3 font-medium text-center bg-gray-50">{t.col_confidence}</th>
                <th className="px-3 font-medium bg-gray-50">{t.col_alternatives}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {parsedLines.map((line, idx) => {
                const sku = catalogue.find((s) => s.sku_code === line.sku_code);
                const ql = previewQuote?.lines?.find((q: any) => q.sku_code === line.sku_code);
                const isOutOfStock =
                  line.flags?.includes('out_of_stock') ||
                  (sku && sku.stock_cases <= 0) ||
                  (ql && ql.is_blocked);
                const isNoMatch = line.flags?.includes('no_match') || !line.sku_code;
                const needsUnit =
                  (line.flags?.includes('needs_unit') || line.unit === 'unknown' || !line.unit) &&
                  !isOutOfStock &&
                  !isNoMatch;
                const productName = ql?.name || sku?.name || line.sku_code || '';

                return (
                  <tr
                    key={idx}
                    className={`h-11 text-[14px] hover:bg-gray-50 transition-colors ${
                      isOutOfStock ? 'bg-red-50/20' : ''
                    }`}
                  >
                    {/* Original Words */}
                    <td className="px-3 text-ink-muted text-[13px] italic max-w-[200px] truncate">
                      {line.original_words ? `"${line.original_words}"` : '—'}
                    </td>

                    {/* Matched Product */}
                    <td className="px-3 font-medium text-ink">
                      {isNoMatch ? (
                        <span className="text-error font-semibold">{t.not_found}</span>
                      ) : isOutOfStock ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="line-through text-ink-muted">{productName}</span>
                          <span className="text-error text-[12px] font-semibold no-underline">
                            ({t.out_of_stock})
                          </span>
                        </div>
                      ) : (
                        <span>{productName}</span>
                      )}
                    </td>

                    {/* Cases (editable input) */}
                    <td className="px-3 text-center">
                      {isOutOfStock || isNoMatch ? (
                        <span className="text-ink-muted line-through tabular-nums">
                          {line.qty || line.qty_cases || 1}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min="1"
                          value={line.qty || line.qty_cases || 1}
                          onChange={(e) =>
                            handleQtyChange(idx, parseInt(e.target.value) || 1)
                          }
                          className="w-16 h-8 text-center border border-border rounded text-[14px] font-semibold text-ink focus:outline-none focus:border-primary tabular-nums bg-white"
                        />
                      )}
                    </td>

                    {/* Unit ("Cases or pieces?" choice if unit is unknown/needs_unit) */}
                    <td className="px-3 text-center">
                      {isOutOfStock || isNoMatch ? (
                        <span className="text-ink-muted text-[13px]">—</span>
                      ) : needsUnit ? (
                        <div className="inline-flex items-center gap-1 border border-border rounded overflow-hidden p-0.5 bg-gray-50">
                          <button
                            type="button"
                            onClick={() => handleSetUnit(idx, 'case')}
                            className={`px-2 py-0.5 text-[12px] rounded font-medium transition-colors ${
                              line.unit === 'case'
                                ? 'bg-primary text-white shadow-none'
                                : 'text-ink hover:bg-white'
                            }`}
                          >
                            {t.unit_case}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetUnit(idx, 'piece')}
                            className={`px-2 py-0.5 text-[12px] rounded font-medium transition-colors border-l border-border ${
                              line.unit === 'piece'
                                ? 'bg-primary text-white shadow-none'
                                : 'text-ink hover:bg-white'
                            }`}
                          >
                            {t.unit_piece}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[13px] text-ink font-medium">
                          {line.unit === 'case'
                            ? t.unit_case
                            : line.unit === 'piece'
                            ? t.unit_piece
                            : line.unit || '—'}
                        </span>
                      )}
                    </td>

                    {/* Confidence */}
                    <td className="px-3 text-center">
                      {isOutOfStock || isNoMatch ? (
                        <span className="text-ink-muted text-[13px]">—</span>
                      ) : line.confidence === 'high' ||
                        (typeof line.confidence === 'number' && line.confidence >= 0.8) ? (
                        <span className="text-[13px] font-semibold text-primary">
                          {t.confidence_high}
                        </span>
                      ) : line.confidence === 'medium' ||
                        (typeof line.confidence === 'number' && line.confidence >= 0.5) ? (
                        <span className="text-[13px] font-semibold text-amber-700">
                          {t.confidence_medium}
                        </span>
                      ) : line.confidence === 'low' ||
                        (typeof line.confidence === 'number' && line.confidence < 0.5) ? (
                        <span className="text-[13px] font-semibold text-error">
                          {t.confidence_low}
                        </span>
                      ) : (
                        <span className="text-[13px] text-ink-muted">
                          {line.confidence || '—'}
                        </span>
                      )}
                    </td>

                    {/* Alternatives */}
                    <td className="px-3">
                      {line.alternatives && line.alternatives.length > 0 ? (
                        <select
                          value=""
                          onChange={(e) =>
                            e.target.value && handleSelectAlternative(idx, e.target.value)
                          }
                          className="h-7 px-2 text-[12px] border border-border rounded bg-white text-ink focus:outline-none cursor-pointer max-w-[200px] truncate"
                        >
                          <option value="">{t.select_alternative}</option>
                          {line.alternatives.map((altCode: string) => {
                            const altSku = catalogue.find((s) => s.sku_code === altCode);
                            return (
                              <option key={altCode} value={altCode}>
                                {altSku ? altSku.name : altCode}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <span className="text-ink-muted text-[13px]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 4. Footer (fixed at bottom, border-top, 56px) */}
      <div className="h-14 shrink-0 px-6 border-t border-border bg-white flex items-center justify-between text-[14px]">
        <div>
          {hasResult && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink">{t.preview_payable}:</span>
              <span className="font-bold text-primary tabular-nums">
                {formatINR(previewPayable)}
              </span>
              {excludedCount > 0 && (
                <span className="text-ink-muted text-[13px]">
                  ·{' '}
                  {excludedCount === 1
                    ? t.lines_excluded.replace('{count}', String(excludedCount))
                    : t.lines_excluded_plural.replace('{count}', String(excludedCount))}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={!hasResult || confirming || parsing}
            className="h-10 px-4 rounded text-[13px] font-medium border border-border text-ink hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {t.btn_discard}
          </button>
          <button
            type="button"
            onClick={handleConfirmOrder}
            disabled={!canConfirm}
            className={`h-10 px-6 rounded text-[13px] font-semibold transition-colors whitespace-nowrap ${
              canConfirm
                ? 'bg-primary text-white hover:bg-[#0a6f1a]'
                : 'bg-gray-100 text-ink-subtle cursor-not-allowed font-medium'
            }`}
          >
            {confirming ? t.confirming : t.btn_confirm_order}
          </button>
        </div>
      </div>
    </div>
  );
};
