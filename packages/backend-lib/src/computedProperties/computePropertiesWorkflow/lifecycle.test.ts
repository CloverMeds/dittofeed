import { WorkflowClient } from "@temporalio/client";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";

import {
  startComputePropertiesWorkflow,
  startComputePropertiesWorkflowGlobal,
  startGlobalCron,
} from "./lifecycle";

describe("compute properties workflow lifecycle", () => {
  it("reuses already-running workspace compute and global cron workflows", async () => {
    const alreadyRunning = new WorkflowExecutionAlreadyStartedError(
      "already running",
      "workflow-1",
      "workflow-type",
    );
    const client = new WorkflowClient();
    jest.spyOn(client, "start").mockRejectedValue(alreadyRunning);

    await expect(
      startComputePropertiesWorkflow({ client, workspaceId: "workspace-1" }),
    ).resolves.toBeUndefined();
    await expect(startGlobalCron({ client })).resolves.toBeUndefined();
  });

  it("reuses both already-running global compute workflows", async () => {
    const alreadyRunning = new WorkflowExecutionAlreadyStartedError(
      "already running",
      "workflow-1",
      "workflow-type",
    );
    const client = new WorkflowClient();
    const start = jest.spyOn(client, "start").mockRejectedValue(alreadyRunning);

    await expect(
      startComputePropertiesWorkflowGlobal({ client }),
    ).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("rejects when a workspace compute workflow cannot be started", async () => {
    const failure = new Error("start failed");
    const client = new WorkflowClient();
    jest.spyOn(client, "start").mockRejectedValue(failure);

    await expect(
      startComputePropertiesWorkflow({ client, workspaceId: "workspace-1" }),
    ).rejects.toBe(failure);
  });

  it("rejects when the global cron workflow cannot be started", async () => {
    const failure = new Error("start failed");
    const client = new WorkflowClient();
    jest.spyOn(client, "start").mockRejectedValue(failure);

    await expect(startGlobalCron({ client })).rejects.toBe(failure);
  });
});
