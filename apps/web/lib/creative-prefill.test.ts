/**
 * Which creative a post asks for.
 *
 * The studio is opened from a calendar post, so it should already be set to make the right
 * thing: a carousel for a carousel, a 16:9 thumbnail for a long video, a vertical video for a
 * reel. Getting this wrong is not fatal — every control is still there to change — but it is
 * the difference between a form that knows what you are doing and one that does not.
 */
import { describe, expect, it } from "vitest";
import { shapeFor } from "./creative-prefill";

describe("shapeFor", () => {
  it("makes a carousel for a carousel, whatever the channel", () => {
    expect(shapeFor("instagram", "carousel")).toEqual({ kind: "carousel", aspect: "4:5" });
    expect(shapeFor("linkedin", "carousel")).toEqual({ kind: "carousel", aspect: "4:5" });
  });

  it("makes a 16:9 thumbnail for a long video", () => {
    expect(shapeFor("youtube", "long_video")).toEqual({ kind: "thumbnail", aspect: "16:9" });
    expect(shapeFor("youtube", "post")).toEqual({ kind: "thumbnail", aspect: "16:9" });
  });

  it("makes a vertical video for a reel or a short", () => {
    expect(shapeFor("instagram", "reel")).toEqual({ kind: "video", aspect: "9:16" });
    expect(shapeFor("youtube", "short")).toEqual({ kind: "video", aspect: "9:16" });
  });

  it("falls back to an image, square on LinkedIn and 4:5 elsewhere", () => {
    expect(shapeFor("instagram", "image")).toEqual({ kind: "image", aspect: "4:5" });
    expect(shapeFor("linkedin", "image")).toEqual({ kind: "image", aspect: "1:1" });
    expect(shapeFor("gbp", "post")).toEqual({ kind: "image", aspect: "4:5" });
  });

  it("answers for a format it has never heard of rather than returning nothing", () => {
    expect(shapeFor("quora", "something-new")).toEqual({ kind: "image", aspect: "4:5" });
  });
});
