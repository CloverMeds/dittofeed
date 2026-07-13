import { getTimezoneOptions } from "./timezoneAutocomplete";

describe("timezone autocomplete options", () => {
  it("offers UTC even when the runtime primary-identifier list omits it", () => {
    expect(getTimezoneOptions()).toContain("UTC");
  });

  it("preserves a valid saved IANA link that the runtime list omits", () => {
    expect(getTimezoneOptions("Asia/Kolkata")).toContain("Asia/Kolkata");
  });

  it("does not add an invalid saved timezone", () => {
    expect(getTimezoneOptions("Not/A_Timezone")).not.toContain(
      "Not/A_Timezone",
    );
  });
});
