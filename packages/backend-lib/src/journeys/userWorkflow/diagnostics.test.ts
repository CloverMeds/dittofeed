import { EventType, JourneyDefinition, JourneyNodeType } from "../../types";
import {
  buildJourneyTriggerDiagnosticMetadata,
  shouldLogJourneyTriggerDiagnostics,
} from "./diagnostics";

describe("journey trigger diagnostics", () => {
  const definition: JourneyDefinition = {
    entryNode: {
      type: JourneyNodeType.EventEntryNode,
      event: "appointment.updated",
      key: "appointmentId",
      child: JourneyNodeType.ExitNode,
    },
    exitNode: {
      type: JourneyNodeType.ExitNode,
    },
    nodes: [],
  };

  it("is disabled by default", () => {
    expect(shouldLogJourneyTriggerDiagnostics({ enabled: false })).toBe(false);
  });

  it("logs only sanitized event and journey trigger metadata", () => {
    const metadata = buildJourneyTriggerDiagnosticMetadata({
      definition,
      event: {
        event: "appointment.updated",
        messageId: "message-1",
        properties: {
          appointmentId: "appt-1",
          email: "patient@example.com",
          phone: "555-1212",
          firstName: "Patient",
          notes: "private body",
        },
        context: {
          traits: {
            email: "patient@example.com",
          },
        },
      },
      eventType: EventType.Track,
      journeyId: "journey-1",
      journeyName: "Appointment reminders",
      journeyStatus: "Running",
      workspaceId: "workspace-1",
    });

    expect(metadata).toEqual({
      entryEvent: "appointment.updated",
      entryKey: "appointmentId",
      entryNodeType: JourneyNodeType.EventEntryNode,
      eventName: "appointment.updated",
      eventNameMatchesEntry: true,
      eventType: EventType.Track,
      journeyId: "journey-1",
      journeyName: "Appointment reminders",
      journeyStatus: "Running",
      workspaceId: "workspace-1",
    });
    expect(JSON.stringify(metadata)).not.toContain("patient@example.com");
    expect(JSON.stringify(metadata)).not.toContain("555-1212");
    expect(JSON.stringify(metadata)).not.toContain("private body");
  });
});
