export const PET_WIDTH = 200;
export const PET_HEIGHT = 242;
export const PET_SCALE_MIN = 75;
export const PET_SCALE_MAX = 150;
export const PET_SCALE_STEP = 5;

export function normalizePetScale(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  return Math.max(PET_SCALE_MIN, Math.min(PET_SCALE_MAX, Math.round(value / PET_SCALE_STEP) * PET_SCALE_STEP));
}

// Keep the bottom-right corner in place, then fit inside the current display.
export function petLayoutHeight(statusCount = 4, announcement = false) {
  return PET_HEIGHT + (statusCount > 4 ? 40 : 0) + (announcement ? 32 : 0);
}

export function scaledPetBounds(bounds, area, value, layoutHeight = PET_HEIGHT) {
  const scale = normalizePetScale(value) / 100;
  const width = Math.round(PET_WIDTH * scale), height = Math.round(layoutHeight * scale);
  const x = Math.max(area.x, Math.min(bounds.x + bounds.width - width, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(bounds.y + bounds.height - height, area.y + area.height - height));
  return {x, y, width, height};
}
