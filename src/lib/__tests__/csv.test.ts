import { describe, expect, it } from "vitest";
import { buildCsv, neutralizeFormulaInjection } from "../csv";

describe("buildCsv", () => {
  it("joins a header and rows with CRLF, unquoted when no special characters are present", () => {
    const csv = buildCsv(["A", "B"], [["1", "2"]]);
    expect(csv).toBe("A,B\r\n1,2");
  });

  it("quotes and doubles an embedded quote", () => {
    const csv = buildCsv(["Name"], [['Say "hi"']]);
    expect(csv).toBe('Name\r\n"Say ""hi"""');
  });

  it("quotes a field containing a comma", () => {
    const csv = buildCsv(["Name"], [["Doe, Jane"]]);
    expect(csv).toBe('Name\r\n"Doe, Jane"');
  });

  it("quotes a field containing a newline", () => {
    const csv = buildCsv(["Notes"], [["line one\nline two"]]);
    expect(csv).toBe('Notes\r\n"line one\nline two"');
  });

  it("quotes a field containing a carriage return", () => {
    const csv = buildCsv(["Notes"], [["line one\rline two"]]);
    expect(csv).toBe('Notes\r\n"line one\rline two"');
  });

  it("handles multiple rows", () => {
    const csv = buildCsv(["A"], [["1"], ["2"], ["3"]]);
    expect(csv).toBe("A\r\n1\r\n2\r\n3");
  });
});

describe("neutralizeFormulaInjection", () => {
  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+1+1", "'+1+1"],
    ["-1+1", "'-1+1"],
    ["@SUM(1)", "'@SUM(1)"],
  ])("prefixes a leading apostrophe for a dangerous formula prefix (%s)", (input, expected) => {
    expect(neutralizeFormulaInjection(input)).toBe(expected);
  });

  it("leaves an ordinary value untouched", () => {
    expect(neutralizeFormulaInjection("Jane Doe")).toBe("Jane Doe");
    expect(neutralizeFormulaInjection("Engineering")).toBe("Engineering");
  });

  it("leaves an empty string untouched", () => {
    expect(neutralizeFormulaInjection("")).toBe("");
  });
});
