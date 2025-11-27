import process from 'process';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import resources from '@opentelemetry/resources';
const { resourceFromAttributes } = resources;
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { trace } from '@opentelemetry/api';

// Enable diagnostic logging for development when OTEL_DEBUG env is set.
if (process.env.OTEL_DEBUG) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

// Guard so tracing can be enabled optionally.
const enabled = process.env.OTEL_ENABLED === '1' || process.env.OTEL_ENABLED === 'true';

let sdk;
let tracer;

if (enabled) {
    const exporterEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
    const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'ai-review-kit' });
    const exporter = new OTLPTraceExporter({ url: exporterEndpoint });

    sdk = new NodeSDK({
        resource,
        traceExporter: exporter,
        instrumentations: [getNodeAutoInstrumentations()],
    });

    // Start the SDK
    sdk.start();
    tracer = trace.getTracer('ai-review-kit');

    // Graceful shutdown
    const shutdown = async () => {
        try {
            await sdk.shutdown();
            // eslint-disable-next-line no-console
            console.log('Tracing shutdown completed.');
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Error during tracing shutdown:', e);
        }
    };
    process.on('beforeExit', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
} else {
    tracer = trace.getTracer('ai-review-kit-disabled');
}

export { tracer, enabled };
