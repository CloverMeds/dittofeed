import { existsSync, readFileSync } from "node:fs";

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

export const DEFAULT_TEMPORAL_CA_BUNDLE_PATHS = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/cert.pem",
] as const;

export function loadTemporalSystemCaBundle(
  caBundlePaths: readonly string[] = DEFAULT_TEMPORAL_CA_BUNDLE_PATHS,
): Uint8Array {
  const caBundlePath = caBundlePaths.find(existsSync);
  if (!caBundlePath) {
    throw new Error("Unable to locate a system CA bundle for Temporal TLS");
  }
  try {
    return Uint8Array.from(readFileSync(caBundlePath));
  } catch {
    throw new Error("Unable to read the system CA bundle for Temporal TLS");
  }
}

function getTemporalTlsOptions({
  temporalApiKey,
  temporalTls,
  temporalTlsCa,
  temporalTlsCaPath,
}: TemporalConnectionConfig): ConnectionOptions["tls"] {
  const inlineCa = temporalTlsCa?.trim();
  const caPath = temporalTlsCaPath?.trim();
  if (inlineCa) {
    return {
      serverRootCACertificate: new TextEncoder().encode(inlineCa),
    };
  }
  if (temporalTlsCaPath !== undefined && !caPath) {
    throw new Error("TEMPORAL_TLS_CA_PATH must not be blank");
  }
  if (caPath) {
    try {
      return {
        serverRootCACertificate: Uint8Array.from(readFileSync(caPath)),
      };
    } catch {
      throw new Error("Unable to read TEMPORAL_TLS_CA_PATH");
    }
  }
  if (!temporalApiKey && !temporalTls) {
    return undefined;
  }
  return {
    serverRootCACertificate: loadTemporalSystemCaBundle(),
  };
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
