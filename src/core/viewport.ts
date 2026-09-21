/** Short side of the design space. The long side grows to match the viewport. */
export const DESIGN_SHORT_SIDE = 720;

export function layoutLogicalSize(cssWidth: number, cssHeight: number): { width: number; height: number } {
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  const aspect = Math.max(0.45, Math.min(2.4, width / height));
  if (aspect >= 1) {
    return { width: Math.round(DESIGN_SHORT_SIDE * aspect), height: DESIGN_SHORT_SIDE };
  }
  return { width: DESIGN_SHORT_SIDE, height: Math.round(DESIGN_SHORT_SIDE / aspect) };
}

export function viewSize(node: HTMLElement | null): { width: number; height: number } {
  const width = node && node.clientWidth > 0 ? node.clientWidth : window.innerWidth;
  const height = node && node.clientHeight > 0 ? node.clientHeight : window.innerHeight;
  return { width, height };
}
