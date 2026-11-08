import React, { useState, useRef, useEffect } from 'react';
import type { Language } from '../i18n';
import { translations } from '../i18n';
import { loginWithOTP, ApiError } from '../api';
import type { TokenResponse } from '../types';

interface LoginScreenProps {
  lang: Language;
  onLoginSuccess: (tokenData: TokenResponse) => void;
}

interface DemoAccount {
  phone: string;
  name: string;
  role?: string;
}

const DEMO_STAFF: DemoAccount[] = [
  {
    phone: '9826000001',
    name: 'Desk Officer',
    role: 'Order Desk',
  },
];

const DEMO_RETAILERS: DemoAccount[] = [
  {
    phone: '9826011111',
    name: 'Gupta Kirana Store',
  },
  {
    phone: '9826022222',
    name: 'Sharma Provision Store',
  },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({
  lang,
  onLoginSuccess,
}) => {
  const t = translations[lang];

  // State
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(30);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Timer for OTP resend
  useEffect(() => {
    let timer: any = null;
    if (step === 'otp' && resendSeconds > 0) {
      timer = setInterval(() => {
        setResendSeconds((prev) => prev - 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [step, resendSeconds]);

  // Focus first OTP input when entering OTP step
  useEffect(() => {
    if (step === 'otp') {
      setTimeout(() => {
        otpInputsRef.current[0]?.focus();
      }, 50);
    }
  }, [step]);

  // Handle phone submission
  const handleSendOTP = (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError(null);

    const cleanPhone = phone.trim();
    if (!/^\d{10}$/.test(cleanPhone)) {
      setPhoneError(t.phone_invalid_format);
      return;
    }

    // Go to OTP step
    setStep('otp');
    setResendSeconds(30);
    setOtp(['', '', '', '', '', '']);
    setOtpError(null);
  };

  // Handle OTP digit changes
  const handleOtpChange = (index: number, value: string) => {
    setOtpError(null);

    // Handle paste of full 6-digit code
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').slice(0, 6).split('');
      const newOtp = [...otp];
      for (let i = 0; i < 6; i++) {
        newOtp[i] = digits[i] || '';
      }
      setOtp(newOtp);
      const nextIndex = Math.min(digits.length, 5);
      otpInputsRef.current[nextIndex]?.focus();
      return;
    }

    const cleanDigit = value.replace(/\D/g, '');
    const newOtp = [...otp];
    newOtp[index] = cleanDigit;
    setOtp(newOtp);

    if (cleanDigit && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  // Auto fill demo code
  const fillDemoCode = () => {
    setOtp(['1', '2', '3', '4', '5', '6']);
    setOtpError(null);
    otpInputsRef.current[5]?.focus();
  };

  // Handle verification
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullOtp = otp.join('');
    if (fullOtp.length !== 6) {
      setOtpError(t.otp_error_invalid);
      return;
    }

    setLoading(true);
    setOtpError(null);

    try {
      const res = await loginWithOTP(phone.trim(), fullOtp);
      onLoginSuccess(res);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.data?.detail?.includes('Phone number not registered')) {
          // If phone was unregistered on server check
          setStep('phone');
          setPhoneError(t.phone_error_unregistered);
        } else {
          setOtpError(t.otp_error_invalid);
        }
      } else {
        setOtpError(t.otp_error_invalid);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 px-4 pt-6 pb-8 bg-surface">
      {step === 'phone' ? (
        // ================= STEP 1: MOBILE NUMBER =================
        <section className="flex flex-col w-full">
          <div className="mb-6">
            <h1 className="text-title font-bold text-ink leading-tight mb-2">
              {t.login_title}
            </h1>
            <p className="text-body text-ink-muted leading-relaxed">
              {t.login_subtitle}
            </p>
          </div>

          <form onSubmit={handleSendOTP} className="flex flex-col w-full">
            <label
              htmlFor="mobile-number"
              className="text-body font-semibold text-ink mb-2 block"
            >
              {t.mobile_number}
            </label>

            <div className="flex items-center gap-2.5 w-full h-14 mb-3">
              {/* Country Code Prefix */}
              <div className="min-w-[64px] w-[64px] h-14 flex items-center justify-center bg-gray-50 border border-border rounded-xl font-bold text-body text-ink select-none">
                +91
              </div>

              {/* Mobile Input */}
              <input
                id="mobile-number"
                type="tel"
                inputMode="numeric"
                pattern="[0-9]{10}"
                maxLength={10}
                value={phone}
                onChange={(e) => {
                  setPhoneError(null);
                  setPhone(e.target.value.replace(/\D/g, ''));
                }}
                placeholder={t.phone_placeholder}
                className={`flex-1 h-14 bg-surface border ${
                  phoneError ? 'border-error bg-error-bg/10' : 'border-border'
                } rounded-xl px-4 text-body font-medium text-ink placeholder:text-ink-muted focus:border-primary focus:outline-none transition-colors`}
                autoFocus
                required
              />
            </div>

            {/* Error Message Banner */}
            {phoneError && (
              <div
                className="mb-4 p-3 bg-error-bg/30 border border-error/30 rounded-xl flex items-start gap-2 text-error text-small leading-relaxed"
                role="alert"
              >
                <svg
                  className="w-4 h-4 shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{phoneError}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || phone.trim().length !== 10}
              className="min-tap w-full h-14 rounded-xl bg-primary text-white font-bold text-body flex items-center justify-center border-0 active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none"
            >
              {t.send_otp}
            </button>
          </form>

          {/* Quick Demo Accounts Helper */}
          <div className="mt-6 p-3.5 bg-gray-50 border border-border rounded-xl text-small space-y-3">
            <div className="pb-1 border-b border-border/60">
              <span className="font-bold text-ink">
                {lang === 'hi' ? 'डेमो खाते (क्लिक करें):' : 'Demo Accounts (tap to fill):'}
              </span>
            </div>

            {/* Staff / Desk Section */}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                {lang === 'hi' ? 'स्टाफ एवं ऑर्डर डेस्क' : 'Staff & Order Desk'}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {DEMO_STAFF.map((acc) => {
                  const isSelected = phone === acc.phone;
                  return (
                    <button
                      key={acc.phone}
                      type="button"
                      onClick={() => {
                        setPhone(acc.phone);
                        setPhoneError(null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-all flex items-center justify-between ${
                        isSelected
                          ? 'border-primary bg-primary-50 text-ink shadow-none font-medium'
                          : 'border-border/80 bg-white hover:border-primary/50 text-ink'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-[13px] font-medium text-ink truncate">
                          {acc.name}
                        </span>
                        {acc.role && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-ink-muted shrink-0">
                            {acc.role}
                          </span>
                        )}
                      </div>
                      <span className="text-[12px] text-ink-muted tabular-nums shrink-0 ml-2">
                        {acc.phone}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Kirana Retailers Section */}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1.5">
                {lang === 'hi' ? 'किराना विक्रेता' : 'Kirana Retailers'}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {DEMO_RETAILERS.map((acc) => {
                  const isSelected = phone === acc.phone;
                  return (
                    <button
                      key={acc.phone}
                      type="button"
                      onClick={() => {
                        setPhone(acc.phone);
                        setPhoneError(null);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg border transition-all flex items-center justify-between ${
                        isSelected
                          ? 'border-primary bg-primary-50 text-ink shadow-none font-medium'
                          : 'border-border/80 bg-white hover:border-primary/50 text-ink'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-[13px] font-medium text-ink truncate">
                          {acc.name}
                        </span>
                      </div>
                      <span className="text-[12px] text-ink-muted tabular-nums shrink-0 ml-2">
                        {acc.phone}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      ) : (
        // ================= STEP 2: 6-DIGIT OTP =================
        <section className="flex flex-col w-full">
          <div className="mb-6">
            <h1 className="text-title font-bold text-ink leading-tight mb-2">
              {t.enter_code}
            </h1>
            <p className="text-body text-ink-muted leading-relaxed">
              {t.code_sent_to}{' '}
              <span className="font-semibold text-ink">+91 {phone}</span>
            </p>
          </div>

          <form onSubmit={handleVerify} className="flex flex-col w-full">
            {/* 6 Digit Inputs Row */}
            <div className="flex items-center justify-between gap-1.5 w-full mb-3">
              {otp.map((digit, idx) => (
                <div
                  key={idx}
                  className={`w-[48px] h-[56px] rounded-xl border flex items-center justify-center bg-surface transition-colors ${
                    otpError
                      ? 'border-error bg-error-bg/10'
                      : digit
                      ? 'border-primary'
                      : 'border-border'
                  }`}
                >
                  <input
                    ref={(el) => { otpInputsRef.current[idx] = el; }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className="w-full h-full text-center text-price font-bold tabular-nums text-ink bg-transparent outline-none border-none p-0 focus:ring-0"
                    aria-label={`Digit ${idx + 1}`}
                  />
                </div>
              ))}
            </div>

            {/* Demo Hint Line */}
            <div className="mb-4 flex items-center justify-between text-small text-ink-muted">
              <span>{t.demo_code_hint}</span>
              <button
                type="button"
                onClick={fillDemoCode}
                className="text-primary font-semibold hover:underline"
              >
                Auto-fill
              </button>
            </div>

            {/* Error Message */}
            {otpError && (
              <div
                className="mb-4 p-3 bg-error-bg/30 border border-error/30 rounded-xl flex items-start gap-2 text-error text-small leading-relaxed"
                role="alert"
              >
                <svg
                  className="w-4 h-4 shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{otpError}</span>
              </div>
            )}

            {/* Verify Button */}
            <button
              type="submit"
              disabled={loading || otp.join('').length !== 6}
              className="min-tap w-full h-14 rounded-xl bg-primary text-white font-bold text-body flex items-center justify-center border-0 active:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none mb-4"
            >
              {loading ? t.submitting : t.verify}
            </button>

            {/* Footer Navigation: Resend & Change Number */}
            <div className="flex items-center justify-between w-full px-0.5 text-small text-ink-muted">
              {resendSeconds > 0 ? (
                <span>
                  {t.resend_in.replace('{s}', resendSeconds.toString())}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setResendSeconds(30);
                    setOtp(['', '', '', '', '', '']);
                    setOtpError(null);
                  }}
                  className="text-primary font-semibold hover:underline"
                >
                  {t.resend_now}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setStep('phone');
                  setOtpError(null);
                }}
                className="text-primary font-semibold hover:underline"
              >
                {t.change_number}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
};
