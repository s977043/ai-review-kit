---
id: tracing
title: Tracing / Observability
---

このドキュメントでは、River Reviewer に簡易なトレースを導入し、ローカル環境や CI で実行する手順を説明する。

## 概要

- このリポジトリでは OpenTelemetry を使用し、トレースは `src/tracing.mjs` で初期化される。
- トレースは任意で有効化でき、デフォルトでは無効になっている（`OTEL_ENABLED` 環境変数で制御）。

## 有効化手順（ローカル）

1. OTLPエクスポーターの受け口（例: Jaeger/OTLPCollector）をローカルで起動する。
   - 例: `docker run --rm -p 4318:4318 -p 4317:4317 otel/opentelemetry-collector-contrib`（簡易の例）
2. `OTEL_ENABLED=1`と`OTEL_EXPORTER_OTLP_ENDPOINT`を設定してスクリプトを実行する。

```bash
OTEL_ENABLED=1 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node scripts/validate-agents.mjs
```

- 既定のサービス名は `river-reviewer`。`OTEL_SERVICE_NAME` 環境変数で上書きできる。

## 実装のポイント

- `src/tracing.mjs`は`OTEL_ENABLED`をオプトイン方式で使い、環境変数が有効な場合にのみSDKを起動する。
- `scripts/validate-agents.mjs` は主要な処理（スキーマロード、ファイル一覧、各ファイル検証）にスパンを作成するようにインストルメンテーションされている。

## CI での利用（例）

- CI上でトレースを収集する場合、OTLPエンドポイントを外部のAPM（Datadog/Tempo/Jaeger）に向けるか、CIワークフロー内でローカルのCollectorを起動して収集する。
- CIの例（GitHub Actions）:

```yaml
- name: Start otel collector
  run: docker run --rm -d -p 4318:4318 -p 4317:4317 otel/opentelemetry-collector-contrib

- name: Run validation with tracing enabled
  run: OTEL_ENABLED=1 OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 node scripts/validate-agents.mjs
```

## 注意点

- トレースはデバッグやプロファイリングのための情報であり、機密情報（APIキー、個人情報など）は通常スパン属性に含めないこと。
- 本実装は簡易的な導入の例を示している。必要に応じてメトリクスやロギングの統合、サンプリング設定、出口のexporterを調整すること。
