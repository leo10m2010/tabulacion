import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.25rem",
      screens: {
        "2xl": "1280px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', "Segoe UI", "system-ui", "sans-serif"],
        display: ['"Space Grotesk Variable"', '"Inter Variable"', "sans-serif"],
      },
      borderRadius: {
        lg: "0.9rem",
        md: "0.65rem",
        sm: "0.45rem",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
        },
        "danger-deep": "hsl(var(--danger-deep))",
        ambar: "hsl(var(--amber))",
        "primary-deep": "hsl(var(--primary-deep))",
      },
      boxShadow: {
        glow: "0 20px 45px -25px hsl(var(--primary) / 0.45)",
        hero: "0 40px 90px -28px rgba(14, 60, 45, 0.16)",
        soft: "0 12px 32px -12px rgba(14, 60, 45, 0.14)",
      },
    },
  },
  plugins: [],
} satisfies Config;
