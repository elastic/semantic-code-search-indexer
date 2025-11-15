// src/utils/otel_provider.ts
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { otelConfig } from '../config';
import path from 'path';
import fs from 'fs';

// Import experimental attributes from incubating entry point
const {
  ATTR_DEPLOYMENT_ENVIRONMENT,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('@opentelemetry/semantic-conventions/incubating');

// Enable OpenTelemetry diagnostic logging
// Set to DiagLogLevel.DEBUG for maximum verbosity, or DiagLogLevel.INFO for less detail
const diagLevel =
  process.env.OTEL_LOG_LEVEL === 'debug'
    ? DiagLogLevel.DEBUG
    : process.env.OTEL_LOG_LEVEL === 'info'
      ? DiagLogLevel.INFO
      : process.env.OTEL_LOG_LEVEL === 'warn'
        ? DiagLogLevel.WARN
        : process.env.OTEL_LOG_LEVEL === 'error'
          ? DiagLogLevel.ERROR
          : DiagLogLevel.NONE;

if (diagLevel !== DiagLogLevel.NONE) {
  diag.setLogger(new DiagConsoleLogger(), diagLevel);
}

let loggerProvider: LoggerProvider | null = null;
let meterProvider: MeterProvider | null = null;

/**
 * Retrieves the service version from package.json.
 *
 * @returns The version string from package.json, or '1.0.0' as a fallback.
 */
function getServiceVersion(): string {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || '1.0.0';
    }
  } catch (error) {
    console.error('Could not get service version', error);
  }
  return '1.0.0';
}

/**
 * Parses a comma-separated string of key=value pairs into a headers object.
 *
 * @param headersString - A comma-separated string of headers in the format "key1=value1,key2=value2".
 * @returns An object mapping header names to their values.
 *
 * @example
 * parseHeaders("authorization=Bearer token,content-type=application/json")
 * // Returns: { authorization: "Bearer token", "content-type": "application/json" }
 *
 * @example
 * parseHeaders("Authorization=ApiKey dGVzdDp0ZXN0==")
 * // Returns: { Authorization: "ApiKey dGVzdDp0ZXN0==" }
 */
export function parseHeaders(headersString: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headersString) return headers;

  headersString.split(',').forEach((header) => {
    // Split only on the first '=' to handle values containing '='
    const firstEqualIndex = header.indexOf('=');
    if (firstEqualIndex === -1) return;

    const key = header.substring(0, firstEqualIndex).trim();
    const value = header.substring(firstEqualIndex + 1).trim();

    if (key && value) {
      headers[key] = value;
    }
  });
  return headers;
}

/**
 * Parses OTEL_RESOURCE_ATTRIBUTES environment variable into a key-value object.
 *
 * @param resourceAttributesString - The OTEL_RESOURCE_ATTRIBUTES string
 * @returns An object with parsed resource attributes
 *
 * @example
 * parseResourceAttributes("key1=value1,key2=value2")
 * // Returns: { key1: "value1", key2: "value2" }
 */
function parseResourceAttributes(resourceAttributesString: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!resourceAttributesString) return attributes;

  resourceAttributesString.split(',').forEach((pair) => {
    const firstEqualIndex = pair.indexOf('=');
    if (firstEqualIndex === -1) return;

    const key = pair.substring(0, firstEqualIndex).trim();
    const value = pair.substring(firstEqualIndex + 1).trim();

    if (key && value) {
      attributes[key] = value;
    }
  });
  return attributes;
}

/**
 * Creates a Resource with auto-detected attributes and custom defaults.
 *
 * Detects resource attributes from:
 * - Environment variables (OTEL_RESOURCE_ATTRIBUTES, OTEL_SERVICE_NAME)
 * - SDK defaults (telemetry.sdk.*, service.name, etc.)
 *
 * Custom attributes are used as defaults and are overridden by env vars.
 *
 * @param defaultAttributes - Default resource attributes (overridden by env vars)
 * @returns A Resource instance with all detected and custom attributes
 */
function createResource(defaultAttributes: Record<string, string | number> = {}): Resource {
  // Start with default attributes
  let resource = new Resource(defaultAttributes);

  // Merge with SDK defaults (telemetry.sdk.*, service.name, etc.)
  resource = resource.merge(Resource.default());

  // Parse and merge OTEL_RESOURCE_ATTRIBUTES if present
  const otelResourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES;
  if (otelResourceAttributes) {
    const envAttributes = parseResourceAttributes(otelResourceAttributes);
    resource = resource.merge(new Resource(envAttributes));
  }

  return resource;
}

/**
 * Gets or creates the singleton OpenTelemetry LoggerProvider instance.
 *
 * Creates a LoggerProvider configured with:
 * - Resource attributes (auto-detected + custom service info)
 * - OTLP HTTP exporter for sending logs to a collector
 * - Batch log record processor for efficient transmission
 *
 * Respects standard OTEL environment variables:
 * - OTEL_RESOURCE_ATTRIBUTES: Additional resource attributes
 * - OTEL_SERVICE_NAME: Service name (can be overridden by config)
 *
 * @returns The LoggerProvider instance if OTEL_LOGGING_ENABLED is true, otherwise null.
 */
export function getLoggerProvider(): LoggerProvider | null {
  if (!otelConfig.enabled) {
    return null;
  }

  if (loggerProvider) {
    return loggerProvider;
  }

  const serviceVersion = getServiceVersion();

  const defaultAttributes: Record<string, string | number> = {
    [ATTR_SERVICE_NAME]: otelConfig.serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  };

  // Only set deployment.environment if not in OTEL_RESOURCE_ATTRIBUTES
  if (!process.env.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment')) {
    defaultAttributes[ATTR_DEPLOYMENT_ENVIRONMENT] = process.env.NODE_ENV || 'production';
  }

  const resource = createResource(defaultAttributes);

  const exporter = new OTLPLogExporter({
    url: otelConfig.endpoint.endsWith('/v1/logs') ? otelConfig.endpoint : `${otelConfig.endpoint}/v1/logs`,
    headers: parseHeaders(otelConfig.headers),
  });

  loggerProvider = new LoggerProvider({
    resource,
  });

  loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(exporter));

  return loggerProvider;
}

/**
 * Gets or creates the singleton OpenTelemetry MeterProvider instance.
 *
 * Creates a MeterProvider configured with:
 * - Resource attributes (auto-detected + custom service info)
 * - OTLP HTTP exporter for sending metrics to a collector
 * - Periodic metric reader for scheduled metric export
 *
 * Respects standard OTEL environment variables:
 * - OTEL_RESOURCE_ATTRIBUTES: Additional resource attributes
 * - OTEL_SERVICE_NAME: Service name (can be overridden by config)
 *
 * @returns The MeterProvider instance if OTEL_METRICS_ENABLED is true, otherwise null.
 */
export function getMeterProvider(): MeterProvider | null {
  if (!otelConfig.metricsEnabled) {
    return null;
  }

  if (meterProvider) {
    return meterProvider;
  }

  const serviceVersion = getServiceVersion();

  const defaultAttributes: Record<string, string | number> = {
    [ATTR_SERVICE_NAME]: otelConfig.serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  };

  // Only set deployment.environment if not in OTEL_RESOURCE_ATTRIBUTES
  if (!process.env.OTEL_RESOURCE_ATTRIBUTES?.includes('deployment.environment')) {
    defaultAttributes[ATTR_DEPLOYMENT_ENVIRONMENT] = process.env.NODE_ENV || 'production';
  }

  const resource = createResource(defaultAttributes);

  const exporter = new OTLPMetricExporter({
    url: otelConfig.metricsEndpoint.endsWith('/v1/metrics')
      ? otelConfig.metricsEndpoint
      : `${otelConfig.metricsEndpoint}/v1/metrics`,
    headers: parseHeaders(otelConfig.headers),
    // Configure Delta temporality for Elasticsearch compatibility
    // Elasticsearch exporter only supports Delta temporality for histograms
    temporalityPreference: AggregationTemporality.DELTA,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: otelConfig.metricExportIntervalMs,
  });

  meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });

  return meterProvider;
}

/**
 * Gracefully shuts down the OpenTelemetry LoggerProvider and MeterProvider.
 *
 * Ensures all buffered log records and metrics are flushed to the collector before the application exits.
 * Should be called during application shutdown (e.g., on SIGTERM/SIGINT).
 *
 * @returns A promise that resolves when shutdown is complete.
 */
export async function shutdown(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (loggerProvider) {
    promises.push(loggerProvider.shutdown());
    loggerProvider = null;
  }

  if (meterProvider) {
    promises.push(meterProvider.shutdown());
    meterProvider = null;
  }

  await Promise.all(promises);
}
