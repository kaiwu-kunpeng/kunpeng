import { expect, test } from "vitest";
import { extractFirstJsonObject } from "../src/util/extract-json.js";

test("extractFirstJsonObject returns pure JSON unchanged", () => {
  const json = '{"a":1,"b":["x"]}';

  expect(extractFirstJsonObject(json)).toBe(json);
  expect(JSON.parse(extractFirstJsonObject(json))).toEqual({ a: 1, b: ["x"] });
});

test("extractFirstJsonObject ignores trailing noise", () => {
  expect(extractFirstJsonObject('{"a":1}\ntokens used\n15,109\n')).toBe('{"a":1}');
});

test("extractFirstJsonObject skips prefix noise", () => {
  expect(extractFirstJsonObject('log line\n{"a":1}')).toBe('{"a":1}');
});

test("extractFirstJsonObject keeps braces inside string values", () => {
  const json = '{"k":"if(x){y}","z":1}';

  expect(extractFirstJsonObject(json)).toBe(json);
});

test("extractFirstJsonObject handles escaped quotes inside strings", () => {
  const json = '{"k":"a\\"b","z":2}';

  expect(extractFirstJsonObject(json)).toBe(json);
});

test("extractFirstJsonObject returns the first object among multiple objects", () => {
  expect(extractFirstJsonObject('{"a":1}{"b":2}')).toBe('{"a":1}');
});

test("extractFirstJsonObject returns complete nested objects", () => {
  expect(extractFirstJsonObject('{"a":{"b":1}}trailing')).toBe('{"a":{"b":1}}');
});

test("extractFirstJsonObject throws when no object starts", () => {
  expect(() => extractFirstJsonObject("no json here")).toThrow(
    "extractFirstJsonObject: 无 JSON 对象",
  );
});

test("extractFirstJsonObject throws when object is incomplete", () => {
  expect(() => extractFirstJsonObject('{"a":1')).toThrow(
    "extractFirstJsonObject: JSON 对象不完整",
  );
});
