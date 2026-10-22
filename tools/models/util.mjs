// общее для тестов моделей: повторяемая случайность (mulberry32) и сравнение с допуском
export const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
