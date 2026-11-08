import React, { useState, useEffect } from 'react';
import type { Language } from '../i18n';

export interface QuantityStepperProps {
  qty: number;
  onUpdate: (newQty: number) => void;
  lang: Language;
  disabled?: boolean;
  min?: number;
  max?: number;
  variant?: 'green' | 'white';
  ariaLabel?: string;
  className?: string;
}

export const QuantityStepper: React.FC<QuantityStepperProps> = ({
  qty,
  onUpdate,
  lang,
  disabled = false,
  min = 0,
  max,
  variant = 'white',
  ariaLabel = 'Quantity',
  className = '',
}) => {
  const [localVal, setLocalVal] = useState<string>(String(qty));
  const [isFocused, setIsFocused] = useState(false);

  // Sync from props when parent updates and user is not actively typing
  useEffect(() => {
    if (!isFocused) {
      setLocalVal(String(qty));
    }
  }, [qty, isFocused]);

  const commitValue = (valStr: string) => {
    const trimmed = valStr.trim();
    if (trimmed === '') {
      // Revert if left completely blank
      setLocalVal(String(qty));
      return;
    }

    let parsed = parseInt(trimmed, 10);
    if (isNaN(parsed)) {
      setLocalVal(String(qty));
      return;
    }

    if (min !== undefined && parsed < min) {
      parsed = min;
    }
    if (max !== undefined && parsed > max) {
      parsed = max;
    }

    if (parsed !== qty) {
      onUpdate(parsed);
    }
    setLocalVal(String(parsed));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    // Allow typing only positive integer digits or empty string while editing
    if (val === '' || /^\d+$/.test(val)) {
      setLocalVal(val);
      if (val !== '') {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed) && parsed >= min && (max === undefined || parsed <= max)) {
          // Commit live update when a valid number is typed
          onUpdate(parsed);
        }
      }
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    commitValue(localVal);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    e.target.select();
  };

  const handleDecrease = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = Math.max(min, qty - 1);
    setLocalVal(String(next));
    onUpdate(next);
  };

  const handleIncrease = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = max !== undefined ? Math.min(max, qty + 1) : qty + 1;
    setLocalVal(String(next));
    onUpdate(next);
  };

  const unitLabel = lang === 'hi' ? 'केस' : qty === 1 ? 'case' : 'cases';

  if (variant === 'green') {
    return (
      <div
        className={`w-full min-h-[48px] h-12 rounded-xl bg-primary text-white font-bold flex items-center justify-between px-1.5 select-none ${className}`}
      >
        <button
          type="button"
          onClick={handleDecrease}
          disabled={disabled || (min !== undefined && qty <= min)}
          className="w-10 h-10 flex items-center justify-center text-white text-body font-bold hover:bg-primary-dark active:bg-primary-dark rounded-lg transition-colors focus:outline-none disabled:opacity-40"
          aria-label={`Decrease ${ariaLabel}`}
        >
          −
        </button>

        <div className="flex-1 flex items-center justify-center gap-1 px-1 min-w-0">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={localVal}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="w-12 h-8 text-center font-bold text-body tabular-nums text-ink bg-white rounded-lg focus:ring-2 focus:ring-white outline-none select-text shadow-sm"
            aria-label={`${ariaLabel} quantity`}
            title="Edit quantity"
          />
          <span className="text-small text-white/95 font-medium whitespace-nowrap">
            {unitLabel}
          </span>
        </div>

        <button
          type="button"
          onClick={handleIncrease}
          disabled={disabled || (max !== undefined && qty >= max)}
          className="w-10 h-10 flex items-center justify-center text-white text-body font-bold hover:bg-primary-dark active:bg-primary-dark rounded-lg transition-colors focus:outline-none disabled:opacity-40"
          aria-label={`Increase ${ariaLabel}`}
        >
          +
        </button>
      </div>
    );
  }

  // Variant === 'white' (Default for CartView and other clean white contexts)
  return (
    <div
      className={`flex items-center border border-border rounded-xl h-12 bg-surface ${className}`}
    >
      <button
        type="button"
        onClick={handleDecrease}
        disabled={disabled || (min !== undefined && qty <= min)}
        className="w-12 h-12 flex items-center justify-center text-primary text-body font-bold hover:bg-gray-100 active:bg-gray-200 rounded-l-xl transition-colors select-none focus:outline-none disabled:opacity-40"
        aria-label={`Decrease ${ariaLabel}`}
      >
        −
      </button>

      <div className="flex items-center justify-center gap-1.5 px-2 min-w-[84px]">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={localVal}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className="w-14 h-8 text-center font-bold text-body tabular-nums text-ink bg-white border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary outline-none select-text shadow-sm"
          aria-label={`${ariaLabel} quantity`}
          title="Edit quantity"
        />
        <span className="text-small text-ink-muted font-medium whitespace-nowrap">
          {unitLabel}
        </span>
      </div>

      <button
        type="button"
        onClick={handleIncrease}
        disabled={disabled || (max !== undefined && qty >= max)}
        className="w-12 h-12 flex items-center justify-center text-primary text-body font-bold hover:bg-gray-100 active:bg-gray-200 rounded-r-xl transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none"
        aria-label={`Increase ${ariaLabel}`}
      >
        +
      </button>
    </div>
  );
};

