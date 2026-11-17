// All money is stored as integer paise to avoid floating point drift.
function toPaise(value) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function fmt(paise) {
  return ((paise || 0) / 100).toFixed(2);
}

module.exports = { toPaise, fmt };
