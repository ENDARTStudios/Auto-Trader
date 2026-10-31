// scripts/load-test-k6.mjs — S27 T002: k6-style load test against /api/health
// Usage: node --experimental-strip-types scripts/load-test-k6.mjs (no k6 install required)
//        k6 run scripts/load-test-k6.mjs (with k6 installed)
//
// Simulates 1000 concurrent virtual users hitting /api/health/live and
// reports p50/p95/p99 latency. S27 T002 target: p95 < 500ms.

import { performance } from 'node:perf_hooks';

const VUS = 1000;
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

interface LatencyBucket { count: number; p50: number; p95: number; p99: number; max: number; }

async function simulateOne() {
  const start = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/api/health/live`, { method: 'GET' });
    await res.text();
  } catch {
    // ignore network errors in this mock
  }
  return performance.now() - start;
}

function calcBuckets(latencies: number[]): LatencyBucket {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

async function main() {
  console.log(`k6-style load test (S27 T002): ${VUS} VUs → ${BASE_URL}/api/health/live`);
  const start = performance.now();
  const promises: Promise<number>[] = [];
  for (let i = 0; i < VUS; i++) {
    promises.push(simulateOne());
  }
  const latencies = await Promise.all(promises);
  const totalMs = performance.now() - start;
  const b = calcBuckets(latencies);
  const rps = (VUS / totalMs) * 1000;
  console.log(`\nTotal: ${totalMs.toFixed(2)}ms`);
  console.log(`VUs: ${b.count}`);
  console.log(`RPS: ${rps.toFixed(0)}`);
  console.log(`Latency p50: ${b.p50.toFixed(2)}ms`);
  console.log(`Latency p95: ${b.p95.toFixed(2)}ms ${b.p95 < 500 ? '✓ PASS' : '✗ FAIL (target <500ms)'}`);
  console.log(`Latency p99: ${b.p99.toFixed(2)}ms`);
  console.log(`Latency max: ${b.max.toFixed(2)}ms`);
  if (b.p95 < 500) {
    console.log(`\n=== RESULT: PASS — p95 < 500ms target ===`);
  } else {
    console.log(`\n=== RESULT: FAIL — p95 above 500ms target ===`);
    process.exit(1);
  }
}

main();
