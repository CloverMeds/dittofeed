import { readFileSync } from "node:fs";

import { ConnectionOptions } from "@temporalio/client";
import { NativeConnectionOptions } from "@temporalio/worker";

interface TemporalConnectionConfig {
  temporalAddress: string;
  temporalApiKey?: string;
  temporalConnectionTimeout?: number;
  temporalNamespace: string;
  temporalTls?: boolean;
  temporalTlsCa?: string;
  temporalTlsCaPath?: string;
}

interface TemporalCommonConnectionOptions {
  address: string;
  apiKey?: string;
  metadata?: ConnectionOptions["metadata"];
  tls?: ConnectionOptions["tls"];
}

function getTemporalTlsOptions({
  temporalApiKey,
  temporalTls,
  temporalTlsCa,
  temporalTlsCaPath,
}: TemporalConnectionConfig): ConnectionOptions["tls"] {
  const inlineCa = temporalTlsCa?.trim();
  const caPath = temporalTlsCaPath?.trim();
  if (temporalTlsCaPath !== undefined && !caPath) {
    throw new Error("TEMPORAL_TLS_CA_PATH must not be blank");
  }
  if (inlineCa && caPath) {
    throw new Error(
      "Configure only one of TEMPORAL_TLS_CA and TEMPORAL_TLS_CA_PATH",
    );
  }

  const customCaConfigured = Boolean(inlineCa) || Boolean(caPath);
  if (!temporalApiKey && !temporalTls && !customCaConfigured) {
    return undefined;
  }

  let serverRootCACertificate: Uint8Array | undefined;
  if (inlineCa) {
    serverRootCACertificate = new TextEncoder().encode(inlineCa);
  } else if (caPath) {
    try {
      serverRootCACertificate = Uint8Array.from(readFileSync(caPath));
    } catch {
      throw new Error("Unable to read TEMPORAL_TLS_CA_PATH");
    }
  }
  return serverRootCACertificate ? { serverRootCACertificate } : true;
}

function getTemporalCommonConnectionOptions(
  connectionConfig: TemporalConnectionConfig,
): TemporalCommonConnectionOptions {
  const { temporalAddress, temporalApiKey, temporalNamespace } =
    connectionConfig;
  const options: TemporalCommonConnectionOptions = {
    address: temporalAddress,
  };

  if (temporalApiKey) {
    options.apiKey = temporalApiKey;
  }
  if (temporalNamespace !== "default") {
    options.metadata = {
      "temporal-namespace": temporalNamespace,
    };
  }
  const tls = getTemporalTlsOptions(connectionConfig);
  if (tls !== undefined) {
    options.tls = tls;
  }

  return options;
}

export function getTemporalConnectionOptions(
  connectionConfig: TemporalConnectionConfig,
): ConnectionOptions {
  const options: ConnectionOptions =
    getTemporalCommonConnectionOptions(connectionConfig);
  if (connectionConfig.temporalConnectionTimeout !== undefined) {
    options.connectTimeout = connectionConfig.temporalConnectionTimeout;
  }
  return options;
}

export function getTemporalNativeConnectionOptions(
  connectionConfig: TemporalConnectionConfig,
): NativeConnectionOptions {
  return getTemporalCommonConnectionOptions(connectionConfig);
}
