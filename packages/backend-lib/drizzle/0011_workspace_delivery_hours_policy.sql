CREATE TABLE "WorkspaceDeliveryHoursPolicy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "WorkspaceDeliveryHoursPolicy" ADD CONSTRAINT "WorkspaceDeliveryHoursPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "WorkspaceDeliveryHoursPolicy_workspaceId_key" ON "WorkspaceDeliveryHoursPolicy" USING btree ("workspaceId" uuid_ops);--> statement-breakpoint
INSERT INTO "WorkspaceDeliveryHoursPolicy" (
	"id",
	"workspaceId",
	"config",
	"createdAt",
	"updatedAt"
)
SELECT
	gen_random_uuid(),
	"id",
	'{"weekdays":[1,2,3,4,5],"openingTime":"08:00","closingTime":"17:00","fallbackTimezone":"America/New_York","enabledChannels":["Sms"]}'::jsonb,
	now(),
	now()
FROM "Workspace"
ON CONFLICT ("workspaceId") DO NOTHING;
