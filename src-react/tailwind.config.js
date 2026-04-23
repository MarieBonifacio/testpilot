/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pl: {
          bg: '#0f1a14',
          'bg-elevated': '#152218',
          'bg-hover': '#1e3328',
          border: 'rgba(42,125,79,0.15)',
          'border-strong': 'rgba(42,125,79,0.35)',
          text: '#e8f0eb',
          'text-muted': '#8aaa96',
          'text-dim': '#567060',
          accent: '#2a7d4f',
          'accent-mid': '#7ec8a0',
          'accent-hover': '#38a063',
          'accent-wash': '#d4f0e0',
          success: '#9ece6a',
          warning: '#e0af68',
          danger: '#f7768e',
          'code-bg': '#0a0e14',
        }
      },
      fontFamily: {
        sans: ['Urbanist', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}