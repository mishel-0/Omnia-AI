import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--bg-color)",
        primary: "var(--text-primary)",
        accent: "#60A5FA",
        "accent-secondary": "#3B82F6",
        "text-secondary": "#64748B",
        success: "#28CD41",
        // Skyblue iOS accent palette
        sky: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        cyan: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
          950: '#083344',
        },
      },
      borderRadius: {
        'pill': '9999px',
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '28px',
        '5xl': '40px',
        '6xl': '56px',
      },
      boxShadow: {
        'ios': '0 4px 24px 0 rgba(0, 0, 0, 0.04)',
        'ios-lg': '0 12px 48px 0 rgba(0, 0, 0, 0.08)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
        'soft': '0 20px 50px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
};
export default config;
