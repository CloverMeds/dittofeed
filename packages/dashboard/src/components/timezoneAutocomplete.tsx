import {
  Autocomplete,
  SxProps,
  TextField,
  TextFieldProps,
  Theme,
} from "@mui/material";
import { isValidIanaTimezone } from "isomorphic-lib/src/deliveryHours";
import { useEffect, useMemo } from "react";

export type TimezoneChangeHandler = (timezone: string | null) => void;

export function getTimezoneOptions(value?: string): string[] {
  const timezones = Intl.supportedValuesOf("timeZone");
  const options = timezones.includes("UTC") ? timezones : ["UTC", ...timezones];
  if (value && isValidIanaTimezone(value) && !options.includes(value)) {
    return [value, ...options];
  }
  return options;
}

export function TimezoneAutocomplete({
  value,
  disabled,
  handler,
  disableClearable,
  defaultToLocal,
  label,
  required,
  error,
  helperText,
  allowCustomTimezone,
  sx,
}: {
  value?: string;
  disabled?: boolean;
  handler: TimezoneChangeHandler;
  disableClearable?: boolean;
  defaultToLocal?: boolean;
  label?: string;
  required?: boolean;
  error?: boolean;
  helperText?: TextFieldProps["helperText"];
  allowCustomTimezone?: boolean;
  sx?: SxProps<Theme>;
}) {
  const timezones = useMemo(() => getTimezoneOptions(value), [value]);

  const selectedTimezone = useMemo(() => {
    if (allowCustomTimezone) {
      return value ?? null;
    }
    return timezones.find((tz) => tz === value) ?? null;
  }, [allowCustomTimezone, timezones, value]);

  // Default to local timezone if defaultToLocal is true and value is not set
  useEffect(() => {
    if (defaultToLocal && !value) {
      const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timezones.includes(localTimezone)) {
        handler(localTimezone);
      }
    }
    // Omit timezones from dependency array to prevent re-running when timezones load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultToLocal, value, handler]);

  return (
    <Autocomplete
      value={selectedTimezone}
      options={timezones}
      freeSolo={allowCustomTimezone}
      disabled={disabled}
      disableClearable={disableClearable}
      getOptionLabel={(option) => option}
      onChange={(_event, tz: string | null) => {
        handler(tz);
      }}
      onInputChange={
        allowCustomTimezone
          ? (_event, inputValue, reason) => {
              if (reason === "input") {
                handler(inputValue);
              }
            }
          : undefined
      }
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? "Timezone"}
          variant="outlined"
          required={required}
          error={error}
          helperText={helperText}
        />
      )}
    />
  );
}
