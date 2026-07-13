import { LoadingButton } from "@mui/lab";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { CHANNEL_NAMES } from "isomorphic-lib/src/constants";
import {
  DeliveryHoursWeekday,
  validateWorkspaceDeliveryHoursPolicy,
  WorkspaceDeliveryHoursPolicy,
  WorkspaceDeliveryHoursPolicyResource,
} from "isomorphic-lib/src/deliveryHours";
import { ChannelType, CompletionStatus } from "isomorphic-lib/src/types";
import { enqueueSnackbar } from "notistack";
import { useEffect, useMemo, useState } from "react";

import { useAppStorePick } from "../lib/appStore";
import { noticeAnchorOrigin } from "../lib/notices";
import Fields from "./form/Fields";
import { TimezoneAutocomplete } from "./timezoneAutocomplete";

const DELIVERY_HOURS_QUERY_KEY = "deliveryHours";

const WEEKDAY_OPTIONS: {
  label: string;
  name: string;
  value: DeliveryHoursWeekday;
}[] = [
  {
    label: "Mon",
    name: "Monday",
    value: DeliveryHoursWeekday.Monday,
  },
  {
    label: "Tue",
    name: "Tuesday",
    value: DeliveryHoursWeekday.Tuesday,
  },
  {
    label: "Wed",
    name: "Wednesday",
    value: DeliveryHoursWeekday.Wednesday,
  },
  {
    label: "Thu",
    name: "Thursday",
    value: DeliveryHoursWeekday.Thursday,
  },
  {
    label: "Fri",
    name: "Friday",
    value: DeliveryHoursWeekday.Friday,
  },
  {
    label: "Sat",
    name: "Saturday",
    value: DeliveryHoursWeekday.Saturday,
  },
  {
    label: "Sun",
    name: "Sunday",
    value: DeliveryHoursWeekday.Sunday,
  },
];

const UNSUPPORTED_CHANNELS = [
  ChannelType.Email,
  ChannelType.MobilePush,
  ChannelType.Webhook,
] as const;

export type DeliveryHoursDraft = Omit<
  WorkspaceDeliveryHoursPolicy,
  "enabledChannels"
> & {
  enabledChannels: ChannelType[];
};

function toSupportedPolicy(
  draft: DeliveryHoursDraft,
): WorkspaceDeliveryHoursPolicy {
  const enabledChannels: WorkspaceDeliveryHoursPolicy["enabledChannels"] =
    draft.enabledChannels.includes(ChannelType.Sms) ? [ChannelType.Sms] : [];

  return {
    ...draft,
    enabledChannels,
  };
}

export function validateDeliveryHoursDraft(draft: DeliveryHoursDraft) {
  return validateWorkspaceDeliveryHoursPolicy(toSupportedPolicy(draft));
}

export function buildDeliveryHoursPolicyResource(
  workspaceId: string,
  draft: DeliveryHoursDraft,
): WorkspaceDeliveryHoursPolicyResource {
  return {
    workspaceId,
    ...toSupportedPolicy(draft),
  };
}

function draftFromResource(
  resource: WorkspaceDeliveryHoursPolicyResource,
): DeliveryHoursDraft {
  return {
    weekdays: resource.weekdays,
    openingTime: resource.openingTime,
    closingTime: resource.closingTime,
    fallbackTimezone: resource.fallbackTimezone,
    enabledChannels: resource.enabledChannels,
  };
}

function DeliveryHoursSectionHeader({ sectionId }: { sectionId: string }) {
  return (
    <Box id={sectionId}>
      <Typography
        variant="h2"
        fontWeight={300}
        sx={{ fontSize: 20, marginBottom: 0.5 }}
      >
        Patient-local delivery hours
      </Typography>
      <Typography variant="subtitle1" fontWeight="normal" sx={{ opacity: 0.6 }}>
        Hours are evaluated in each patient&apos;s local timezone, using the
        workspace fallback below when needed.
      </Typography>
    </Box>
  );
}

function LoadingDeliveryHours() {
  return (
    <Fields disableChildStyling sections={[]}>
      <Stack alignItems="center" sx={{ py: 4 }}>
        <CircularProgress size={28} aria-label="Loading delivery hours" />
      </Stack>
    </Fields>
  );
}

function DeliveryHoursLoadError({ retry }: { retry: () => void }) {
  return (
    <Fields disableChildStyling sections={[]}>
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={retry}>
            Retry
          </Button>
        }
      >
        Delivery hours could not be loaded. No changes have been made.
      </Alert>
    </Fields>
  );
}

export default function DeliveryHoursSettings({
  sectionId,
}: {
  sectionId: string;
}) {
  const { apiBase, workspace } = useAppStorePick(["apiBase", "workspace"]);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DeliveryHoursDraft | null>(null);

  const workspaceId =
    workspace.type === CompletionStatus.Successful ? workspace.value.id : null;
  const queryKey = [DELIVERY_HOURS_QUERY_KEY, workspaceId] as const;

  const deliveryHoursQuery = useQuery({
    queryKey,
    queryFn: async () => {
      if (!workspaceId) {
        throw new Error("Workspace not available");
      }
      const response = await axios.get<WorkspaceDeliveryHoursPolicyResource>(
        `${apiBase}/api/settings/delivery-hours`,
        {
          params: { workspaceId },
        },
      );
      return response.data;
    },
    enabled: !!workspaceId,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setDraft(
      deliveryHoursQuery.data
        ? draftFromResource(deliveryHoursQuery.data)
        : null,
    );
  }, [deliveryHoursQuery.data, workspaceId]);

  const updateDeliveryHoursMutation = useMutation({
    mutationFn: async (resource: WorkspaceDeliveryHoursPolicyResource) => {
      const response = await axios.put<WorkspaceDeliveryHoursPolicyResource>(
        `${apiBase}/api/settings/delivery-hours`,
        resource,
      );
      return response.data;
    },
    onSuccess: (resource) => {
      queryClient.setQueryData(queryKey, resource);
      setDraft(draftFromResource(resource));
      enqueueSnackbar("Delivery hours updated successfully", {
        variant: "success",
        autoHideDuration: 3000,
        anchorOrigin: noticeAnchorOrigin,
      });
    },
    onError: (error) => {
      enqueueSnackbar(
        `Failed to update delivery hours: ${error instanceof Error ? error.message : "Unknown error"}`,
        {
          variant: "error",
          autoHideDuration: 10000,
          anchorOrigin: noticeAnchorOrigin,
        },
      );
    },
  });

  const validation = useMemo(
    () => (draft ? validateDeliveryHoursDraft(draft) : null),
    [draft],
  );

  const save = () => {
    if (!workspaceId || !draft || !validation?.valid) {
      return;
    }
    updateDeliveryHoursMutation.mutate(
      buildDeliveryHoursPolicyResource(workspaceId, draft),
    );
  };

  let contents: React.ReactNode;
  if (deliveryHoursQuery.isError) {
    contents = (
      <DeliveryHoursLoadError
        retry={() => {
          void deliveryHoursQuery.refetch();
        }}
      />
    );
  } else if (deliveryHoursQuery.isPending || !draft || !validation) {
    contents = <LoadingDeliveryHours />;
  } else {
    contents = (
      <Fields
        sections={[
          {
            id: "delivery-hours-policy-section",
            fieldGroups: [
              {
                id: "delivery-hours-policy-fields",
                name: "Delivery schedule",
                fields: [],
                children: (
                  <Stack spacing={4}>
                    <Box>
                      <Typography variant="body2" fontWeight={500} mb={1}>
                        Delivery days
                      </Typography>
                      <ToggleButtonGroup
                        value={draft.weekdays}
                        onChange={(
                          _event,
                          weekdays: DeliveryHoursWeekday[],
                        ) => {
                          setDraft((current) =>
                            current ? { ...current, weekdays } : current,
                          );
                        }}
                        size="small"
                        aria-label="Delivery days"
                        sx={{ flexWrap: "wrap", maxWidth: "100%" }}
                      >
                        {WEEKDAY_OPTIONS.map((weekday) => (
                          <ToggleButton
                            key={weekday.value}
                            value={weekday.value}
                            aria-label={weekday.name}
                          >
                            {weekday.label}
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                      <FormHelperText error={!!validation.errors.weekdays}>
                        {validation.errors.weekdays ??
                          "Select the days when messages may be delivered."}
                      </FormHelperText>
                    </Box>

                    <Box>
                      <Typography variant="body2" fontWeight={500} mb={1}>
                        Daily delivery window
                      </Typography>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={2}
                      >
                        <TextField
                          label="Opening time"
                          type="time"
                          value={draft.openingTime}
                          onChange={(event) => {
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    openingTime: event.target.value,
                                  }
                                : current,
                            );
                          }}
                          size="small"
                          InputLabelProps={{ shrink: true }}
                          inputProps={{ step: 60 }}
                          helperText="Inclusive"
                          error={!!validation.errors.interval}
                          sx={{ width: { xs: "100%", sm: 180 } }}
                        />
                        <TextField
                          label="Closing time"
                          type="time"
                          value={draft.closingTime}
                          onChange={(event) => {
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    closingTime: event.target.value,
                                  }
                                : current,
                            );
                          }}
                          size="small"
                          InputLabelProps={{ shrink: true }}
                          inputProps={{ step: 60 }}
                          helperText="Exclusive"
                          error={!!validation.errors.interval}
                          sx={{ width: { xs: "100%", sm: 180 } }}
                        />
                      </Stack>
                      <FormHelperText error={!!validation.errors.interval}>
                        {validation.errors.interval ??
                          "Opening is inclusive and closing is exclusive. One same-day interval applies to every selected day; overnight and multiple windows are not supported."}
                      </FormHelperText>
                    </Box>

                    <Box>
                      <TimezoneAutocomplete
                        value={draft.fallbackTimezone}
                        handler={(fallbackTimezone) => {
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  fallbackTimezone: fallbackTimezone ?? "",
                                }
                              : current,
                          );
                        }}
                        disableClearable
                        allowCustomTimezone
                        required
                        error={!!validation.errors.fallbackTimezone}
                        helperText={
                          validation.errors.fallbackTimezone ??
                          "Used when a patient's timezone is missing or invalid. Select a valid IANA timezone."
                        }
                        label="Fallback timezone"
                        sx={{ maxWidth: 480 }}
                      />
                    </Box>
                  </Stack>
                ),
              },
            ],
          },
          {
            id: "delivery-hours-channels-section",
            title: "Communication channels",
            fieldGroups: [
              {
                id: "delivery-hours-channel-fields",
                name: "Policy opt-in",
                fields: [],
                children: (
                  <Stack>
                    <FormGroup>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={draft.enabledChannels.includes(
                              ChannelType.Sms,
                            )}
                            onChange={(_event, checked) => {
                              setDraft((current) => {
                                if (!current) {
                                  return current;
                                }
                                return {
                                  ...current,
                                  enabledChannels: checked
                                    ? [ChannelType.Sms]
                                    : [],
                                };
                              });
                            }}
                          />
                        }
                        label={CHANNEL_NAMES[ChannelType.Sms]}
                      />
                      {UNSUPPORTED_CHANNELS.map((channel) => (
                        <FormControlLabel
                          key={channel}
                          disabled
                          control={<Switch checked={false} />}
                          label={`${CHANNEL_NAMES[channel]} — Not supported in this release`}
                        />
                      ))}
                    </FormGroup>
                    <FormHelperText error={!!validation.errors.enabledChannels}>
                      {validation.errors.enabledChannels ??
                        "Only SMS can be selected for this saved policy in this release. Saving it does not itself delay messages; other channels are unaffected."}
                    </FormHelperText>
                  </Stack>
                ),
              },
            ],
          },
        ]}
      >
        <LoadingButton
          onClick={save}
          variant="contained"
          loading={updateDeliveryHoursMutation.isPending}
          disabled={!validation.valid}
          sx={{
            alignSelf: {
              xs: "start",
              sm: "end",
            },
          }}
        >
          Save
        </LoadingButton>
      </Fields>
    );
  }

  return (
    <Stack spacing={3}>
      <DeliveryHoursSectionHeader sectionId={sectionId} />
      {contents}
    </Stack>
  );
}
