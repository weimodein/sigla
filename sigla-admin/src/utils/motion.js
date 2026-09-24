// Stagger delay for list entrances, as a style object to spread onto the item.
//
//   <tr className="list-item-in" style={listStagger(i)}>
//
// The cap is the important part. Staggering every row of a 50-row table takes
// seconds and reads as the page being slow, not as polish — so only the first
// few items are offset and the rest share the final delay.
const STEP_MS = 24;
const MAX_STEPS = 6;

export const listStagger = (index) => ({
  "--stagger-delay": `${Math.min(index, MAX_STEPS) * STEP_MS}ms`,
});

export default listStagger;
