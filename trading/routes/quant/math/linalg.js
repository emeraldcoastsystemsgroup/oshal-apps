/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Small dense linear algebra for the quant's math core (regressions, portfolios, Kalman filter): rows-of-arrays matrices, products, Gauss-Jordan inverse with partial pivoting and Cholesky. A singular or non-positive-definite input is refused, never regularized silently.
 */
'use strict';
const { fail } = require('./checks');

/** Pivots smaller than this relative to the matrix scale mean the matrix cannot be inverted reliably. */
const SINGULAR = 1e-12;

/**
 * @description A rows-by-cols matrix of zeros.
 * @param {number} rows - Row count.
 * @param {number} cols - Column count.
 * @returns {number[][]} The matrix.
 */
function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

/**
 * @description The n-by-n identity matrix.
 * @param {number} n - Size.
 * @returns {number[][]} The identity.
 */
function identity(n) {
  const m = zeros(n, n);
  for (let i = 0; i < n; i += 1) m[i][i] = 1;
  return m;
}

/**
 * @description The transpose of a matrix.
 * @param {number[][]} a - Matrix.
 * @returns {number[][]} Its transpose.
 */
function transpose(a) {
  return a[0].map((_, j) => a.map((row) => row[j]));
}

/**
 * @description Matrix product a times b.
 * @param {number[][]} a - Left matrix (n x k).
 * @param {number[][]} b - Right matrix (k x m).
 * @returns {number[][]} The product (n x m).
 */
function multiply(a, b) {
  if (a[0].length !== b.length) throw fail('Matrix sizes do not match for a product.');
  const out = zeros(a.length, b[0].length);
  for (let i = 0; i < a.length; i += 1) {
    for (let k = 0; k < b.length; k += 1) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < b[0].length; j += 1) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

/**
 * @description Matrix times vector.
 * @param {number[][]} a - Matrix (n x k).
 * @param {number[]} v - Vector (k).
 * @returns {number[]} The product (n).
 */
function matVec(a, v) {
  if (a[0].length !== v.length) throw fail('Matrix and vector sizes do not match.');
  return a.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}

/**
 * @description Dot product of two vectors.
 * @param {number[]} a - Vector.
 * @param {number[]} b - Vector of the same length.
 * @returns {number} The dot product.
 */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/**
 * @description The inverse of a square matrix by Gauss-Jordan elimination with partial pivoting.
 * @param {number[][]} a - Square matrix.
 * @returns {number[][]} Its inverse.
 */
function inverse(a) {
  const n = a.length;
  if (!n || a.some((row) => row.length !== n)) throw fail('Only a square matrix has an inverse.');
  const scale = Math.max(...a.flat().map(Math.abs)) || 1;
  const m = a.map((row, i) => [...row, ...identity(n)[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) <= SINGULAR * scale) throw fail('The matrix is singular (two inputs move together exactly, or one never moves).');
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col];
    for (let j = 0; j < 2 * n; j += 1) m[col][j] /= p;
    for (let r = 0; r < n; r += 1) {
      if (r === col || m[r][col] === 0) continue;
      const f = m[r][col];
      for (let j = 0; j < 2 * n; j += 1) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row.slice(n));
}

/**
 * @description Solve a x = b for x.
 * @param {number[][]} a - Square matrix.
 * @param {number[]} b - Right-hand side.
 * @returns {number[]} The solution.
 */
function solve(a, b) {
  return matVec(inverse(a), b);
}

/**
 * @description The lower Cholesky factor L with L L' = a, for a symmetric positive-definite matrix.
 * @param {number[][]} a - Symmetric positive-definite matrix.
 * @returns {number[][]} The lower-triangular factor.
 */
function cholesky(a) {
  const n = a.length, l = zeros(n, n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = a[i][j];
      for (let k = 0; k < j; k += 1) s -= l[i][k] * l[j][k];
      if (i === j) {
        if (!(s > 0)) throw fail('The covariance matrix is not positive definite.');
        l[i][i] = Math.sqrt(s);
      } else l[i][j] = s / l[j][j];
    }
  }
  return l;
}

/**
 * @description Element-wise sum of two matrices of the same size.
 * @param {number[][]} a - Matrix.
 * @param {number[][]} b - Matrix.
 * @returns {number[][]} The sum.
 */
function add(a, b) {
  return a.map((row, i) => row.map((x, j) => x + b[i][j]));
}

/**
 * @description A matrix times a number.
 * @param {number[][]} a - Matrix.
 * @param {number} k - Factor.
 * @returns {number[][]} The scaled matrix.
 */
function scale(a, k) {
  return a.map((row) => row.map((x) => x * k));
}

module.exports = { zeros, identity, transpose, multiply, matVec, dot, inverse, solve, cholesky, add, scale };
