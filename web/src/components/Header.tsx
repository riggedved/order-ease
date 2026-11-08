import React from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import type { UserMe } from '../types';
import { formatINRPill } from '../utils';

export interface HeaderProps {
  user: UserMe | null;
  lang: Language;
  onToggleLang: () => void;
  onLogout: () => void;
  onOpenProfile?: () => void;
  onOpenCredit?: () => void;
  profileButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  lang,
  onToggleLang,
  onOpenProfile,
  onOpenCredit,
  profileButtonRef,
}) => {
  const t = translations[lang];

  // Derive available credit text if data loaded successfully
  const availableCreditText =
    user?.available_credit != null ? formatINRPill(user.available_credit) : null;

  return (
    <header className="px-4 py-2.5 border-b border-border bg-surface sticky top-0 z-30 flex items-center justify-between h-14 min-h-[56px] select-none">
      {/* Left Side */}
      <div className="flex flex-col min-w-0 pr-2 flex-1 justify-center">
        {!user ? (
          <span className="font-bold text-lg text-ink tracking-tight">
            {t.company_name}
          </span>
        ) : (
          <>
            <span className="text-[11px] font-medium text-ink-muted leading-tight truncate">
              {t.ordering_from}
            </span>
            <h1 className="text-base font-bold text-ink leading-tight truncate">
              {user.retailer_name || user.name || t.retailer_label}
            </h1>
          </>
        )}
      </div>

      {/* Right Side: Credit Button + Profile Button for retailer, Language toggle for login screen */}
      <div className="flex items-center gap-2 shrink-0">
        {!user ? (
          /* Keep language toggle on login screen */
          <div
            className="border border-border rounded-xl p-0.5 inline-flex items-center bg-white h-9 select-none shrink-0"
            role="group"
            aria-label="Language selector"
          >
            <button
              type="button"
              onClick={() => {
                if (lang !== 'en') onToggleLang();
              }}
              className={`w-9 h-7 flex items-center justify-center text-xs font-bold rounded-lg transition-colors ${
                lang === 'en'
                  ? 'bg-primary text-white'
                  : 'text-ink-muted hover:text-ink bg-transparent'
              }`}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
            <span className="text-border px-0.5 text-xs select-none">|</span>
            <button
              type="button"
              onClick={() => {
                if (lang !== 'hi') onToggleLang();
              }}
              className={`w-9 h-7 flex items-center justify-center text-xs font-bold rounded-lg transition-colors ${
                lang === 'hi'
                  ? 'bg-primary text-white'
                  : 'text-ink-muted hover:text-ink bg-transparent'
              }`}
              aria-pressed={lang === 'hi'}
            >
              हिं
            </button>
          </div>
        ) : (
          <>
            {availableCreditText && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenCredit?.();
                }}
                className={`min-tap h-12 px-3 rounded-xl select-none transition-colors border flex items-center gap-1.5 text-xs font-bold shrink-0 ${
                  user.credit_low
                    ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200 active:bg-amber-200'
                    : 'bg-[#E8F5E9] text-[#0C6B1A] border-green-200 hover:bg-green-100 active:bg-green-100'
                }`}
                aria-label={`${availableCreditText} ${t.credit_left}`}
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <rect x="2" y="6" width="20" height="12" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="12" cy="12" r="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="6" y1="12" x2="6.01" y2="12" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="18" y1="12" x2="18.01" y2="12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{availableCreditText} {t.credit_left}</span>
              </button>
            )}

            {/* One 48px outlined profile icon button (circular, inline SVG person icon, aria-label "Profile") */}
            <button
              type="button"
              ref={profileButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                onOpenProfile?.();
              }}
              className="min-tap w-12 h-12 flex items-center justify-center border border-border rounded-full text-ink hover:bg-gray-50 focus:outline-none focus:border-primary transition-colors select-none shrink-0"
              aria-label={t.profile}
            >
              <svg
                className="w-5 h-5 text-ink"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </button>
          </>
        )}
      </div>
    </header>
  );
};
