/** Locks SLS quoting, full-text fallback, exclusion, and pipeline composition rules. */
import { describe, expect, it } from "vitest";
import { appendSLSResultFilter, encodeSLSQueryValue } from "./query";

describe("Alibaba Cloud SLS result filters", () => {
  it("matches the SLS console index-query format", () => {
    expect(
      appendSLSResultFilter(
        "",
        "content.type",
        "business",
        false,
      ),
    ).toBe("* and content.type: business");
    expect(
      appendSLSResultFilter(
        "*",
        "content.type",
        "business",
        true,
      ),
    ).toBe("* not content.type: business");
  });

  it("inserts filters before SPL and quotes syntax-sensitive values", () => {
    expect(
      appendSLSResultFilter(
        "* | where status >= 500",
        "content.type",
        "business",
        false,
      ),
    ).toBe("* and content.type: business | where status >= 500");
    expect(
      appendSLSResultFilter(
        "*",
        undefined,
        "rule-sgkamoiika09m9cjmm",
        false,
      ),
    ).toBe("* and rule-sgkamoiika09m9cjmm");
    expect(
      appendSLSResultFilter(
        "* | project content",
        undefined,
        "business",
        true,
      ),
    ).toBe("* not business | project content");
    expect(encodeSLSQueryValue("and")).toBe('"and"');
  });
});
