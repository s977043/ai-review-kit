---
id: tracing
title: Tracing / Observability
---

This document describes steps to introduce simple tracing to River Reviewer and run it in local/CI environments.

## Overview

- This repository uses OpenTelemetry, initialized in `src/tracing.mjs`.
- Tracing can be optionally enabled; disabled by default (Controlled by `OTEL_ENABLED` env var).

## Enable Steps (Local)

1. Start OTLP exporter receiver (e.g., Jaeger/OTLPCollector) locally.
   - Example: `docker run --rm -p 4318:4318 -p 4317:4317 otel/opentelemetry-collector-contrib` (Simple example)
2. Run script with `OTEL_ENABLED=1` and `OTEL_EXPORTER_OTLP_ENDPOINT`.

```bash
OTEL_ENABLED=1 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node scripts/validate-agents.mjs
```

- Default service name is `river-reviewer`. Can be overridden with `OTEL_SERVICE_NAME`.

## Implementation Points

- `src/tracing.mjs` uses `OTEL_ENABLED` as opt-in; SDK starts only when valid.
- `scripts/validate-agents.mjs` is instrumented to create spans for main processes (Schema load, File listing, File validation).

## CI Usage (Example)

- When collecting traces in CI, point OTLP endpoint to external APM (Datadog/Tempo/Jaeger) or start local Collector in CI workflow.
- CI Example (GitHub Actions):

```yaml
- name: Start otel collector
  run: docker run --rm -d -p 4318:4318 -p 4317:4317 otel/opentelemetry-collector-contrib

- name: Run validation with tracing enabled
  run: OTEL_ENABLED=1 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node scripts/validate-agents.mjs
```

## Notes

- Tracing is for debug/profiling. Do not include sensitive info (API keys, PII) in span attributes.
- This implementation shows a simple introduction. Adjust metrics/logging integration, sampling, and exporter as needed.
