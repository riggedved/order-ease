/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0C831F',
          dark: '#096317',
          light: '#E0FFD7',
          50: '#F0FDF4',
        },
        ink: {
          DEFAULT: '#111827',
          muted: '#6B7280',
          subtle: '#9CA3AF',
        },
        surface: '#FFFFFF',
        canvas: '#FFFFFF',
        border: {
          DEFAULT: '#E5E7EB',
          subtle: '#F3F4F6',
        },
        warning: {
          DEFAULT: '#D97706',
          bg: '#FEF3C7',
        },
        error: {
          DEFAULT: '#DC2626',
          bg: '#FEE2E2',
        },
      },
      fontSize: {
        title: ['var(--font-size-title)', { lineHeight: 'var(--line-height-title)', fontWeight: '700' }],
        price: ['var(--font-size-price)', { lineHeight: 'var(--line-height-price)', fontWeight: '700' }],
        body: ['var(--font-size-body)', { lineHeight: 'var(--line-height-body)', fontWeight: '400' }],
        small: ['var(--font-size-small)', { lineHeight: 'var(--line-height-small)', fontWeight: '400' }],
        micro: ['var(--font-size-micro)', { lineHeight: 'var(--line-height-micro)', fontWeight: '500' }],
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      minHeight: {
        tap: '48px',
      },
      minWidth: {
        tap: '48px',
      },
      boxShadow: {
        none: 'none',
      },
    },
  },
  plugins: [],
}

