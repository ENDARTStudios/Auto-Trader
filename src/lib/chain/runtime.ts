// src/lib/chain/runtime.ts
//
// Re-export shim — the runtime factory has moved to src/lib/runtime/runtime.ts
// to keep observability + runtime concerns together (per the operator's M5
// directive: "src/lib/runtime/runtime.ts").
//
// This file preserves backward compatibility for existing imports
// (scripts/test-m5-dry-run.ts, scripts/test-m5-chaos.ts). New code
// should import from "@/lib/runtime/runtime" directly.

export {
  buildRuntime,
  CanaryBroadcaster,
  RegistryMetricsAdapter,
  NoopMetricsRecorder,
  InMemoryMetricsRecorder,
  type Runtime,
  type RuntimeConfig,
  type RuntimeRpcConfig,
  type RuntimeSignerConfig,
  type RuntimeLeaseConfig,
  type RuntimeCanaryConfig,
  type MetricEvent,
  type MetricsRecorder,
} from "../runtime/runtime";
