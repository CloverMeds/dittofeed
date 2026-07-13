import { NativeConnection } from "@temporalio/worker";

import config from "../config";
import { getTemporalNativeConnectionOptions } from "./connectionOptions";

export default async function createConnection() {
  const connection = await NativeConnection.connect(
    getTemporalNativeConnectionOptions(config()),
  );
  return connection;
}
