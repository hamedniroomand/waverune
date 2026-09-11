/**
 * Mark the frames that hold enough energy to carry a watermark.
 *
 * A frame is active when its magnitude sum exceeds `fraction` of the loudest
 * frame. The gate is relative, so quiet audio keeps active frames and only
 * silence or near-silence is gated out.
 *
 * @returns one flag per frame, 1 for active and 0 for gated.
 */
export function frameGate(magnitude: Float64Array[], fraction = 0.05): Uint8Array {
  const totals = new Float64Array(magnitude.length);
  let maxTotal = 0;
  for (let i = 0; i < magnitude.length; i++) {
    const frame = magnitude[i];
    let sum = 0;
    for (let k = 0; k < frame.length; k++) sum += frame[k];
    totals[i] = sum;
    if (sum > maxTotal) maxTotal = sum;
  }

  const gate = new Uint8Array(magnitude.length);
  const cutoff = fraction * maxTotal;
  for (let i = 0; i < totals.length; i++) {
    gate[i] = totals[i] > cutoff ? 1 : 0;
  }
  return gate;
}
