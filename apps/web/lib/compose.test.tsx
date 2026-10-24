import { describe, expect, it } from "vitest";
import { imageSize } from "@bodh/integrations/storage";
import { compose } from "./compose";

// A 4x4 red PNG.
const red = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC",
  "base64",
);

describe("compose", () => {
  it("renders a 1280×720 thumbnail with a title and a logo", async () => {
    const out = await compose({
      image: { bytes: red, mimeType: "image/png", width: 4, height: 4 },
      size: { width: 1280, height: 720 },
      title: "Saturn in the 7th house",
      logo: { bytes: red, mimeType: "image/png" },
    });
    expect(out.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(imageSize(out)).toEqual({ width: 1280, height: 720 });
    expect(out.length).toBeGreaterThan(5000); // the title adds real pixels over the flat image
  }, 30_000);

  it("keeps the source size when only stamping a logo", async () => {
    const out = await compose({ image: { bytes: red, mimeType: "image/png", width: 800, height: 1000 }, logo: { bytes: red, mimeType: "image/png" } });
    expect(imageSize(out)).toEqual({ width: 800, height: 1000 });
  }, 30_000);
});
