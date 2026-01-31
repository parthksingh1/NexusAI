import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: "1rem", lg: "2rem" },
    },
    extend: {
      colors: {
        // Surfaces
        bg:              "hsl(var(--bg))",
        "bg-subtle":     "hsl(var(--bg-subtle))",
        "bg-muted":      "hsl(var(--bg-muted))",
        "bg-elevated":   "hsl(var(--bg-elevated))",
        "bg-hover":      "hsl(var(--bg-hover))",
        // Text
        fg:              "hsl(var(--fg))",
        "fg-muted":      "hsl(var(--fg-muted))",
        "fg-subtle":     "hsl(var(--fg-subtle))",
        // Borders / ring
        border:          "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        ring:            "hsl(var(--ring))",
        // Brand
        accent: {
          DEFAULT: "hsl(var(--accent))",
          hover:   "hsl(var(--accent-hover))",
          fg:      "hsl(var(--accent-fg))",
          muted:   "hsl(var(--accent-muted))",
        },
        // Semantic
        success: "hsl(var(--success))",
        warn:    "hsl(var(--warn))",
        danger:  "hsl(var(--danger))",
        info:    "hsl(var(--info))",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "JetBrains Mono", "monospace"],
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        tightest: "-0.035em",
        tighter:  "-0.025em",
      },
      borderRadius: {
        sm:  "6px",
        DEFAULT: "10px",
        md:  "10px",
        lg:  "14px",
        xl:  "18px",
        "2xl": "24px",
      },
      boxShadow: {
        sm:   "0 1px 2px hsl(240 10% 4% / 0.04)",
        DEFAULT: "0 1px 3px hsl(240 10% 4% / 0.06), 0 1px 2px hsl(240 10% 4% / 0.04)",
        md:   "0 4px 6px -1px hsl(240 10% 4% / 0.08), 0 2px 4px -2px hsl(240 10% 4% / 0.06)",
        lg:   "0 10px 15px -3px hsl(240 10% 4% / 0.08), 0 4px 6px -4px hsl(240 10% 4% / 0.06)",
        "glow-accent": "0 0 0 1px hsl(var(--accent) / 0.12), 0 8px 24px -8px hsl(var(--accent) / 0.35)",
        "inset-top":   "inset 0 1px 0 0 hsl(0 0% 100% / 0.04)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in":   { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "pulse-dot": { "0%,100%": { opacity: "0.4", transform: "scale(0.85)" }, "50%": { opacity: "1", transform: "scale(1.1)" } },
      },
      animation: {
        "fade-in":   "fade-in 300ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
