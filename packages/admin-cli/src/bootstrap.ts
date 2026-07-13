import {
  bootstrapWithDefaults,
  BootstrapWithoutDefaultsParams,
  getBootstrapDefaultParams,
} from "backend-lib/src/bootstrap";
import logger from "backend-lib/src/logger";
import { managedBootstrap } from "backend-lib/src/managedBootstrap";
import { Argv } from "yargs";

export const BOOTSTRAP_OPTIONS = {
  "workspace-name": {
    type: "string",
    alias: "n",
    describe: "The workspace name to bootstrap.",
  },
  "workspace-domain": {
    type: "string",
    alias: "d",
    describe:
      "The email domain to authorize. All users with the provided email domain will be able to access the workspace. Example: -d=example.com",
  },
  "workspace-type": {
    type: "string",
    alias: "t",
    describe: "The type of workspace to create.",
    choices: ["Root", "Parent"],
    default: "Root",
  },
  features: {
    type: "string",
    alias: "f",
    describe:
      "The features to enable for the workspace. Formatted as a json string which should be an array of feature objects.",
  },
} as const;

export function boostrapOptions<T>(cmd: Argv<T>) {
  return cmd.options(BOOTSTRAP_OPTIONS);
}

const MANAGED_BOOTSTRAP_OPTIONS = {
  "workspace-name": BOOTSTRAP_OPTIONS["workspace-name"],
  "workspace-domain": BOOTSTRAP_OPTIONS["workspace-domain"],
} as const;

export function managedBootstrapOptions<T>(cmd: Argv<T>) {
  return cmd.options(MANAGED_BOOTSTRAP_OPTIONS);
}

export const bootstrapHandler = bootstrapWithDefaults;

export async function managedBootstrapHandler(
  params: BootstrapWithoutDefaultsParams,
) {
  const result = await managedBootstrap(getBootstrapDefaultParams(params));
  logger().info(result, "Managed bootstrap completed successfully.");
}
