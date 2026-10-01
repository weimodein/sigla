// UploadJobBanner and TrainingJobBanner are both position: fixed to the same
// bottom-right corner and stack in one dock, so they share one footprint. These
// were hand-copied into both files with a "kept in sync" comment.
export const DOCK_CARD_WIDTH = 360;
export const DOCK_CARD_HEIGHT = 92;
// Height of TrainingJobBanner's minimized pill.
export const DOCK_PILL_HEIGHT = 40;
// Above the mobile topbar (900), under the drawer (1040+), modals (1100) and toasts (2100).
export const DOCK_Z_INDEX = 1000;
