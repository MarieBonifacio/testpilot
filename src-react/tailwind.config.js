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
          bg: '#0f1419',
          'bg-elevated': '#1a1f2e',
          'bg-hover': '#242b3d',
          border: '#2d3548',
          'border-strong': '#3d4760',
          text: '#e6e9ef',
          'text-muted': '#8b93a7',
          'text-dim': '#5a6378',
          accent: '#7aa2f7',
          'accent-hover': '#9bb8ff',
          success: '#9ece6a',
          warning: '#e0af68',
          danger: '#f7768e',
          'code-bg': '#0a0e14',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}