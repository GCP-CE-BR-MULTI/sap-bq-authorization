/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Google Sans"', '"DM Sans"', 'Roboto', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        body: ['Roboto', '"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Roboto Mono"', 'monospace'],
      },
      colors: {
        gcp: {
          blue: '#1a73e8',
          blueHover: '#1557b0',
          blueLight: '#e8f0fe',
          blueBorder: '#d2e3fc',
          green: '#1e8e3e',
          greenLight: '#e6f4ea',
          greenBorder: '#ceead6',
          yellow: '#f9ab00',
          yellowLight: '#fef7e0',
          yellowBorder: '#feefc3',
          red: '#d93025',
          redLight: '#fce8e6',
          redBorder: '#fad2cf',
          border: '#dadce0',
          bg: '#f8f9fa',
          surface: '#ffffff',
        }
      }
    },
  },
  plugins: [],
}
