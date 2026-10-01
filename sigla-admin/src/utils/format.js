// 0.8734 -> "87.3%"; null/undefined -> "—".
export const formatPercent = (val) =>
  val != null ? `${(val * 100).toFixed(1)}%` : "—";
