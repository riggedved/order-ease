import React, { useState, useMemo } from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type { CatalogueSKU, CartQuoteResponse } from '../types';
import {
  formatINR,
  deriveCategoriesFromCatalogue,
  getProductCategory,
  getCategoryLabel,
} from '../utils';

interface CatalogueScreenProps {
  lang: Language;
  catalogue: CatalogueSKU[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  cartQuantities: Record<string, number>;
  onUpdateQty: (skuCode: string, qty: number) => void;
  onViewCart: () => void;
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
  quote,
}) => {
  const t = translations[lang];

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

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
    <div className="flex flex-col flex-1 p-4 pb-28 bg-surface">
      {/* 1. Search Bar */}
      <div className="relative mb-3">
        <input
          id="product-search"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t.search_placeholder}
          className="w-full min-tap pl-10 pr-4 py-2.5 text-sm bg-white border border-border rounded-xl text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none transition-colors"
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

      {/* 2. Category Filter Pills */}
      <div className="flex space-x-2 overflow-x-auto no-scrollbar pb-2 mb-4">
        {categories.map((cat) => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`min-tap px-4 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center whitespace-nowrap transition-colors select-none ${
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

      {/* 3. Empty Search Results */}
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
        /* 4. Product List / Cards */
        <div className="flex flex-col space-y-3">
          {filteredProducts.map((sku) => {
            const currentQty = cartQuantities[sku.code] || 0;
            const isOutOfStock = sku.stock_status === 'out';
            const isLowStock = sku.stock_status === 'low';

            return (
              <div
                key={sku.code}
                className="p-3.5 bg-white border border-border rounded-xl flex flex-col space-y-2.5 transition-colors"
              >
                {/* Header: Title & Stock Status */}
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-bold text-ink leading-snug">
                      {sku.name}
                    </h2>
                    <span className="text-[11px] text-ink-muted block mt-0.5">
                      {sku.code}
                    </span>
                  </div>

                  {/* Stock Status Chip (Never show a number!) */}
                  {isOutOfStock && (
                    <span className="px-2 py-0.5 rounded-lg border border-error text-error text-[11px] font-semibold shrink-0 bg-error-bg/10">
                      {t.out_of_stock}
                    </span>
                  )}
                  {isLowStock && (
                    <span className="px-2 py-0.5 rounded-lg border border-warning text-warning text-[11px] font-semibold shrink-0 bg-warning-bg/10">
                      {t.few_left}
                    </span>
                  )}
                </div>

                {/* Scheme Badge (if applicable) */}
                {sku.scheme_label && (
                  <div className="flex items-center gap-1.5 self-start px-2 py-1 rounded-lg bg-primary-50 border border-primary/20 text-primary text-xs font-semibold">
                    <svg
                      className="w-3.5 h-3.5 text-primary shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V4a2 2 0 10-2 2h2m0 13l4-4m-4 4l-4-4"
                      />
                    </svg>
                    <span>{sku.scheme_label}</span>
                  </div>
                )}

                {/* Price Matrix & Add / Stepper Actions */}
                <div className="flex items-end justify-between pt-1 gap-2">
                  {/* Price breakdown */}
                  <div className="flex flex-col">
                    <span className="text-base font-bold text-ink leading-tight">
                      {formatINR(sku.case_price)} / {t.per_case}
                    </span>
                    <span className="text-xs text-ink-muted leading-tight mt-0.5">
                      ({formatINR(sku.price_per_piece)} × {sku.units_per_case} ·{' '}
                      {sku.price_includes_gst ? t.incl_gst : t.excl_gst})
                    </span>
                  </div>

                  {/* Quantity Stepper or Add Button */}
                  <div className="shrink-0">
                    {isOutOfStock ? (
                      <button
                        type="button"
                        disabled
                        className="min-tap px-4 h-11 rounded-xl bg-gray-100 text-ink-muted border border-border text-xs font-semibold cursor-not-allowed select-none"
                      >
                        {t.out_of_stock}
                      </button>
                    ) : currentQty === 0 ? (
                      <button
                        type="button"
                        onClick={() => onUpdateQty(sku.code, 1)}
                        className="min-tap px-5 h-11 rounded-xl bg-primary text-white font-bold text-xs flex items-center justify-center hover:bg-primary-dark active:bg-primary-dark transition-colors select-none"
                      >
                        {t.add}
                      </button>
                    ) : (
                      <div className="flex items-center border border-primary rounded-xl h-11 bg-white">
                        <button
                          type="button"
                          onClick={() => onUpdateQty(sku.code, Math.max(0, currentQty - 1))}
                          className="min-tap w-11 h-11 flex items-center justify-center text-primary text-xl font-bold hover:bg-gray-50 rounded-l-xl transition-colors select-none focus:outline-none"
                          aria-label={`Decrease ${sku.name}`}
                        >
                          −
                        </button>
                        <span className="px-2 min-w-[48px] text-center text-xs font-bold text-ink select-none">
                          {currentQty} {t.cases}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUpdateQty(sku.code, currentQty + 1)}
                          className="min-tap w-11 h-11 flex items-center justify-center text-primary text-xl font-bold hover:bg-gray-50 rounded-r-xl transition-colors select-none focus:outline-none"
                          aria-label={`Increase ${sku.name}`}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Sticky Bottom Cart Bar (shows only when cart has items) */}
      {totalCasesInCart > 0 && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[420px] bg-primary text-white p-3 z-40 border-t border-primary-dark flex items-center justify-between select-none">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-green-100 font-medium">
              {totalCasesInCart} {t.cases}
            </span>
            <span className="text-base font-bold">
              {formatINR(quote?.payable)}
            </span>
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
