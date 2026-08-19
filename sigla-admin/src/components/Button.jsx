import { Loader2 } from "lucide-react";

/* Shared action button. Modal footers used to spell out their own classes (or
   inline styles) per call site, which is how the app ended up with six primary
   colors and three different paddings. Colors come from the index.css tokens so
   there is one place to change the brand blue. */

const BASE =
  "interactive text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center justify-center gap-1.5 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const VARIANTS = {
  primary:   "text-white",
  danger:    "text-white",
  secondary: "border border-gray-300 text-gray-600 bg-white hover:bg-gray-50",
};

// Filled variants need inline style — Tailwind can't read the CSS vars from the
// arbitrary-value syntax reliably here, and hover needs a paired handler.
const FILLED = {
  primary: { base: "var(--brand-primary)",  hover: "var(--brand-secondary)" },
  danger:  { base: "var(--danger)",         hover: "#dc2626" },
};

const Button = ({
  variant = "primary",
  loading = false,
  disabled = false,
  type = "button",
  children,
  className = "",
  ...rest
}) => {
  const filled = FILLED[variant];
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      className={`${BASE} ${VARIANTS[variant] || VARIANTS.primary} ${className}`}
      style={filled ? { background: filled.base } : undefined}
      onMouseEnter={filled && !isDisabled
        ? (e) => { e.currentTarget.style.background = filled.hover; }
        : undefined}
      onMouseLeave={filled
        ? (e) => { e.currentTarget.style.background = filled.base; }
        : undefined}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
};

export default Button;
