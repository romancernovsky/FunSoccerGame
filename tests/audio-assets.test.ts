import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { RECORDINGS, EFFECTS } from "../src/recorded-audio";

test("every recorded sound is bundled, credited, CC0 and matches its source manifest", async () => {
  const sources = JSON.parse(
    await readFile("public/audio/sources.json", "utf8"),
  );
  const credits = await readFile("public/audio/CREDITS.md", "utf8");
  let bytes = 0;
  for (const [name, path] of Object.entries(RECORDINGS)) {
    const source = sources.find((s: { name: string }) => s.name === name);
    assert.ok(source, name);
    assert.equal(source.license, "CC0-1.0");
    assert.equal(
      source.licenseUrl,
      "https://creativecommons.org/publicdomain/zero/1.0/",
    );
    assert.ok(credits.includes(source.page));
    const file = await readFile("public" + path);
    bytes += file.byteLength;
    assert.equal(
      createHash("sha256").update(file).digest("hex"),
      source.sha256,
    );
    assert.ok(file.byteLength > 1000);
  }
  assert.ok(
    bytes < 512 * 1024,
    "The broadcast asset pack should remain small.",
  );
  for (const parts of Object.values(EFFECTS))
    for (const part of parts) assert.ok(RECORDINGS[part.clip]);
});
