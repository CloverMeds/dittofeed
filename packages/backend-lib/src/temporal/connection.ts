import { Connection } from "@temporalio/client";

import config from "../config";
import { getTemporalConnectionOptions } from "./connectionOptions";

let CONNECTION: Connection | null = null;

export default async function connect(): Promise<Connection> {
  if (!CONNECTION) {
    const connection = await Connection.connect(
      getTemporalConnectionOptions(config()),
    );
    CONNECTION = connection;
  }
  return CONNECTION;
}
