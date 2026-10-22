// мелочи, нужные всем: ограничение, логарифмические шкалы, элемент по id
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerpLog = (lo, hi, t) => lo * (hi / lo) ** t;
export const invLog = (lo, hi, v) => Math.log(v / lo) / Math.log(hi / lo);
export const $ = (id) => document.getElementById(id);
