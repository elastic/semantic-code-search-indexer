// src/utils/otel_provider.ts
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { otelConfig } from '../config';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Import experimental attributes from incubating entry point
const {
  ATTR_DEPLOYMENT_ENVIRONMENT,
  ATTR_HOST_NAME,
  ATTR_HOST_ARCH,
  ATTR_HOST_TYPE,
  ATTR_OS_TYPE,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('@opentelemetry/semantic-conventions/incubating');

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
 */
function parseHeaders(headersString: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!headersString) return headers;

  headersString.split(',').forEach(header => {
    const [key, value] = header.split('=');
    if (key && value) {
      headers[key.trim()] = value.trim();
    }
  });
  return headers;
}

/**
 * Gets or creates the singleton OpenTelemetry LoggerProvider instance.
 * 
 * Creates a LoggerProvider configured with:
 * - Resource attributes (service info, host info)
 * - OTLP HTTP exporter for sending logs to a collector
 * - Batch log record processor for efficient transmission
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

  const resourceAttributes: Record<string, string | number> = {
    [ATTR_SERVICE_NAME]: otelConfig.serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production',
    [ATTR_HOST_NAME]: os.hostname(),
    [ATTR_HOST_ARCH]: os.arch(),
    [ATTR_HOST_TYPE]: os.type(),
    [ATTR_OS_TYPE]: os.platform(),
  };

  const resource = new Resource(resourceAttributes);

  const exporter = new OTLPLogExporter({
    url: otelConfig.endpoint.endsWith('/v1/logs') 
      ? otelConfig.endpoint 
      : `${otelConfig.endpoint}/v1/logs`,
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
 * - Resource attributes (service info, host info)
 * - OTLP HTTP exporter for sending metrics to a collector
 * - Periodic metric reader for scheduled metric export
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

  const resourceAttributes: Record<string, string | number> = {
    [ATTR_SERVICE_NAME]: otelConfig.serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'production',
    [ATTR_HOST_NAME]: os.hostname(),
    [ATTR_HOST_ARCH]: os.arch(),
    [ATTR_HOST_TYPE]: os.type(),
    [ATTR_OS_TYPE]: os.platform(),
  };

  const resource = new Resource(resourceAttributes);

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
