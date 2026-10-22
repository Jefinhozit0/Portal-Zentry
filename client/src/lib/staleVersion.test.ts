import { describe, expect, it } from "vitest";
import { isStaleVersionError } from "./staleVersion";

describe("isStaleVersionError", () => {
  it("recognises the message of each browser when a page file of an old deploy is gone", () => {
    expect(isStaleVersionError(new TypeError("Failed to fetch dynamically imported module: https://zentry-portal.tail80bc42.ts.net/assets/ClientDetail-C3FddDrK.js"))).toBe(true);
    expect(isStaleVersionError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleVersionError(new TypeError("error loading dynamically imported module: https://x/assets/a.js"))).toBe(true);
  });

  it("leaves other errors alone", () => {
    expect(isStaleVersionError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
    expect(isStaleVersionError(null)).toBe(false);
  });
});
