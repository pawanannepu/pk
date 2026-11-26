/** The share of the context window at which the CONTEXT gauge turns amber. #25 replaces it with the compaction point. */
export const CONTEXT_WARN_RATIO = 0.8;

/** Every key is ignored for this long after a permission panel opens, so a keystroke meant for the input never approves anything. */
export const PERMISSION_GUARD_MS = 300;

/** The input and the permission panel never take more than this share of the center height. */
export const BOTTOM_PANEL_MAX_RATIO = 0.4;

/** Incoming events are applied in one batch at most this often (one frame at 30 fps). */
export const FLUSH_INTERVAL_MS = 33;

/** How many recent calls the TOKENS sparkline shows. */
export const SPARK_CALLS = 14;

/** The text a denied call's result carries (the loop's wording, #7). Denials stay out of the error count. */
export const DENIED_TEXT = "denied by user";

/** Diffs under a tool line keep at most this many patch lines. Expand is #14. */
export const DIFF_MAX_LINES = 40;

/** The permission panel shows at most this many visual rows of the call's JSON input. */
export const PERMISSION_JSON_ROWS = 6;

/** The hero globe stops turning this long after start. */
export const HERO_RUN_MS = 60_000;

/** Selections longer than this are not sent to the clipboard. */
export const COPY_MAX_CHARS = 100_000;

/** How long `copy sent (N chars)` stays in the footer. */
export const COPY_FLASH_MS = 2_000;

/** Spinner frame interval (10 frames per second). */
export const SPINNER_INTERVAL_MS = 100;

/** The waiting lamp blinks at 1 Hz: it swaps colors this often. */
export const LAMP_BLINK_MS = 1_000;

/** The hero globe turns at 8 frames per second. */
export const GLOBE_FRAME_MS = 125;
