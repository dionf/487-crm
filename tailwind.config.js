/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        "brand": {
          amber: "#FAB868",
          "amber-hover": "#E5A04D",
          orange: "#D4731C",
          black: "#0D0D0F",
          "dark-gray": "#292828",
          "light-gray": "#F4F4F4",
          "warm-white": "#FAF8F5",
          "light-beige": "#F5F0E8",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      borderRadius: {
        "pill": "9999px",
        "card": "16px",
        "btn": "9999px",
      },
    },
  },
  plugins: [],
};
