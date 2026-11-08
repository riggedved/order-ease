import React, { useState, useMemo } from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type {
  CatalogueSKU,
  ParsedLine,
  CartQuoteLineResponse,
} from '../types';
import { captureOrder, fetchCartQuote } from '../api';
import {
  formatINR,
  cleanProductName,
  getPackSize,
  getPackWeightGrams,
  toSentenceCase,
} from '../utils';
import { ProductImage } from './ProductImage';
import { QuantityStepper } from './QuantityStepper';

interface OrderByMessageProps {
  lang: Language;
  retailerId: number;
  token: string;
  catalogue: CatalogueSKU[];
  draftText?: string;
  onDraftChange?: (text: string) => void;
  onBackToCatalogue: () => void;
  onAddToCart: (
    items: {
      sku_code: string;
      qty_cases: number;
      original_words?: string | null;
      unit?: string | null;
    }[]
  ) => void;
}

export const OrderByMessage: React.FC<OrderByMessageProps> = ({
  lang,
  retailerId,
  token,
  catalogue,
  draftText = '',
  onDraftChange,
  onBackToCatalogue,
  onAddToCart,
}) => {
  const t = translations[lang];

  // Flow State
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [orderText, setOrderText] = useState(draftText);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync draftText if updated from parent
  React.useEffect(() => {
    if (draftText && draftText !== orderText && !orderText) {
      setOrderText(draftText);
    }
  }, [draftText]);

  const handleTextChange = (val: string) => {
    setOrderText(val);
    if (onDraftChange) {
      onDraftChange(val);
    }
    if (error) setError(null);
  };

  // Capture & Review State
  const [editableLines, setEditableLines] = useState<ParsedLine[]>([]);
  const [quoteLines, setQuoteLines] = useState<CartQuoteLineResponse[]>([]);
  const [quoteSubtotal, setQuoteSubtotal] = useState<string | number>('0.00');
  const [quoteGst, setQuoteGst] = useState<string | number>('0.00');
  const [quotePayable, setQuotePayable] = useState<string | number>('0.00');
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Helper to look up SKU details from catalogue
  const getSku = (code: string | null) => {
    if (!code) return null;
    return catalogue.find((s) => s.code === code) || null;
  };

  // Sample prompt for quick testing
  const sampleOrder =
    'bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti';

  const handleUseSample = () => {
    handleTextChange(sampleOrder);
    setError(null);
  };

  // Remove a parsed line
  const handleRemoveLine = (index: number) => {
    const updated = editableLines.filter((_, i) => i !== index);
    setEditableLines(updated);
    refreshQuote(updated);
  };

  // Recalculate quote whenever user adjusts quantities, units, or swaps SKU
  // Note: quoteLines are preserved during loading to keep UI completely stable
  const refreshQuote = async (linesToQuote: ParsedLine[]) => {
    const validLines = linesToQuote
      .filter((l) => {
        const skuInfo = getSku(l.sku_code);
        return (
          l.sku_code &&
          l.unit === 'case' &&
          (l.qty || 0) > 0 &&
          !l.flags.includes('out_of_stock') &&
          !l.flags.includes('needs_unit') &&
          !l.flags.includes('no_match') &&
          skuInfo?.stock_status !== 'out'
        );
      })
      .map((l) => ({
        sku_code: l.sku_code!,
        qty_cases: l.qty || 1,
      }));

    if (validLines.length === 0) {
      setQuoteLines([]);
      setQuoteSubtotal('0.00');
      setQuoteGst('0.00');
      setQuotePayable('0.00');
      return;
    }

    setQuoteLoading(true);
    try {
      const q = await fetchCartQuote(retailerId, validLines, token);
      setQuoteLines(q.lines);
      setQuoteSubtotal(q.subtotal);
      setQuoteGst(q.gst_amount);
      setQuotePayable(q.payable);
    } catch {
      // Keep previous values on transient error
    } finally {
      setQuoteLoading(false);
    }
  };

  // Parse text using backend /capture endpoint
  // Decides the order of "Did you mean" options once (ascending pack size)
  const handleParseOrder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!orderText.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await captureOrder(retailerId, orderText.trim(), token);

      const preparedLines: ParsedLine[] = res.lines.map((line, idx) => {
        // Collect candidate SKU codes
        const candidateCodes = Array.from(
          new Set([line.sku_code, ...(line.alternatives || [])].filter(Boolean) as string[])
        );
        // Sort candidate codes in ascending pack size (grams) once
        candidateCodes.sort((a, b) => {
          const skuA = getSku(a);
          const skuB = getSku(b);
          return getPackWeightGrams(skuA) - getPackWeightGrams(skuB);
        });

        return {
          ...line,
          id: `line-${idx}-${Date.now()}`,
          fixed_options: candidateCodes,
        };
      });

      setEditableLines(preparedLines);

      if (res.preview_quote) {
        setQuoteLines(res.preview_quote.lines);
        setQuoteSubtotal(res.preview_quote.subtotal);
        setQuoteGst(res.preview_quote.gst_amount);
        setQuotePayable(res.preview_quote.payable);
      } else {
        setQuoteLines([]);
        setQuoteSubtotal('0.00');
        setQuoteGst('0.00');
        setQuotePayable('0.00');
      }

      setStep('review');
    } catch {
      setError(t.capture_error_msg);
    } finally {
      setLoading(false);
    }
  };

  // Line adjustment handlers
  const handleUpdateLineQty = (index: number, newQty: number) => {
    const updated = [...editableLines];
    updated[index] = { ...updated[index], qty: Math.max(1, newQty) };
    setEditableLines(updated);
    refreshQuote(updated);
  };

  const handleSelectUnit = (index: number, unit: 'case' | 'piece') => {
    const updated = [...editableLines];
    const newFlags = (updated[index].flags || []).filter((f) => f !== 'needs_unit');
    updated[index] = { ...updated[index], unit, flags: newFlags };
    setEditableLines(updated);
    refreshQuote(updated);
  };

  // Select alternative: preserves fixed_options order so layout never jumps
  const handleSelectAlternative = (index: number, altSkuCode: string) => {
    const updated = [...editableLines];
    const target = updated[index];
    if (!target) return;

    const skuInfo = getSku(altSkuCode);
    const newFlags = (target.flags || []).filter(
      (f) => f !== 'no_match' && f !== 'out_of_stock'
    );
    if (skuInfo && skuInfo.stock_status === 'out') {
      newFlags.push('out_of_stock');
    }

    updated[index] = {
      ...target,
      sku_code: altSkuCode,
      fixed_options: target.fixed_options, // NEVER reorder
      confidence: 'high',
      flags: newFlags,
    };
    setEditableLines(updated);
    refreshQuote(updated);
  };

  // Count of items included in quote/order
  const validItemsCount = useMemo(() => {
    return editableLines.filter((l) => {
      const skuInfo = getSku(l.sku_code);
      return (
        l.sku_code &&
        l.unit === 'case' &&
        (l.qty || 0) > 0 &&
        !l.flags.includes('out_of_stock') &&
        !l.flags.includes('needs_unit') &&
        !l.flags.includes('no_match') &&
        skuInfo?.stock_status !== 'out'
      );
    }).length;
  }, [editableLines, catalogue]);

  const excludedCount = useMemo(() => {
    return editableLines.filter((l) => {
      const skuInfo = getSku(l.sku_code);
      return (
        l.flags.includes('out_of_stock') ||
        skuInfo?.stock_status === 'out' ||
        l.flags.includes('needs_unit') ||
        l.unit === 'unknown' ||
        !l.sku_code
      );
    }).length;
  }, [editableLines, catalogue]);

  const hasUnansweredQuestion = useMemo(() => {
    return editableLines.some(
      (l) => l.flags.includes('needs_unit') || l.flags.includes('no_match') || !l.sku_code || l.unit === 'unknown'
    );
  }, [editableLines]);

  // Primary "Add to cart" button disabled state
  const isAddToCartDisabled =
    hasUnansweredQuestion || validItemsCount === 0 || quoteLoading;

  // Add all valid included lines to the active cart store
  const handleAddToCartClick = () => {
    const includedLines = editableLines
      .filter((l) => {
        const skuInfo = getSku(l.sku_code);
        return (
          l.sku_code &&
          l.unit === 'case' &&
          (l.qty || 0) > 0 &&
          !l.flags.includes('out_of_stock') &&
          !l.flags.includes('needs_unit') &&
          !l.flags.includes('no_match') &&
          skuInfo?.stock_status !== 'out'
        );
      })
      .map((l) => ({
        sku_code: l.sku_code!,
        qty_cases: l.qty || 1,
        original_words: l.original_words || null,
        unit: l.unit || 'case',
      }));

    if (includedLines.length > 0) {
      onAddToCart(includedLines);
    }
  };

  return (
    <div className="flex flex-col flex-1 px-4 pt-0 pb-4 bg-surface select-none">
      {/* ================= STEP 1: INPUT PAGE ================= */}
      {step === 'input' && (
        <div className="flex flex-col w-full pb-28">
          {/* 2. "Back to catalogue" link (Pinned) */}
          <div className="sticky top-14 z-20 bg-surface -mx-4 px-4 py-2.5 border-b border-border mb-4 flex items-center">
            <button
              type="button"
              onClick={onBackToCatalogue}
              className="min-tap -ml-2 px-2 inline-flex items-center text-body font-semibold text-ink hover:text-primary transition-colors focus:outline-none"
            >
              <svg
                className="w-5 h-5 mr-1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>{t.back_to_catalogue}</span>
            </button>
          </div>

          {/* 3. Heading & Subline */}
          <div className="mb-4">
            <h1 className="text-title font-bold text-ink">
              {t.order_by_msg_title}
            </h1>
            <p className="text-small text-ink-muted mt-0.5">
              {t.order_by_msg_subline}
            </p>
          </div>

          {/* 4. Large Textarea */}
          <form onSubmit={handleParseOrder} className="flex flex-col flex-1">
            <div className="relative">
              <textarea
                value={orderText}
                onChange={(e) => handleTextChange(e.target.value)}
                disabled={loading}
                autoFocus
                rows={8}
                placeholder={t.order_input_placeholder}
                className="w-full p-3.5 bg-white border border-border rounded-xl text-body text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-ink-muted resize-none leading-relaxed transition-colors shadow-none"
              />
            </div>

            {/* 5. Complete Example & Try link */}
            <div className="mt-2 text-small text-ink-muted flex flex-wrap items-center gap-1.5 leading-relaxed">
              <span>{t.example_preview_label}</span>
              <button
                type="button"
                onClick={handleUseSample}
                disabled={loading}
                className="font-bold text-primary hover:underline focus:outline-none disabled:opacity-50"
              >
                ({t.try_this_example})
              </button>
            </div>

            {/* 7. Error state */}
            {error && (
              <div
                className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-small text-red-700"
                role="alert"
              >
                <svg
                  className="w-4 h-4 shrink-0 text-red-500 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="flex-1">
                  <span>{error}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleParseOrder()}
                  className="min-tap text-body font-bold text-red-700 underline focus:outline-none shrink-0"
                >
                  {t.retry}
                </button>
              </div>
            )}

            {/* 6. Fixed bottom bar (56px tall button) */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border z-30 shadow-none pb-[env(safe-area-inset-bottom,0px)]">
              <div className="max-w-[420px] mx-auto p-4">
                <button
                  type="submit"
                  disabled={!orderText.trim() || loading}
                  className="min-tap w-full h-14 rounded-xl bg-primary text-white font-bold text-body flex items-center justify-center gap-2 hover:bg-primary-dark active:bg-primary-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none"
                >
                  {loading ? (
                    <>
                      <svg
                        className="animate-spin h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8H4z"
                        />
                      </svg>
                      <span>{t.reading_order}</span>
                    </>
                  ) : (
                    <span>{t.read_order_btn}</span>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ================= STEP 2: REVIEW PAGE ================= */}
      {step === 'review' && (
        <div className="flex flex-col w-full pb-44">
          {/* Back link (Pinned) */}
          <div className="sticky top-14 z-20 bg-surface -mx-4 px-4 py-2.5 border-b border-border mb-4 flex items-center">
            <button
              type="button"
              onClick={() => setStep('input')}
              className="min-tap -ml-2 px-2 inline-flex items-center text-body font-semibold text-ink hover:text-primary transition-colors focus:outline-none"
            >
              <svg
                className="w-5 h-5 mr-1"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>{t.edit_text_btn}</span>
            </button>
          </div>

          {/* Heading & Subtitle */}
          <div className="mb-4">
            <h1 className="text-title font-bold text-ink">
              {t.review_title}
            </h1>
            <p className="text-small text-ink-muted mt-0.5">
              {t.review_subline}
            </p>
          </div>

          {/* Parsed Items List */}
          <div className="space-y-3 mb-5">
            {editableLines.map((line, idx) => {
              const sku = getSku(line.sku_code);
              const ql = quoteLines.find((q) => q.sku_code === line.sku_code);
              const isOutOfStock =
                line.flags.includes('out_of_stock') || (sku && sku.stock_status === 'out');
              const needsUnit = line.flags.includes('needs_unit') || line.unit === 'unknown';
              const isNoMatch = line.flags.includes('no_match') || !line.sku_code;

              // 5. No match card: no image, text "Not found", product picker, Remove button
              if (isNoMatch) {
                return (
                  <div
                    key={line.id || `line-${idx}`}
                    className="p-3.5 bg-white border border-border rounded-xl flex flex-col gap-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-small text-ink-muted truncate">
                        {line.original_words ? `“${line.original_words}”` : ''}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="min-tap text-small text-ink-muted hover:text-red-600 underline font-medium focus:outline-none shrink-0"
                      >
                        {t.remove}
                      </button>
                    </div>

                    <div className="text-small font-semibold text-red-600">
                      {t.not_found}
                    </div>

                    <div>
                      <label htmlFor={`picker-${idx}`} className="sr-only">
                        {t.select_product}
                      </label>
                      <select
                        id={`picker-${idx}`}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleSelectAlternative(idx, e.target.value);
                          }
                        }}
                        className="min-tap w-full h-12 px-3 bg-white border border-border rounded-lg text-body text-ink focus:outline-none focus:border-primary"
                      >
                        <option value="">{t.select_product}</option>
                        {catalogue.map((catSku) => (
                          <option key={catSku.code} value={catSku.code}>
                            {cleanProductName(catSku.name)} (
                            {catSku.stock_status === 'out'
                              ? lang === 'hi'
                                ? 'आउट ऑफ स्टॉक'
                                : 'Out of stock'
                              : formatINR(catSku.case_price)}
                            )
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              }

              // Matched SKU Card
              return (
                <div
                  key={line.id || `line-${idx}`}
                  className="p-3.5 bg-white border border-border rounded-xl flex flex-col gap-2.5"
                >
                  {/* Top: 48px square thumbnail on left, words/confidence + name/total + case/price on right */}
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-lg bg-gray-50 border border-border shrink-0 p-1 flex items-center justify-center">
                      <ProductImage skuCode={line.sku_code} grayscale={!!isOutOfStock} />
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Original words in quotes & confidence label (Out-of-stock lines show no confidence label) */}
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-small text-ink-muted truncate font-normal">
                          {line.original_words ? `“${line.original_words}”` : ''}
                        </span>
                        {!isOutOfStock && line.confidence === 'medium' && (
                          <span className="text-small font-semibold text-amber-700 shrink-0">
                            {t.conf_please_check}
                          </span>
                        )}
                        {!isOutOfStock && line.confidence === 'low' && (
                          <span className="text-small font-semibold text-red-600 shrink-0">
                            {t.conf_not_sure}
                          </span>
                        )}
                      </div>

                      {/* Product Name (no case suffix) & Line Total */}
                      <div className="flex items-start justify-between gap-2 mt-0.5">
                        <div
                          className={`text-body font-semibold leading-snug line-clamp-2 ${
                            isOutOfStock ? 'line-through text-ink-muted' : 'text-ink'
                          }`}
                        >
                          {cleanProductName(sku?.name || line.sku_code || '')}
                        </div>
                        {!isOutOfStock && !needsUnit && ql && (
                          <div className="text-price font-bold tabular-nums text-ink shrink-0 text-right">
                            {formatINR(ql.line_total)}
                          </div>
                        )}
                      </div>

                      {/* Case and Price Line */}
                      {sku && (
                        <div className="text-small text-ink-muted mt-0.5 tabular-nums">
                          {lang === 'hi' ? `केस ${sku.units_per_case}` : `Case of ${sku.units_per_case}`} ·{' '}
                          {formatINR(sku.case_price)} / {lang === 'hi' ? 'केस' : 'case'}{' '}
                          {sku.price_includes_gst
                            ? lang === 'hi'
                              ? 'जीएसटी सहित'
                              : 'incl. GST'
                            : '+ GST'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 4. Out of stock state */}
                  {isOutOfStock && (
                    <div className="flex flex-col gap-2 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <span className="text-small font-semibold text-red-600">
                          {t.out_of_stock_not_added}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="min-tap text-small text-ink-muted hover:text-red-600 underline font-medium focus:outline-none"
                        >
                          {t.remove}
                        </button>
                      </div>

                      {/* Available instead chip for alternative */}
                      {line.fixed_options && line.fixed_options.length > 0 && (() => {
                        const altCode = line.fixed_options.find((c) => c !== line.sku_code);
                        const altSku = altCode ? getSku(altCode) : null;
                        if (!altSku || altSku.stock_status === 'out') return null;
                        return (
                          <div>
                            <button
                              type="button"
                              onClick={() => handleSelectAlternative(idx, altSku.code)}
                              className="min-tap inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary-50 text-body font-semibold text-primary hover:bg-primary-100 transition-colors"
                            >
                              <span>{t.available_instead}:</span>
                              <span className="font-bold">
                                {cleanProductName(altSku.name)}
                              </span>
                              <span>→</span>
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* 3. Unit question: needs_unit */}
                  {needsUnit && !isOutOfStock && (
                    <div className="pt-2 border-t border-border flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-small font-bold text-ink">
                          {t.cases_or_pieces}
                        </span>
                        <span className="text-small font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          {t.choose_one}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleSelectUnit(idx, 'case')}
                          className="min-tap h-12 rounded-lg border-2 border-border text-ink font-bold text-body bg-white hover:border-primary hover:bg-primary-50 active:bg-primary-100 transition-colors flex items-center justify-center gap-1 select-none"
                        >
                          <span>
                            {line.qty || 1} {lang === 'hi' ? 'केस' : 'Cases'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectUnit(idx, 'piece')}
                          className="min-tap h-12 rounded-lg border-2 border-border text-ink font-bold text-body bg-white hover:border-primary hover:bg-primary-50 active:bg-primary-100 transition-colors flex items-center justify-center gap-1 select-none"
                        >
                          <span>
                            {line.qty || 1} {lang === 'hi' ? 'पीस' : 'Pieces'}
                          </span>
                        </button>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="min-tap text-small text-ink-muted hover:text-red-600 underline font-medium focus:outline-none"
                        >
                          {t.remove}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 2. Alternatives side-by-side in stable fixed order (ascending pack size) */}
                  {!isOutOfStock && !needsUnit && line.fixed_options && line.fixed_options.length > 1 && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                      {line.fixed_options.map((optCode) => {
                        const optSku = getSku(optCode);
                        if (!optSku) return null;
                        const isSelected = line.sku_code === optCode;

                        return (
                          <button
                            key={optCode}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              if (!isSelected) {
                                handleSelectAlternative(idx, optCode);
                              }
                            }}
                            className={`min-tap flex items-center gap-2 p-1.5 rounded-lg text-left transition-colors select-none ${
                              isSelected
                                ? 'border-2 border-primary bg-primary-50 text-ink font-bold'
                                : 'border border-border bg-white text-ink-muted hover:border-primary/40'
                            }`}
                          >
                            <div className="w-8 h-8 rounded bg-gray-50 border border-border p-0.5 shrink-0 flex items-center justify-center">
                              <ProductImage skuCode={optCode} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div
                                className={`text-body truncate ${
                                  isSelected ? 'font-bold text-primary' : 'font-semibold text-ink-muted'
                                }`}
                              >
                                {getPackSize(optSku)}
                              </div>
                            </div>
                            {isSelected ? (
                              <div className="w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center shrink-0">
                                <svg
                                  className="w-2.5 h-2.5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            ) : (
                              <div className="w-4 h-4 rounded-full border border-border shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Stepper with editable quantity (48px tall) and Remove text button */}
                  {!isOutOfStock && !needsUnit && (
                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                      <QuantityStepper
                        qty={line.qty || 1}
                        onUpdate={(newQty) => handleUpdateLineQty(idx, newQty)}
                        lang={lang}
                        min={1}
                        variant="white"
                        ariaLabel={line.original_words}
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveLine(idx)}
                        className="min-tap w-11 h-11 rounded-xl text-red-500 hover:text-red-700 hover:bg-red-50 active:bg-red-100 flex items-center justify-center transition-colors focus:outline-none select-none"
                        aria-label={`${t.remove} ${line.original_words || ''}`}
                        title={t.remove}
                      >
                        <svg
                          className="w-5 h-5 text-red-500"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Nudge as one line of green sentence-case text (fixed min-height to maintain stable layout) */}
                  {!isOutOfStock && !needsUnit && (
                    <div className="text-small text-primary font-medium flex items-center gap-1.5 min-h-[1.25rem] pt-0.5">
                      {ql?.nudges && ql.nudges.length > 0 ? (
                        <>
                          <svg className="w-3.5 h-3.5 shrink-0 text-primary" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <span>{toSentenceCase(ql.nudges[0])}</span>
                        </>
                      ) : (
                        <span className="invisible select-none">&nbsp;</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Empty state if all items removed */}
          {editableLines.length === 0 && (
            <div className="p-8 text-center bg-white border border-border rounded-xl space-y-3 mb-5">
              <p className="text-body text-ink-muted">
                {lang === 'hi' ? 'कोई सामान नहीं बचा।' : 'No items left in this order.'}
              </p>
              <button
                type="button"
                onClick={() => setStep('input')}
                className="min-tap px-4 py-2 rounded-lg bg-primary text-white text-body font-semibold"
              >
                {t.edit_text_btn}
              </button>
            </div>
          )}

          {/* 6. Summary card */}
          {editableLines.length > 0 && (
            <div className="p-4 bg-white border border-border rounded-xl space-y-2 mb-4">
              <div className="flex justify-between text-small text-ink-muted">
                <span>{lang === 'hi' ? 'उप-कुल (सबटोटल)' : 'Subtotal'}</span>
                <span className="text-price font-bold tabular-nums text-ink">{formatINR(quoteSubtotal)}</span>
              </div>

              <div className="flex justify-between text-small text-ink-muted">
                <span>{lang === 'hi' ? 'जीएसटी' : 'GST'}</span>
                <span className="text-price font-bold tabular-nums text-ink">{formatINR(quoteGst)}</span>
              </div>

              <div className="pt-2 border-t border-border flex justify-between text-body font-bold text-ink">
                <span>{t.total_incl_gst}</span>
                <span className="text-price font-bold tabular-nums text-primary">{formatINR(quotePayable)}</span>
              </div>

              {excludedCount > 0 && (
                <div className="pt-2 border-t border-border text-small text-red-600 font-medium">
                  {(excludedCount === 1 ? t.item_not_included : t.items_not_included).replace(
                    '{n}',
                    String(excludedCount)
                  )}
                </div>
              )}
            </div>
          )}

          {/* 7. Fixed bottom bar (safe-area aware) */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border z-30 shadow-none pb-[env(safe-area-inset-bottom,0px)]">
            <div className="max-w-[420px] mx-auto p-4 flex flex-col gap-2">
              <div className="text-center text-small font-bold text-ink tabular-nums">
                {validItemsCount}{' '}
                {validItemsCount === 1
                  ? lang === 'hi'
                    ? 'सामान'
                    : 'item'
                  : lang === 'hi'
                  ? 'सामान'
                  : 'items'}{' '}
                · <span className="text-price font-bold">{formatINR(quotePayable)}</span> {lang === 'hi' ? 'जीएसटी सहित' : 'incl. GST'}
              </div>

              {/* Primary Button: "Add to cart" (56px tall) */}
              <button
                type="button"
                disabled={isAddToCartDisabled}
                onClick={handleAddToCartClick}
                className="min-tap w-full h-14 rounded-xl bg-primary text-white font-bold text-body flex items-center justify-center gap-2 hover:bg-primary-dark active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none"
              >
                <span>{t.add_to_cart}</span>
              </button>

              {/* Note: "Nothing is ordered until you place the order." */}
              <p className="text-small text-ink-muted text-center">
                {t.nothing_ordered_until_place}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
