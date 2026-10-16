/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // NxgSecure brand amber scale
        brand: {
          50:  '#FFFBF0',
          100: '#FDF3DC',
          200: '#FAE8B8',
          300: '#F0CC7A',
          400: '#D4A84B',
          500: '#B8872A',
          550: '#B8872A',
          600: '#9E7123',
          700: '#7A5719',
          800: '#5C3F10',
          900: '#3D2A08',
          950: '#1E1504',
        },
        // NxgSecure warm cream structural tokens
        cyber: {
          darker:  '#EDE8DC',
          dark:    '#F5F1E8',
          card:    '#FDFAF5',
          border:  '#D8D2C4',
          text:    '#1A1814',
          muted:   '#6B6358',
          success: '#16a34a',
          warning: '#d97706',
          danger:  '#dc2626',
          info:    '#0284c7',
        },
        // Remap slate to warm light scale (900=lightest surface, 50=darkest text)
        slate: {
          50:  '#1A1814',
          100: '#2C2621',
          200: '#3D352D',
          300: '#6B6358',
          400: '#8A7F73',
          500: '#A89E90',
          600: '#C4BEB0',
          700: '#D8D2C4',
          800: '#EDE8DC',
          900: '#F5F1E8',
          950: '#FDFAF5',
        },
        // Remap indigo to NxgSecure amber (auto-updates all indigo-* usages across the app)
        indigo: {
          50:  '#FFFBF0',
          100: '#FDF3DC',
          200: '#FAE8B8',
          300: '#F0CC7A',
          400: '#D4A84B',
          500: '#B8872A',
          600: '#9E7123',
          700: '#7A5719',
          800: '#5C3F10',
          900: '#3D2A08',
          950: '#1E1504',
        },
      },
      fontFamily: {
        sans:  ['DM Sans', 'sans-serif'],
        serif: ['DM Serif Display', 'serif'],
      },
    },
  },
  plugins: [],
}
