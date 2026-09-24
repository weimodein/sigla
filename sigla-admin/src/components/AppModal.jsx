import {
  useEffect,
  useId,
  useRef,
  Children,
  Fragment,
  cloneElement,
  isValidElement,
} from "react";
import { X } from "lucide-react";
import { useModalKeys } from "./useModalKeys.js";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/* Standard footer geometry: right-aligned, natural-width buttons, Cancel first.
   Exported so the few overlays that don't use AppModal can match it. */
export const ModalFooter = ({ children, className = "" }) => {
  // A footer with one button has nothing to cancel — that button IS the confirm,
  // so it renders blue rather than as a grey secondary. A conditionally-rendered
  // second button that disappears must correctly leave an array of one. A lone
  // destructive action stays red.
  // Children.toArray preserves fragments as opaque elements. Unwrap them before
  // counting actions; cloning a fragment with `variant` is invalid React usage.
  const flatten = (nodes) => Children.toArray(nodes).flatMap((child) =>
    isValidElement(child) && child.type === Fragment
      ? flatten(child.props.children)
      : [child],
  );
  const items = flatten(children);
  const lone = items.length === 1 && isValidElement(items[0]);
  const content =
    lone && items[0].props.variant !== "danger"
      ? cloneElement(items[0], { variant: "primary" })
      : items;

  return (
    <div
      /* shrink-0 keeps the actions pinned while the body scrolls; flex-wrap so
         three or more buttons stack instead of overflowing a narrow panel. */
      className={`modal-footer flex flex-wrap justify-end gap-2.5 px-6 py-4 shrink-0 ${className}`}
      style={{ borderTop: "1px solid #f0f0f0" }}
    >
      {content}
    </div>
  );
};

const AppModal = ({ title, onClose, children, footer, onEnter, wide = false }) => {
  const panelRef   = useRef(null);
  const closingRef = useRef(false);
  const triggerRef = useRef(document.activeElement);
  const titleId    = useId();

  // The keydown listener is on `window`, so with stacked modals (Reset Password
  // under Confirm Reset, a delete confirm over a form) every mounted instance
  // hears the same keypress. React appends later modals after earlier ones, so
  // the last backdrop in the DOM is the topmost modal — only it should react.
  // Without this, one Enter would fire both modals' primary actions.
  // A closing modal keeps its backdrop mounted for the ~150ms exit animation, so
  // it is excluded here — otherwise a quick second keypress would hit the modal
  // on its way out instead of the one being revealed underneath.
  const isTopmost = () => {
    if (closingRef.current) return false;
    const backdrops = Array.from(
      document.querySelectorAll("[data-modal-backdrop]:not(.modal-backdrop-out)"),
    );
    const top = backdrops[backdrops.length - 1];
    return !!top && !!panelRef.current && top.contains(panelRef.current);
  };

  const startClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    panelRef.current?.classList.replace("modal-panel-in", "modal-panel-out");
    panelRef.current?.closest("[data-modal-backdrop]")
      ?.classList.replace("modal-backdrop-in", "modal-backdrop-out");
  };

  // Scroll lock — reference-counted so stacked/overlapping modals don't clobber
  // each other. Only the first open modal locks the body; only the last to close
  // restores it. Prevents the body from being stuck at overflow:hidden when two
  // modals (e.g. a confirmation dialog over a form modal) overlap.
  useEffect(() => {
    const count = Number(document.body.dataset.modalLockCount || "0");
    const appScroller = document.querySelector(".app-main");
    if (count === 0) {
      document.body.dataset.prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      // Layout's main region is its own scroll container. Locking only <body>
      // leaves that scrollbar visible and allows the page to move behind a
      // modal, which is especially noticeable on the account screen.
      if (appScroller instanceof HTMLElement) {
        document.body.dataset.prevAppOverflowY = appScroller.style.overflowY;
        appScroller.style.overflowY = "hidden";
      }
    }
    document.body.dataset.modalLockCount = String(count + 1);

    return () => {
      const next = Number(document.body.dataset.modalLockCount || "1") - 1;
      if (next <= 0) {
        document.body.style.overflow = document.body.dataset.prevOverflow || "";
        if (appScroller instanceof HTMLElement) {
          appScroller.style.overflowY =
            document.body.dataset.prevAppOverflowY || "";
        }
        delete document.body.dataset.modalLockCount;
        delete document.body.dataset.prevOverflow;
        delete document.body.dataset.prevAppOverflowY;
      } else {
        document.body.dataset.modalLockCount = String(next);
      }
    };
  }, []);

  // Focus first element on open; restore on close
  useEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel) return;
    const first = panel.querySelectorAll(FOCUSABLE)[0];
    first?.focus();
    return () => {
      // Only restore focus if the trigger is still in the document. After a
      // modal-driven delete its row — and therefore the button that opened the
      // modal — is gone, and focusing a detached node silently drops focus to
      // <body>, so the next Tab restarts from the top of the page.
      if (trigger && document.contains(trigger)) {
        trigger.focus?.();
      } else {
        // Fall back to the main region so keyboard navigation resumes near where
        // the user was, rather than at the very start of the document.
        const main = document.querySelector("main") || document.body;
        if (main instanceof HTMLElement) {
          const hadTabIndex = main.hasAttribute("tabindex");
          if (!hadTabIndex) main.setAttribute("tabindex", "-1");
          main.focus?.();
          if (!hadTabIndex) main.removeAttribute("tabindex");
        }
      }
    };
  }, []);

  // Escape closes, Enter confirms — topmost modal only, so Escape on a
  // confirmation dialog steps back to the form underneath rather than dismissing
  // the whole stack, and one Enter never fires two modals' primary actions.
  useModalKeys({ onEscape: startClose, onEnter, enabled: isTopmost });

  // Tab traps focus inside the panel
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll(FOCUSABLE));
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      data-modal-backdrop=""
      className="app-modal-backdrop modal-backdrop-in fixed inset-0 flex items-center justify-center px-4 py-6 overflow-y-auto"
      style={{
        zIndex: 1100,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) startClose(); }}
    >
      {/* max-h + column flex so a tall form scrolls INSIDE the body, keeping the
          header and footer in view. Without it the panel grew unbounded and the
          confirm button ended up below the fold on short screens — the user had
          to scroll the backdrop, which carried the header away too.
          dvh, not vh: mobile browser chrome shrinks the visible viewport. */}
      <div
        ref={panelRef}
        className={`app-modal-panel modal-panel-in bg-white rounded-2xl w-full my-auto flex flex-col max-h-[90dvh] ${wide ? "max-w-4xl" : "max-w-lg"}`}
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08)" }}
        onAnimationEnd={(e) => {
          if (closingRef.current && e.target === panelRef.current) onClose();
        }}
      >
        <div
          className="app-modal-header flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: "1px solid #f0f0f0" }}
        >
          <h3
            id={titleId}
            className="text-base font-semibold text-gray-800 tracking-tight"
          >
            {title}
          </h3>
          <button
            onClick={startClose}
            className="modal-close-button flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {/* The only scrolling region; min-h-0 is required or the flex item
            refuses to shrink below its content and overflow never kicks in. */}
        <div className="modal-scroll-body px-6 py-5 overflow-y-auto flex-1 min-h-0">
          {children}
        </div>
        {footer && <ModalFooter>{footer}</ModalFooter>}
      </div>
    </div>
  );
};

export default AppModal;
