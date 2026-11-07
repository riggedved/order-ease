import React, { useState, useMemo } from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type { CatalogueSKU, CartQuoteResponse } from '../types';
import {
  formatINR,
  formatTitleCase,
  cleanProductName,
  deriveCategoriesFromCatalogue,
  getProductCategory,
  getCategoryLabel,
  getSchemeBadgeText,
  formatCases,
} from '../utils';
import { ProductImage } from './ProductImage';

interface CatalogueScreenProps {
  lang: Language;
  catalogue: CatalogueSKU[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  cartQuantities: Record<string, number>;
  onUpdateQty: (skuCode: string, qty: number) => void;
  onViewCart: () => void;
  onOpenOrderByMessage: () => void;
  quote: CartQuoteResponse | null;
}

export const CatalogueScreen: React.FC<CatalogueScreenProps> = ({
  lang,
  catalogue,
  loading,
  error,
  onRetry,
  cartQuantities,
  onUpdateQty,
  onViewCart,
  onOpenOrderByMessage,
  quote,
}) => {
  const t = translations[lang];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // Interactive inline quantity editing
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState<string>('');

  const handleStartEditing = (skuCode: string, currentQty: number) => {
    setEditingSku(skuCode);
    setEditingQty(currentQty.toString());
  };

  const handleFinishEditing = (skuCode: string) => {
    const val = parseInt(editingQty, 10);
    if (!isNaN(val) && val >= 0) {
      onUpdateQty(skuCode, val);
    }
    setEditingSku(null);
  };

  // Derive categories dynamically from catalogue items
  const categories = useMemo(() => {
    return deriveCategoriesFromCatalogue(catalogue);
  }, [catalogue]);

  // Filter catalogue items by search and category
  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return catalogue.filter((sku) => {
      // Category filter
      if (selectedCategory !== 'All') {
        const cat = getProductCategory(sku);
        if (cat !== selectedCategory) return false;
      }

      // Search filter
      if (query) {
        const nameMatch = sku.name.toLowerCase().includes(query);
        const codeMatch = sku.code.toLowerCase().includes(query);
        if (!nameMatch && !codeMatch) return false;
      }

      return true;
    });
  }, [catalogue, selectedCategory, searchQuery]);

  // Compute total cases in cart for sticky bottom bar
  const totalCasesInCart = useMemo(() => {
    return Object.values(cartQuantities).reduce((acc, q) => acc + (q > 0 ? q : 0), 0);
  }, [cartQuantities]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-16 px-4">
        <svg
          className="animate-spin h-8 w-8 text-primary mb-3"
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
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          ></path>
        </svg>
        <span className="text-sm font-semibold text-ink-muted">
          {t.loading}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 py-16 px-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-error-bg/30 border border-error/20 flex items-center justify-center text-error mb-4">
          <svg
            className="w-7 h-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="text-base font-bold text-ink mb-1">
          {t.error_title}
        </h2>
        <p className="text-xs text-ink-muted max-w-xs mb-5">
          {t.catalogue_error_msg}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="min-tap px-6 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary-dark transition-colors"
        >
          {t.retry}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 p-3.5 pb-36 bg-surface">
      {/* 1. Order by Message Bar */}
      <button
        type="button"
        onClick={onOpenOrderByMessage}
        className="w-full min-tap h-12 px-4 border border-primary rounded-xl bg-white flex items-center justify-center space-x-2 text-primary font-bold text-sm hover:bg-primary-50 active:bg-primary-50 focus:outline-none transition-colors mb-1.5 select-none"
      >
        <svg
          className="w-5 h-5 shrink-0 text-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <span>{t.order_by_message}</span>
      </button>

      {/* Pinned Search Bar & Category Filter Chips */}
      <div className="sticky top-14 z-20 bg-surface -mx-3.5 px-3.5 pt-2 pb-2.5 border-b border-border mb-3.5">
        {/* 2. Search Bar: 44-48px tall */}
        <div className="relative mb-2.5">
          <input
            id="product-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.search_placeholder}
            className="w-full min-h-[44px] h-12 pl-10 pr-4 text-sm bg-white border border-border rounded-xl text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none transition-colors"
          />
          <span className="absolute left-3.5 top-3.5 text-ink-muted pointer-events-none">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </span>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-3 text-ink-muted hover:text-ink p-1"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* 3. Category Filter Chips: 44-48px tall */}
        <div className="flex space-x-2 overflow-x-auto no-scrollbar pb-0.5">
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`min-h-[44px] h-[46px] px-4 rounded-xl text-xs font-semibold border flex items-center justify-center whitespace-nowrap transition-colors select-none ${
                  isSelected
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-ink border-border hover:bg-gray-50'
                }`}
              >
                {getCategoryLabel(cat, lang)}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Empty Search Results */}
      {filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-border flex items-center justify-center text-ink-muted mb-3">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-ink mb-1">
            {t.no_products_title}
          </h2>
          <p className="text-xs text-ink-muted max-w-xs">
            {t.no_products_subtitle}
          </p>
        </div>
      ) : (
        /* 5. 2-Column Product Grid (12px gap, equal height cards) */
        <div className="grid grid-cols-2 gap-3 items-stretch">
          {filteredProducts.map((sku) => {
            const currentQty = cartQuantities[sku.code] || 0;
            const isOutOfStock = sku.stock_status === 'out';
            const isLowStock = sku.stock_status === 'low';
            const schemeBadge = getSchemeBadgeText(sku, lang);

            // Match quote line for scheme result or nudge from POST /cart/quote
            const ql = quote?.lines?.find((l) => l.sku_code === sku.code);

            let quoteLineMsg: string | null = null;
            if (currentQty > 0 && ql) {
              if (ql.free_cases > 0) {
                quoteLineMsg =
                  ql.free_cases === 1
                    ? (lang === 'hi' ? '1 मुफ़्त केस जोड़ा गया' : '1 free case added')
                    : (lang === 'hi' ? `${ql.free_cases} मुफ़्त केस जोड़े गए` : `${ql.free_cases} free cases added`);
              } else if (parseFloat(ql.discount?.toString() || '0') > 0) {
                quoteLineMsg = `${formatINR(ql.discount)} ${t.discount_applied}`;
              } else if (ql.nudges && ql.nudges.length > 0) {
                quoteLineMsg = formatTitleCase(ql.nudges[0]);
              } else if (ql.warnings && ql.warnings.length > 0) {
                quoteLineMsg = ql.warnings[0];
              }
            }

            return (
              <div
                key={sku.code}
                className="bg-white border border-border rounded-xl flex flex-col h-full overflow-hidden transition-colors"
              >
                {/* 3. 4:3 Image Area on Top (No text in SVG, larger centered pack) */}
                <div className="aspect-[4/3] relative w-full bg-gray-50 flex items-center justify-center p-2 overflow-hidden shrink-0">
                  {/* Low Stock Badge */}
                  {isLowStock && (
                    <span className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning-bg border border-warning/40 text-warning select-none">
                      {t.few_left}
                    </span>
                  )}

                  {/* Lazy-loaded Flat Pack SVG Illustration via shared ProductImage */}
                  <ProductImage
                    skuCode={sku.code}
                    alt={cleanProductName(sku.name)}
                  />
                </div>

                {/* Details & Controls */}
                <div className="p-2.5 flex flex-col flex-1 justify-between">
                  <div className="flex flex-col">
                    {/* 1. Product Name without trailing ", case of N" */}
                    <h2 className="text-xs font-bold text-ink leading-snug line-clamp-2 min-h-[32px] break-words">
                      {cleanProductName(sku.name)}
                    </h2>

                    {/* 1. "Case of N" once, as a small grey line under the name */}
                    <p className="text-[12px] text-ink-muted mt-0.5 leading-tight">
                      {lang === 'hi' ? `${sku.units_per_case} का केस` : `Case of ${sku.units_per_case}`}
                    </p>

                    {/* 2. Scheme badge: between case line and price (#E8F5E9 fill, #0C6B1A text, 13px semibold, rounded 8px) */}
                    {schemeBadge && (
                      <div className="mt-2 mb-1 px-2.5 py-1 rounded-[8px] bg-[#E8F5E9] text-[#0C6B1A] text-[13px] font-semibold leading-tight line-clamp-2 inline-block w-fit max-w-full break-words">
                        {schemeBadge}
                      </div>
                    )}

                    {/* 4. Price: "₹777.60 / case" at 18px bold, "+ GST" (or "incl. GST") at 13px in #374151, "₹8.10 per piece × 96" at 13px in #6B7280 */}
                    <div className="mt-2">
                      <div className="flex flex-wrap items-baseline gap-x-1.5 leading-tight">
                        <span className="text-[18px] font-bold text-ink">
                          {formatINR(sku.case_price)} / {lang === 'hi' ? 'केस' : 'case'}
                        </span>
                        <span className="text-[13px] text-[#374151] font-normal whitespace-nowrap">
                          {sku.price_includes_gst
                            ? (lang === 'hi' ? 'जीएसटी सहित' : 'incl. GST')
                            : (lang === 'hi' ? '+ जीएसटी' : '+ GST')}
                        </span>
                      </div>
                      <p className="text-[13px] text-[#6B7280] mt-0.5 leading-tight">
                        {formatINR(sku.price_per_piece)} {lang === 'hi' ? 'प्रति पीस' : 'per piece'} × {sku.units_per_case}
                      </p>
                    </div>
                  </div>

                  {/* 5. Control Area pinned at bottom so buttons in the row line up */}
                  <div className="mt-auto pt-3">
                    {/* Out of Stock: greyed label, no button */}
                    {isOutOfStock ? (
                      <div className="w-full min-h-[48px] h-12 rounded-xl bg-gray-100 text-ink-muted text-xs font-semibold flex items-center justify-center select-none">
                        {t.out_of_stock}
                      </div>
                    ) : currentQty === 0 ? (
                      /* Not in cart: outlined green "ADD", min 48px tall */
                      <button
                        type="button"
                        onClick={() => onUpdateQty(sku.code, 1)}
                        className="w-full min-h-[48px] h-12 rounded-xl border-2 border-primary bg-white text-primary font-bold text-xs flex items-center justify-center hover:bg-primary-50 active:bg-primary-50 transition-colors select-none"
                      >
                        {t.add}
                      </button>
                    ) : (
                      /* In cart: filled green stepper "- 5 cases +", min 48px tall */
                      <div className="w-full min-h-[48px] h-12 rounded-xl bg-primary text-white font-bold flex items-center justify-between px-1 select-none">
                        <button
                          type="button"
                          onClick={() => onUpdateQty(sku.code, Math.max(0, currentQty - 1))}
                          className="w-9 h-10 flex items-center justify-center text-white text-xl font-bold hover:bg-primary-dark active:bg-primary-dark rounded-lg transition-colors focus:outline-none"
                          aria-label={`Decrease ${sku.name}`}
                        >
                          −
                        </button>

                        {/* Tapping number opens numeric input */}
                        {editingSku === sku.code ? (
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            autoFocus
                            value={editingQty}
                            onChange={(e) => setEditingQty(e.target.value)}
                            onBlur={() => handleFinishEditing(sku.code)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleFinishEditing(sku.code);
                            }}
                            className="w-12 h-8 bg-white text-ink font-bold text-center text-xs rounded outline-none border border-primary-dark"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartEditing(sku.code, currentQty)}
                            className="flex-1 min-w-0 text-center text-xs font-bold text-white px-1 py-1 truncate hover:underline"
                            title="Tap to type quantity"
                          >
                            {formatCases(currentQty, lang)}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onUpdateQty(sku.code, currentQty + 1)}
                          className="w-9 h-10 flex items-center justify-center text-white text-xl font-bold hover:bg-primary-dark active:bg-primary-dark rounded-lg transition-colors focus:outline-none"
                          aria-label={`Increase ${sku.name}`}
                        >
                          +
                        </button>
                      </div>
                    )}

                    {/* Under the control: scheme result or nudge from POST /cart/quote */}
                    {currentQty > 0 && quoteLineMsg && (
                      <div className="mt-1.5 text-[11px] font-semibold text-primary leading-tight text-center line-clamp-2 break-words">
                        {quoteLineMsg}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 6. Sticky Bottom Cart Bar */}
      {/* Requirement: show "20 cases" and the payable, with the label "incl. GST" next to the amount */}
      {totalCasesInCart > 0 && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[420px] bg-primary text-white p-3 z-40 border-t border-primary-dark flex items-center justify-between select-none">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-green-100 font-medium">
              {formatCases(totalCasesInCart, lang)}
            </span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-bold">
                {formatINR(quote?.payable)}
              </span>
              <span className="text-[11px] font-normal text-green-100">
                {t.incl_gst}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onViewCart}
            className="min-tap px-4 py-2 rounded-xl bg-white text-primary font-bold text-sm flex items-center space-x-1.5 focus:outline-none hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            <span>{t.view_cart}</span>
            <span>→</span>
          </button>
        </div>
      )}
    </div>
  );
};
