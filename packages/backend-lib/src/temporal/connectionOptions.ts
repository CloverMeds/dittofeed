import { ConnectionOptions } from "@temporalio/client";
import { NativeConnectionOptions } from "@temporalio/worker";

import { Config } from "../config";

type TemporalConnectionConfig = Pick<
  Config,
  | "temporalAddress"
  | "temporalApiKey"
  | "temporalConnectionTimeout"
  | "temporalNamespace"
  | "temporalTlsCa"
>;

export function getTemporalConnectionOptions({
  temporalAddress,
  temporalApiKey,
  temporalConnectionTimeout,
  temporalNamespace,
  temporalTlsCa,
}: TemporalConnectionConfig): ConnectionOptions {
  const options: ConnectionOptions = {
    address: temporalAddress,
  };

  if (temporalConnectionTimeout !== undefined) {
    options.connectTimeout = temporalConnectionTimeout;
  }

  if (!temporalApiKey) {
    return options;
  }

  options.apiKey = temporalApiKey;
  options.metadata = {
    "temporal-namespace": temporalNamespace,
  };
  options.tls = temporalTlsCa
    ? {
        serverRootCACertificate: new TextEncoder().encode(temporalTlsCa),
      }
    : true;

  return options;
}

export function getTemporalNativeConnectionOptions({
  temporalAddress,
  temporalApiKey,
  temporalNamespace,
  temporalTlsCa,
}: TemporalConnectionConfig): NativeConnectionOptions {
  const options: NativeConnectionOptions = {
    address: temporalAddress,
  };

  if (!temporalApiKey) {
    return options;
  }

  options.apiKey = temporalApiKey;
  options.metadata = {
    "temporal-namespace": temporalNamespace,
  };
  options.tls = temporalTlsCa
    ? {
        serverRootCACertificate: new TextEncoder().encode(temporalTlsCa),
      }
    : true;

  return options;
}
