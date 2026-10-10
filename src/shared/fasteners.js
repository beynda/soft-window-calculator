export function fastenerCounts(fasteners) {
  const elementCount = Number.isInteger(fasteners?.total) && fasteners.total >= 0 ? fasteners.total : 0;
  const positions = Array.isArray(fasteners?.positions) ? fasteners.positions : [];
  if (positions.length === 0) return { positionCount: elementCount, elementCount };

  const unique = new Set(positions.map(({ x, y }) => `${Number(x)}:${Number(y)}`));
  return { positionCount: unique.size, elementCount };
}

export function fastenerCountText(fasteners) {
  const { positionCount, elementCount } = fastenerCounts(fasteners);
  if (getPresentation().language === 'ru') {
    if (positionCount === elementCount) return `${elementCount} ${pluralRussian(elementCount, 'крепление', 'крепления', 'креплений')}`;
    return `${positionCount} ${pluralRussian(positionCount, 'точка', 'точки', 'точек')} · ${elementCount} ${pluralRussian(elementCount, 'элемент', 'элемента', 'элементов')}`;
  }
  if (positionCount === elementCount) return `${elementCount} ${plural(elementCount, 'fastener', 'fasteners', 'fasteners')}`;
  return `${positionCount} ${plural(positionCount, 'position', 'positions', 'positions')} · ${elementCount} ${plural(elementCount, 'element', 'elements', 'elements')}`;
}

function pluralRussian(value, one, few, many) {
  const count = Math.abs(Number(value));
  if (count % 100 >= 11 && count % 100 <= 14) return many;
  if (count % 10 === 1) return one;
  return count % 10 >= 2 && count % 10 <= 4 ? few : many;
}

function plural(value, one, few, many) {
  return Math.abs(Number(value)) === 1 ? one : many;
}
import { getPresentation } from './presentation.js';

