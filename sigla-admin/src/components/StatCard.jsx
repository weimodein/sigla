import { listStagger } from "../utils/motion.js";

/* The summary tile used at the top of every list page, and its loading
   placeholder.

   Both were previously copy-pasted into seven page files. When the entrance
   animation was added it only reached Dashboard's copy, so its cards animated
   while every other page's popped in — the exact inconsistency the motion pass
   was meant to remove. One definition means the next change cannot drift either.

   `index` drives the stagger so a row of cards enters left to right; it defaults
   to 0, so a caller that does not care still animates. */

export const StatCard = ({ title, value, icon: Icon, color, onClick, index = 0 }) => (
  <div
    className="dash-stat-card list-item-in flex items-center gap-4 min-w-0"
    onClick={onClick}
    style={{ ...listStagger(index), ...(onClick ? { cursor: "pointer" } : {}) }}
  >
    <div className={`p-3 rounded-full shrink-0 ${color}`}>
      <Icon size={20} className="text-white" />
    </div>
    <div className="min-w-0">
      <p className="text-xs text-gray-500 truncate">{title}</p>
      <p className="text-2xl font-bold text-gray-800">{value ?? "—"}</p>
    </div>
  </div>
);

/* Carries the same entrance as StatCard so the skeleton grid arrives the way the
   real cards do and the handoff between them does not jump. */
export const SkeletonCard = ({ index = 0 }) => (
  <div
    className="dash-stat-card list-item-in flex items-center gap-4"
    style={{ ...listStagger(index), opacity: 0.6 }}
  >
    <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse shrink-0" />
    <div className="space-y-2 flex-1 min-w-0">
      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
      <div className="h-7 w-10 bg-gray-200 rounded animate-pulse" />
    </div>
  </div>
);

export default StatCard;
