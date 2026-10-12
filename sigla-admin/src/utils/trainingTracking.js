// When the admin stops watching a training run (TrainingJobContext).
//
// The tracker used to give up a fixed 90 minutes after the run's start time as the
// SERVER reported it. That went wrong two ways: when the backend ran in a time zone
// other than UTC (a UTC+8 laptop), the start time came back hours early and a run
// started minutes ago was dropped at once ("Stopped tracking this training run");
// and a healthy words+alphabet run that simply takes longer than 90 minutes was
// dropped too.
//
// The rule now looks at what the run is DOING, not how old it is: give up only when
// it has reported nothing new for STALL_TIMEOUT_MS. A run that keeps moving is
// tracked for as long as it takes; one stranded at "training" (server restarted, so
// nothing will ever settle it) is still released, after 30 quiet minutes.
export const STALL_TIMEOUT_MS = 30 * 60 * 1000;

// Everything one poll learned about a run, as a string that changes whenever the
// run does: a row's status, or a half's stage / epoch / batch / percent.
export function progressSignature(wordsRow, wordsProgress, lettersRow, lettersProgress) {
  const half = (row, p) =>
    [row?.status ?? "", p?.stage ?? "", p?.current_epoch ?? "", p?.current_batch ?? "", p?.progress ?? ""].join("|");
  return `${half(wordsRow, wordsProgress)}#${half(lettersRow, lettersProgress)}`;
}

export function isStalled(now, lastChangeAt, timeoutMs = STALL_TIMEOUT_MS) {
  return now - lastChangeAt > timeoutMs;
}
