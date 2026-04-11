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
        background: "var(--bg-color)", // Dynamic based on theme
        primary: "var(--text-primary)", // Dynamic text color
        accent: "#60A5FA", // Sky blue
        "accent-secondary": "#3B82F6",
        "text-secondary": "#64748B",
        success: "#28CD41",
        slate: "#1C1C1E",
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
