import { describe, expect, test, vi } from "vitest";
import { DISPATCH_UNTRUSTED_SOURCE } from "../loop/dispatch-intent.js";
import { wrapUntrusted } from "../security/prompt-shield.js";
import { handleDispatch } from "./dispatch-endpoint.js";

describe("handleDispatch", () => {
  test("triggered event → kickoff called, dispatched:true", async () => {
    const kickoff = vi.fn(async () => {});
    const r = await handleDispatch({ label: "kunpeng:dispatch", title: "做X", number: 5 }, kickoff);
    expect(r).toEqual({ ok: true, dispatched: true, branch: "kp/dispatch-5", requirement: wrapUntrusted(DISPATCH_UNTRUSTED_SOURCE, "做X") });
    expect(kickoff).toHaveBeenCalledTimes(1);
  });
  test("not triggered → kickoff not called, dispatched:false", async () => {
    const kickoff = vi.fn(async () => {});
    const r = await handleDispatch({ label: "bug", title: "x" }, kickoff);
    expect(r).toEqual({ ok: true, dispatched: false });
    expect(kickoff).not.toHaveBeenCalled();
  });
  test("non-object body → dispatched:false", async () => {
    const kickoff = vi.fn(async () => {});
    expect(await handleDispatch(null, kickoff)).toEqual({ ok: true, dispatched: false });
  });
});
