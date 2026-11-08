import React, { useState, useEffect, useRef } from 'react';
import type { DeskLanguage } from './i18n';
import { deskTranslations } from './i18n';
import type { DeskOrderSummary, DeskOrdersCounts, OrderStatus } from './types';
import { formatINR, formatDateOnly, formatTimeOnly } from './formatters';
import { SearchIcon } from './icons';

export interface OrderQueueProps {
  lang: DeskLanguage;
  orders: DeskOrderSummary[];
  counts: DeskOrdersCounts;
  total: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedOrderId: number | null;
  onSelectOrder: (id: number) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  fromDate: string;
  onFromDateChange: (d: string) => void;
  toDate: string;
  onToDateChange: (d: string) => void;
  statusTab: string;
  onStatusTabChange: (status: string) => void;
  pageOffset: number;
  pageSize: number;
  onPageChange: (newOffset: number) => void;
}

export const OrderQueue: React.FC<OrderQueueProps> = ({
  lang,
  orders,
  counts,
  total,
  loading,
  error,
  onRetry,
  selectedOrderId,
  onSelectOrder,
  searchQuery,
  onSearchChange,
  fromDate,
  onFromDateChange,
  toDate,
  onToDateChange,
  statusTab,
  onStatusTabChange,
  pageOffset,
  pageSize,
  onPageChange,
}) => {
  const t = deskTranslations[lang];

  // 300ms Debounce for Search input
  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== searchQuery) {
        onSearchChange(localSearch);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, searchQuery, onSearchChange]);

  // Ref to scroll selected row into view
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedOrderId]);

  const tabs: Array<{ id: string; label: string; count: number }> = [
    { id: 'all', label: t.tab_all, count: counts.all },
    { id: 'pending', label: t.tab_pending, count: counts.pending },
    { id: 'credit_hold', label: t.tab_credit_hold, count: counts.credit_hold },
    { id: 'approved', label: t.tab_approved, count: counts.approved },
  ];

  const getStatusDisplay = (status: OrderStatus) => {
    switch (status) {
      case 'credit_hold':
        return <span className="font-semibold text-error">{t.status_credit_hold}</span>;
      case 'pending':
        return <span className="text-ink-muted">{t.status_pending}</span>;
      case 'approved':
        return <span className="font-semibold text-primary">{t.status_approved}</span>;
      case 'cancelled':
        return <span className="text-ink-subtle">{t.status_cancelled}</span>;
      default:
        return <span className="text-ink-muted">{status}</span>;
    }
  };

  const fromCount = total === 0 ? 0 : pageOffset + 1;
  const toCount = Math.min(pageOffset + pageSize, total);
  const paginationText = t.pagination_summary
    .replace('{from}', String(fromCount))
    .replace('{to}', String(toCount))
    .replace('{total}', String(total));

  return (
    <div className="w-[60%] shrink-0 h-full min-h-0 flex flex-col p-4 border-r border-border bg-white select-none overflow-hidden">
      {/* Compact Toolbar in 2 rows at most */}
      <div className="flex flex-col gap-2 shrink-0 mb-2">
        {/* Row 1: Search, From, To (36px tall fields, 13px labels, lang="en-IN" for DD/MM/YYYY) */}
        <div className="flex items-center gap-2 w-full">
          {/* Retailer Search Box */}
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none">
              <SearchIcon className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder={t.search_retailer_placeholder}
              className="w-full h-9 pl-9 pr-3 text-[14px] bg-white border border-border rounded text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary"
            />
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="flex items-center border border-border rounded bg-white h-9 px-2">
              <span className="text-[13px] font-medium text-ink-muted mr-1.5 uppercase">
                {t.from_date}
              </span>
              <input
                type="date"
                lang="en-IN"
                value={fromDate}
                onChange={(e) => onFromDateChange(e.target.value)}
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
                onChange={(e) => onToDateChange(e.target.value)}
                className="text-[14px] text-ink bg-transparent focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Row 2: Tabs on left, shortcut hint on right, same line */}
        <div className="flex items-center justify-between border-b border-border min-h-[32px] overflow-hidden">
          {/* Filter Tabs */}
          <div className="flex items-center gap-0.5 shrink-0">
            {tabs.map((tab) => {
              const isActive = statusTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onStatusTabChange(tab.id)}
                  className={`py-1 px-2 text-[13px] transition-colors border-b-2 flex items-center gap-1 shrink-0 ${
                    isActive
                      ? 'border-primary text-primary font-semibold -mb-[1px]'
                      : 'border-transparent text-ink-muted hover:text-ink'
                  }`}
                >
                  <span className="whitespace-nowrap">{tab.label}</span>
                  <span
                    className={`text-[12px] px-1 py-0.2 rounded-full ${
                      isActive
                        ? 'bg-primary-50 text-primary font-semibold'
                        : 'text-ink-muted'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Shortcut hint on right, same line */}
          <div className="text-[12px] text-ink-muted tracking-tight whitespace-nowrap pl-2 truncate shrink-0">
            {t.keyboard_shortcuts}
          </div>
        </div>
      </div>

      {/* Orders Table Area: Fills remaining height with vertical scroll, sticky header, 36px rows */}
      <div className="w-full flex-1 min-h-0 overflow-y-auto">
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
              onClick={onRetry}
              className="px-4 py-1.5 border border-border rounded text-ink hover:bg-gray-50 text-[14px]"
            >
              {t.btn_retry}
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[14px] text-ink-muted">
            <p className="font-semibold text-ink text-[16px] mb-1">{t.empty_orders_title}</p>
            <p className="text-[13px]">{t.empty_orders_desc}</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="h-9 border-b border-border text-ink-muted text-[13px]">
                <th className="px-3 font-medium bg-gray-50">{t.col_retailer}</th>
                <th className="px-3 font-medium text-right bg-gray-50">{t.col_total}</th>
                <th className="px-3 font-medium bg-gray-50">{t.col_status}</th>
                <th className="px-3 font-medium bg-gray-50">{t.col_date}</th>
                <th className="px-3 font-medium text-right bg-gray-50">{t.col_time}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((order) => {
                const isSelected = selectedOrderId === order.id;
                return (
                  <tr
                    key={order.id}
                    ref={isSelected ? selectedRowRef : undefined}
                    onClick={() => onSelectOrder(order.id)}
                    className={`h-9 cursor-pointer transition-colors text-[14px] ${
                      isSelected
                        ? 'bg-[#f0fdf4] font-medium'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Retailer Name */}
                    <td className="px-3 text-ink truncate max-w-[200px]">
                      <div className="flex items-center gap-1.5">
                        {isSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        )}
                        <span className="truncate">{order.retailer}</span>
                      </div>
                    </td>

                    {/* Total (Tabular Nums) */}
                    <td className="px-3 text-right font-semibold text-ink tabular-nums">
                      {formatINR(order.total)}
                    </td>

                    {/* Status */}
                    <td className="px-3 text-[13px]">
                      {getStatusDisplay(order.status)}
                    </td>

                    {/* Date */}
                    <td className="px-3 text-ink-muted text-[13px] tabular-nums whitespace-nowrap">
                      {formatDateOnly(order.created_at)}
                    </td>

                    {/* Time */}
                    <td className="px-3 text-right text-ink-muted text-[13px] tabular-nums whitespace-nowrap">
                      {formatTimeOnly(order.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Paging Bar: Pinned at the bottom, 40px tall */}
      <div className="h-10 shrink-0 border-t border-border flex items-center justify-between text-[13px] pt-1 mt-auto">
        <span className="text-ink-muted tabular-nums">{paginationText}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pageOffset === 0 || loading}
            onClick={() => onPageChange(Math.max(0, pageOffset - pageSize))}
            className={`px-3 h-8 border border-border rounded text-[13px] transition-colors ${
              pageOffset === 0 || loading
                ? 'bg-gray-100 text-ink-subtle cursor-not-allowed opacity-60'
                : 'text-ink hover:bg-gray-50'
            }`}
          >
            {t.btn_previous}
          </button>
          <button
            type="button"
            disabled={pageOffset + pageSize >= total || loading}
            onClick={() => onPageChange(pageOffset + pageSize)}
            className={`px-3 h-8 border border-border rounded text-[13px] transition-colors ${
              pageOffset + pageSize >= total || loading
                ? 'bg-gray-100 text-ink-subtle cursor-not-allowed opacity-60'
                : 'text-ink hover:bg-gray-50'
            }`}
          >
            {t.btn_next}
          </button>
        </div>
      </div>
    </div>
  );
};
