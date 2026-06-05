import {
  EventEntryNode,
  JourneyDefinition,
  JourneyNodeType,
  SegmentEntryNode,
  UserWorkflowTrackEvent,
} from "../../types";

export interface JourneyTriggerDiagnosticInput {
  definition: JourneyDefinition;
  event: UserWorkflowTrackEvent;
  eventType: string;
  eventNameMatchesEntry?: boolean;
  journeyId: string;
  journeyName?: string;
  journeyStatus?: string;
  workspaceId: string;
}

type EntryMetadata =
  | {
      entryEvent: string;
      entryKey?: string;
      entryNodeType: typeof JourneyNodeType.EventEntryNode;
    }
  | {
      entryNodeType: typeof JourneyNodeType.SegmentEntryNode;
      entrySegment: string;
    };

export type JourneyTriggerDiagnosticMetadata = {
  eventName: string;
  eventNameMatchesEntry: boolean;
  eventType: string;
  journeyId: string;
  journeyName?: string;
  journeyStatus?: string;
  workspaceId: string;
} & EntryMetadata;

export function shouldLogJourneyTriggerDiagnostics({
  enabled,
}: {
  enabled: boolean;
}): boolean {
  return enabled;
}

function getEntryMetadata(
  entryNode: EventEntryNode | SegmentEntryNode,
): EntryMetadata {
  if (entryNode.type === JourneyNodeType.EventEntryNode) {
    return {
      entryEvent: entryNode.event,
      entryKey: entryNode.key,
      entryNodeType: entryNode.type,
    };
  }

  return {
    entryNodeType: entryNode.type,
    entrySegment: entryNode.segment,
  };
}

function getEventNameMatchesEntry({
  definition,
  event,
  eventNameMatchesEntry,
}: Pick<
  JourneyTriggerDiagnosticInput,
  "definition" | "event" | "eventNameMatchesEntry"
>): boolean {
  if (eventNameMatchesEntry !== undefined) {
    return eventNameMatchesEntry;
  }

  if (definition.entryNode.type !== JourneyNodeType.EventEntryNode) {
    return false;
  }

  return definition.entryNode.event === event.event;
}

export function buildJourneyTriggerDiagnosticMetadata({
  definition,
  event,
  eventType,
  eventNameMatchesEntry,
  journeyId,
  journeyName,
  journeyStatus,
  workspaceId,
}: JourneyTriggerDiagnosticInput): JourneyTriggerDiagnosticMetadata {
  return {
    ...getEntryMetadata(definition.entryNode),
    eventName: event.event,
    eventNameMatchesEntry: getEventNameMatchesEntry({
      definition,
      event,
      eventNameMatchesEntry,
    }),
    eventType,
    journeyId,
    journeyName,
    journeyStatus,
    workspaceId,
  };
}
