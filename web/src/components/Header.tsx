import React, { useState } from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type { UserMe } from '../types';

interface HeaderProps {
  user: UserMe | null;
  lang: Language;
  onToggleLang: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  lang,
  onToggleLang,
  onLogout,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const t = translations[lang];

  return (
    <>
      <header className="px-4 py-2.5 border-b border-border bg-surface sticky top-0 z-30 flex items-center justify-between min-h-[56px] select-none">
        {/* Left Side */}
        <div className="flex flex-col min-w-0 pr-2">
          {!user ? (
            <span className="font-bold text-lg text-ink tracking-tight">
              {t.company_name}
            </span>
          ) : (
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-medium text-ink-muted leading-tight truncate">
                {t.ordering_from}
              </span>
              <h1 className="text-base font-bold text-ink leading-tight truncate">
                {user.retailer_name || user.name || t.retailer_label}
              </h1>
            </div>
          )}
        </div>

        {/* Right Side: Language Toggle & Menu */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* EN / हिं Language Switch Button */}
          <button
            type="button"
            onClick={onToggleLang}
            className="min-tap px-3 py-1.5 border border-border rounded-xl text-xs font-semibold flex items-center justify-center text-ink hover:bg-gray-50 focus:outline-none transition-colors"
            aria-label={`Toggle language to ${lang === 'en' ? 'Hindi' : 'English'}`}
          >
            <span className="font-bold">
              {lang === 'en' ? 'हिं' : 'EN'}
            </span>
          </button>

          {/* Menu Button (when logged in or general) */}
          {user && (
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="min-tap w-12 h-12 flex items-center justify-center border border-border rounded-xl text-ink hover:bg-gray-50 focus:outline-none transition-colors"
              aria-label={t.menu}
            >
              <svg
                className="w-5 h-5 text-ink"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Side Menu Drawer */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex justify-end"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-72 bg-white h-full p-5 flex flex-col justify-between border-l border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <span className="font-bold text-base text-ink">
                  {t.company_name}
                </span>
                <button
                  type="button"
                  className="min-tap w-10 h-10 flex items-center justify-center text-ink-muted hover:text-ink text-lg font-bold"
                  onClick={() => setMenuOpen(false)}
                  aria-label={t.close}
                >
                  ✕
                </button>
              </div>

              {user && (
                <div className="mt-4 p-3.5 bg-gray-50 rounded-xl border border-border space-y-1.5">
                  <div className="text-xs text-ink-muted">{t.retailer_label}</div>
                  <div className="text-sm font-bold text-ink break-words">
                    {user.retailer_name || user.name}
                  </div>
                  <div className="text-xs text-ink-muted pt-1">
                    {t.user_role}: <span className="font-medium text-ink">{user.role}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="w-full min-tap py-3 px-4 rounded-xl border border-error text-error font-semibold text-sm flex items-center justify-center hover:bg-error-bg transition-colors"
              >
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                {t.logout}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
