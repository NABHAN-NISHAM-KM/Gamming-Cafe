import { describe, expect, it } from "vitest";
import { isJpeg } from "../src/stations/screenshots.service.js";

describe("screenshot upload checks", () => {
  it("accepts only JPEG bytes", () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]))).toBe(true);
    expect(isJpeg(Buffer.from("<svg onload=alert(1)>"))).toBe(false);
    expect(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0xff, 0xd9]))).toBe(false); // PNG
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).toBe(false); // cut off
  });
});
