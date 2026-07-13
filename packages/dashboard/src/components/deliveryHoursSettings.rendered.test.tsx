/** @jest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios, { AxiosResponse } from "axios";
import {
  DeliveryHoursWeekday,
  WorkspaceDeliveryHoursPolicyResource,
} from "isomorphic-lib/src/deliveryHours";
import { ChannelType, CompletionStatus } from "isomorphic-lib/src/types";
import { enqueueSnackbar } from "notistack";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";

import { initializeStore, Provider as StoreProvider } from "../lib/appStore";
import DeliveryHoursSettings from "./deliveryHoursSettings";

jest.mock("axios");
jest.mock("notistack", () => ({ enqueueSnackbar: jest.fn() }));

const { AxiosHeaders } = jest.requireActual<typeof import("axios")>("axios");
const mockAxios = jest.mocked(axios);
const mockEnqueueSnackbar = jest.mocked(enqueueSnackbar);

function axiosResponse<T>(data: T): AxiosResponse<T> {
  const headers = AxiosHeaders.from({});
  return {
    data,
    status: 200,
    statusText: "OK",
    headers,
    config: { headers },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function waitForAssertion(
  assertion: () => void,
  remainingAttempts = 50,
): Promise<void> {
  try {
    assertion();
  } catch (error) {
    if (remainingAttempts === 0) {
      throw error;
    }
    await act(
      async () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        }),
    );
    return waitForAssertion(assertion, remainingAttempts - 1);
  }
}

function getInputByLabel(labelText: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll("label")).find((element) =>
    element.textContent?.includes(labelText),
  );
  if (!label?.htmlFor) {
    throw new Error(`Label not found: ${labelText}`);
  }
  const input = document.getElementById(label.htmlFor);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Input not found: ${labelText}`);
  }
  return input;
}

function getSwitchByLabel(labelText: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll("label")).find((element) =>
    element.textContent?.includes(labelText),
  );
  const input = label?.querySelector('input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Switch not found: ${labelText}`);
  }
  return input;
}

function getWeekdayButton(name: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${name}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Weekday button not found: ${name}`);
  }
  return button;
}

function getSaveButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === "Save",
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Save button not found");
  }
  return button;
}

function click(element: HTMLElement) {
  act(() => element.click());
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) {
    throw new Error("HTML input value setter not found");
  }
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("rendered delivery hours settings", () => {
  let root: Root | null = null;
  let queryClient: QueryClient | null = null;

  function renderSettings() {
    const store = initializeStore({
      apiBase: "https://api.example.test",
      workspace: {
        type: CompletionStatus.Successful,
        value: { id: "workspace-1", name: "Test workspace" },
      },
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });
    queryClient = client;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <StoreProvider createStore={() => store}>
          <QueryClientProvider client={client}>
            <DeliveryHoursSettings sectionId="delivery-hours" />
          </QueryClientProvider>
        </StoreProvider>,
      );
    });
    return store;
  }

  function unmountSettings() {
    act(() => root?.unmount());
    queryClient?.clear();
    root = null;
    queryClient = null;
    document.body.replaceChildren();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 0, 100, 20),
    });
  });

  afterEach(() => {
    unmountSettings();
  });

  it("loads and renders the persisted policy with honest channel controls and timezone help", async () => {
    const request =
      deferred<AxiosResponse<WorkspaceDeliveryHoursPolicyResource>>();
    mockAxios.get.mockReturnValue(request.promise);
    const persistedPolicy: WorkspaceDeliveryHoursPolicyResource = {
      workspaceId: "workspace-1",
      weekdays: [DeliveryHoursWeekday.Tuesday, DeliveryHoursWeekday.Thursday],
      openingTime: "10:15",
      closingTime: "16:45",
      fallbackTimezone: "GMT",
      enabledChannels: [ChannelType.Sms],
    };

    renderSettings();

    expect(
      document.querySelector('[aria-label="Loading delivery hours"]'),
    ).not.toBeNull();
    expect(mockAxios.get).toHaveBeenCalledWith(
      "https://api.example.test/api/settings/delivery-hours",
      { params: { workspaceId: "workspace-1" } },
    );

    await act(async () => {
      request.resolve(axiosResponse(persistedPolicy));
      await request.promise;
    });

    await waitForAssertion(() => {
      expect(getInputByLabel("Opening time").value).toBe("10:15");
    });
    expect(getInputByLabel("Closing time").value).toBe("16:45");
    expect(getInputByLabel("Fallback timezone").value).toBe("GMT");
    expect(getWeekdayButton("Tuesday").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(getWeekdayButton("Thursday").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(getWeekdayButton("Monday").getAttribute("aria-pressed")).toBe(
      "false",
    );

    expect(getSwitchByLabel("SMS").checked).toBe(true);
    for (const label of ["Email", "Push Notification", "Webhook"]) {
      const unsupported = getSwitchByLabel(label);
      expect(unsupported.checked).toBe(false);
      expect(unsupported.disabled).toBe(true);
    }

    expect(document.body.textContent).toContain(
      "Hours are evaluated in each patient's local timezone",
    );
    expect(document.body.textContent).toContain(
      "Used when a patient's timezone is missing or invalid",
    );
    expect(document.body.textContent).toContain(
      "Not supported in this release",
    );
    expect(mockAxios.put).not.toHaveBeenCalled();
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
  });

  it("edits, validates, saves, and renders the successful policy response", async () => {
    const initialPolicy: WorkspaceDeliveryHoursPolicyResource = {
      workspaceId: "workspace-1",
      weekdays: [DeliveryHoursWeekday.Monday, DeliveryHoursWeekday.Wednesday],
      openingTime: "08:00",
      closingTime: "17:00",
      fallbackTimezone: "America/New_York",
      enabledChannels: [],
    };
    const savedPolicy: WorkspaceDeliveryHoursPolicyResource = {
      workspaceId: "workspace-1",
      weekdays: [
        DeliveryHoursWeekday.Monday,
        DeliveryHoursWeekday.Wednesday,
        DeliveryHoursWeekday.Sunday,
      ],
      openingTime: "18:00",
      closingTime: "20:00",
      fallbackTimezone: "EST5EDT",
      enabledChannels: [ChannelType.Sms],
    };
    mockAxios.get
      .mockResolvedValueOnce(axiosResponse(initialPolicy))
      .mockResolvedValue(axiosResponse(savedPolicy));
    mockAxios.put.mockResolvedValue(axiosResponse(savedPolicy));

    renderSettings();
    await waitForAssertion(() => {
      expect(getInputByLabel("Opening time").value).toBe("08:00");
    });

    click(getWeekdayButton("Sunday"));
    setInputValue(getInputByLabel("Opening time"), "18:00");
    expect(getSaveButton().disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Closing time must be later than opening time",
    );

    setInputValue(getInputByLabel("Closing time"), "20:00");
    expect(getSaveButton().disabled).toBe(false);

    setInputValue(getInputByLabel("Fallback timezone"), "Mars/Olympus_Mons");
    await waitForAssertion(() => {
      expect(getSaveButton().disabled).toBe(true);
    });
    expect(document.body.textContent).toContain(
      "Select a valid IANA fallback timezone",
    );

    setInputValue(getInputByLabel("Fallback timezone"), "EST5EDT");
    click(getSwitchByLabel("SMS"));
    await waitForAssertion(() => {
      expect(getSaveButton().disabled).toBe(false);
      expect(getSwitchByLabel("SMS").checked).toBe(true);
    });

    click(getSaveButton());

    await waitForAssertion(() => {
      expect(mockAxios.put).toHaveBeenCalledWith(
        "https://api.example.test/api/settings/delivery-hours",
        savedPolicy,
      );
    });
    await waitForAssertion(() => {
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        "Delivery hours updated successfully",
        expect.objectContaining({ variant: "success" }),
      );
    });

    expect(getWeekdayButton("Sunday").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(getInputByLabel("Opening time").value).toBe("18:00");
    expect(getInputByLabel("Closing time").value).toBe("20:00");
    expect(getInputByLabel("Fallback timezone").value).toBe("EST5EDT");
    expect(getSwitchByLabel("SMS").checked).toBe(true);

    unmountSettings();
    renderSettings();
    await waitForAssertion(() => {
      expect(mockAxios.get).toHaveBeenCalledTimes(2);
      expect(getInputByLabel("Fallback timezone").value).toBe("EST5EDT");
    });
    expect(getWeekdayButton("Sunday").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(getInputByLabel("Opening time").value).toBe("18:00");
    expect(getInputByLabel("Closing time").value).toBe("20:00");
    expect(getSwitchByLabel("SMS").checked).toBe(true);
  });

  it("keeps an in-flight save bound to its submitted workspace", async () => {
    const workspaceOnePolicy: WorkspaceDeliveryHoursPolicyResource = {
      workspaceId: "workspace-1",
      weekdays: [DeliveryHoursWeekday.Monday],
      openingTime: "08:00",
      closingTime: "17:00",
      fallbackTimezone: "America/New_York",
      enabledChannels: [],
    };
    const savedWorkspaceOnePolicy: WorkspaceDeliveryHoursPolicyResource = {
      ...workspaceOnePolicy,
      openingTime: "09:00",
    };
    const workspaceTwoPolicy: WorkspaceDeliveryHoursPolicyResource = {
      workspaceId: "workspace-2",
      weekdays: [DeliveryHoursWeekday.Friday],
      openingTime: "11:00",
      closingTime: "19:00",
      fallbackTimezone: "Europe/London",
      enabledChannels: [ChannelType.Sms],
    };
    const saveRequest =
      deferred<AxiosResponse<WorkspaceDeliveryHoursPolicyResource>>();
    mockAxios.get
      .mockResolvedValueOnce(axiosResponse(workspaceOnePolicy))
      .mockResolvedValueOnce(axiosResponse(workspaceTwoPolicy));
    mockAxios.put.mockReturnValue(saveRequest.promise);

    const store = renderSettings();
    await waitForAssertion(() => {
      expect(getInputByLabel("Opening time").value).toBe("08:00");
    });

    setInputValue(getInputByLabel("Opening time"), "09:00");
    click(getSaveButton());
    await waitForAssertion(() => {
      expect(mockAxios.put).toHaveBeenCalledWith(
        "https://api.example.test/api/settings/delivery-hours",
        savedWorkspaceOnePolicy,
      );
      expect(getSaveButton().disabled).toBe(true);
    });
    expect(getWeekdayButton("Monday").disabled).toBe(true);
    expect(getInputByLabel("Opening time").disabled).toBe(true);
    expect(getInputByLabel("Closing time").disabled).toBe(true);
    expect(getInputByLabel("Fallback timezone").disabled).toBe(true);
    expect(getSwitchByLabel("SMS").disabled).toBe(true);

    act(() => {
      store.setState({
        workspace: {
          type: CompletionStatus.Successful,
          value: { id: "workspace-2", name: "Second workspace" },
        },
      });
    });
    await waitForAssertion(() => {
      expect(getInputByLabel("Opening time").value).toBe("11:00");
    });

    await act(async () => {
      saveRequest.resolve(axiosResponse(savedWorkspaceOnePolicy));
      await saveRequest.promise;
    });
    await waitForAssertion(() => {
      expect(getInputByLabel("Opening time").value).toBe("11:00");
    });
    expect(getWeekdayButton("Friday").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(queryClient?.getQueryData(["deliveryHours", "workspace-1"])).toEqual(
      savedWorkspaceOnePolicy,
    );
    expect(queryClient?.getQueryData(["deliveryHours", "workspace-2"])).toEqual(
      workspaceTwoPolicy,
    );
  });
});
