/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e3a8a",
          900: "#0f2057",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      // Larger application-wide scale. These values align the utility classes
      // with the semantic typography tokens in index.css.
      fontSize: {
        xs: ["0.9375rem", { lineHeight: "1.25rem" }],
        sm: ["1.0625rem", { lineHeight: "1.5rem" }],
        base: ["1.125rem", { lineHeight: "1.625rem" }],
        lg: ["1.3125rem", { lineHeight: "1.875rem" }],
        xl: ["1.5rem", { lineHeight: "2rem" }],
        "2xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "3xl": ["2.25rem", { lineHeight: "2.625rem" }],
      },
      // Mirrors the motion tokens in index.css so utility classes and
      // hand-written CSS draw from one scale. Use duration-fast / duration-base
      // / duration-slow rather than Tailwind's numeric durations.
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.4, 0, 0.2, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    },
  },
  plugins: [],
};
