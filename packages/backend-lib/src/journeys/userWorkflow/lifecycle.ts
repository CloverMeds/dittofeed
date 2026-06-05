import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import { JourneyNodeType, MakeRequired } from "isomorphic-lib/src/types";

import config from "../../config";
import { jsonValue } from "../../jsonPath";
import logger from "../../logger";
import connectWorkflowClient from "../../temporal/connectWorkflowClient";
import {
  getKeyedUserJourneyWorkflowId,
  trackSignal,
  TrackSignalParams,
  TrackSignalParamsVersion,
  userJourneyWorkflow,
  UserJourneyWorkflowPropsV2,
  UserJourneyWorkflowVersion,
} from "../userWorkflow";
import {
  buildJourneyTriggerDiagnosticMetadata,
  shouldLogJourneyTriggerDiagnostics,
} from "./diagnostics";

export type StartKeyedUserJourneyProps = Omit<
  MakeRequired<UserJourneyWorkflowPropsV2, "event">,
  "version"
> & {
  eventNameMatchesEntry?: boolean;
  eventType?: string;
  journeyName?: string;
  journeyStatus?: string;
};

export async function startKeyedUserJourney({
  journeyId,
  workspaceId,
  userId,
  definition,
  event,
  eventNameMatchesEntry,
  eventType,
  journeyName,
  journeyStatus,
}: StartKeyedUserJourneyProps) {
  const workflowClient = await connectWorkflowClient();
  if (definition.entryNode.type !== JourneyNodeType.EventEntryNode) {
    throw new Error("Invalid entry node type");
  }
  const workflowId = getKeyedUserJourneyWorkflowId({
    workspaceId,
    userId,
    journeyId,
    event,
    entryNode: definition.entryNode,
  });
  const diagnosticsEnabled = shouldLogJourneyTriggerDiagnostics({
    enabled: config().journeyTriggerDiagnostics,
  });
  const diagnosticMetadata = diagnosticsEnabled
    ? buildJourneyTriggerDiagnosticMetadata({
        definition,
        event,
        eventType: eventType ?? "track",
        eventNameMatchesEntry,
        journeyId,
        journeyName,
        journeyStatus,
        workspaceId,
      })
    : null;

  if (diagnosticMetadata) {
    logger().info(
      diagnosticMetadata,
      "Journey trigger diagnostics: evaluated event entry journey",
    );
  }

  if (!workflowId) {
    logger().debug(
      diagnosticMetadata ?? { workspaceId, journeyId },
      "unable to generate keyed user journey workflow id",
    );
    return;
  }

  try {
    const eventKeyName = definition.entryNode.key;
    const eventKey: string | undefined = eventKeyName
      ? jsonValue({
          data: event.properties,
          path: eventKeyName,
        })
          .map((v) => {
            if (typeof v === "string" || typeof v === "number") {
              return v.toString();
            }
            return undefined;
          })
          .unwrapOr(undefined)
      : undefined;

    await workflowClient.signalWithStart<
      typeof userJourneyWorkflow,
      [TrackSignalParams]
    >(userJourneyWorkflow, {
      taskQueue: "default",
      workflowId,
      signal: trackSignal,
      signalArgs: [
        {
          version: TrackSignalParamsVersion.V2,
          messageId: event.messageId,
        },
      ],
      args: [
        {
          journeyId,
          definition,
          workspaceId,
          userId,
          eventKey,
          hidden: event.context?.hidden === true,
          messageId: event.messageId,
          version: UserJourneyWorkflowVersion.V3,
        },
      ],
    });
    if (diagnosticMetadata) {
      logger().info(
        { ...diagnosticMetadata, workflowId },
        "Journey trigger diagnostics: signalWithStart succeeded",
      );
    }
  } catch (e) {
    if (e instanceof WorkflowExecutionAlreadyStartedError) {
      logger().info("User journey already started.", {
        workflowId,
        journeyId,
        userId,
        workspaceId,
        eventKey: definition.entryNode.key,
      });
      return;
    }
    if (diagnosticMetadata) {
      logger().error(
        {
          ...diagnosticMetadata,
          err: e,
          workflowId,
        },
        "Journey trigger diagnostics: signalWithStart failed",
      );
    }
    throw e;
  }
}
