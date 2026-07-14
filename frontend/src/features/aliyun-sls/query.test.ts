import { describe, expect, it } from "vitest";
import { appendSLSResultFilter, encodeSLSQueryValue } from "./query";

describe("Alibaba Cloud SLS result filters", () => {
  it("matches the SLS console index-query format", () => {
    expect(
      appendSLSResultFilter(
        "",
        "content.type",
        "content.type",
        "business",
        false,
      ),
    ).toBe("* and content.type: business");
    expect(
      appendSLSResultFilter(
        "*",
        "content.type",
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
        "content.type",
        "business",
        false,
      ),
    ).toBe("* and content.type: business | where status >= 500");
    expect(
      appendSLSResultFilter(
        "*",
        undefined,
        "content.type",
        "business",
        true,
      ),
    ).toBe([
      "* | where json_extract_scalar(content, '$.type') is null or",
      "json_extract_scalar(content, '$.type') != 'business'",
    ].join(" "));
    expect(
      appendSLSResultFilter(
        "* | project content",
        undefined,
        "content.type",
        "business",
        false,
      ),
    ).toBe(
      "* | where json_extract_scalar(content, '$.type') = 'business' | project content",
    );
    expect(encodeSLSQueryValue("and")).toBe('"and"');
  });
});
