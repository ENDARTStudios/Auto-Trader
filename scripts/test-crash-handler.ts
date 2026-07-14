// Verify the crash handler captures an uncaught exception with full stack trace.
// This is a smoke test for src/instrumentation.ts + src/lib/crash-logger.ts.
//
// Run with: npx tsx scripts/test-crash-handler.ts
//
// Expected behavior:
//   - The script registers the crash handlers
//   - Throws an uncaught exception after 500ms
//   - The handler writes a file to logs/crash-uncaughtException-<epoch>.log
//   - The script exits with code 1
//   - The crash log file contains the stack trace
//
// If the script exits 0 or no crash log file appears, the handler is broken.

import { registerCrashHandlers } from "../src/lib/crash-logger";

registerCrashHandlers();

console.log("[test-crash-handler] crash handlers registered");
console.log("[test-crash-handler] throwing uncaught exception in 500ms...");

setTimeout(() => {
  // Deliberately throw outside any try/catch — this becomes an uncaughtException
  throw new Error("DELIBERATE TEST CRASH — verify that crash-logger.ts captures this stack trace");
}, 500);

// Also throw an unhandled rejection 250ms later (won't be reached if uncaughtException exits first)
setTimeout(() => {
  Promise.reject(new Error("DELIBERATE UNHANDLED REJECTION — should also be captured"));
}, 750);
