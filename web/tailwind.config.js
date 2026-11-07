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

