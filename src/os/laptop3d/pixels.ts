export interface PixelRatioInput {
  dpr: number;
  width: number;
  height: number;
  maxDim: number;
  maxPixels?: number;
  cap?: number;
  min?: number;
}

/** Drawing-buffer pixel ratio follows devicePixelRatio, capped for performance and GPU limits. */
export function renderPixelRatio(i: PixelRatioInput): number {
  const cap = i.cap ?? 2;
  const min = i.min ?? 0.25;
  const maxPixels = i.maxPixels ?? 4096 * 4096;
  const width = i.width > 0 ? i.width : 1;
  const height = i.height > 0 ? i.height : 1;
  const dpr = Number.isFinite(i.dpr) && i.dpr > 0 ? i.dpr : 1;
  let ratio = Math.min(Math.max(dpr, min), cap);
  ratio = Math.min(ratio, i.maxDim / width, i.maxDim / height, Math.sqrt(maxPixels / (width * height)));
  return ratio;
}
