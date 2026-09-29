import { describe, expect, it } from "vitest";
import { toCsv } from "../src/common/csv.js";

describe("CSV export", () => {
  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", null]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",\r\n');
  });

  it("defuses spreadsheet formulas in untrusted text but keeps negative numbers", () => {
    const out = toCsv(["v"], [["=HYPERLINK(\"http://x\")"], ["+1+1"], ["@SUM(A1)"], ["-5.25"], ["-cmd"]]).split("\r\n");
    expect(out.slice(1, 6)).toEqual(['"\'=HYPERLINK(""http://x"")"', "'+1+1", "'@SUM(A1)", "-5.25", "'-cmd"]);
  });
});
