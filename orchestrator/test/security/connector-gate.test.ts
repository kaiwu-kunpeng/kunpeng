import { expect, test } from "vitest";
import {
  classifyConnectorAction,
  highRiskConnectorGates,
  type ConnectorAction,
} from "../../src/security/connector-gate.js";

test("classifies three occupied dimensions as requiring a human gate", () => {
  const action: ConnectorAction = {
    name: "github.push",
    target: "owner/repo",
    ctx: {
      untrustedInput: true,
      sensitiveAccess: true,
      externalEgress: true,
    },
  };

  const item = classifyConnectorAction(action);

  expect(item.action).toBe("github.push");
  expect(item.target).toBe("owner/repo");
  expect(item.requiresHumanGate).toBe(true);
  expect(item.verdict.requiresHumanGate).toBe(true);
  expect(item.summary).toContain("github.push");
  expect(item.summary).toContain("owner/repo");
});

test("classifies two occupied dimensions as not requiring a human gate", () => {
  const item = classifyConnectorAction({
    name: "github.comment",
    ctx: {
      untrustedInput: true,
      sensitiveAccess: true,
      externalEgress: false,
    },
  });

  expect(item.requiresHumanGate).toBe(false);
  expect(item.verdict.requiresHumanGate).toBe(false);
});

test("returns only high-risk connector gate items in input order", () => {
  const actions: ConnectorAction[] = [
    {
      name: "github.push",
      target: "owner/repo",
      ctx: {
        untrustedInput: true,
        sensitiveAccess: true,
        externalEgress: true,
      },
    },
    {
      name: "github.comment",
      ctx: {
        untrustedInput: true,
        sensitiveAccess: true,
        externalEgress: false,
      },
    },
    {
      name: "notion.read",
      ctx: {
        untrustedInput: false,
        sensitiveAccess: false,
        externalEgress: false,
      },
    },
  ];

  const items = highRiskConnectorGates(actions);

  expect(items).toHaveLength(1);
  expect(items[0]?.action).toBe("github.push");
  expect(items[0]?.target).toBe("owner/repo");
  expect(items[0]?.requiresHumanGate).toBe(true);
});

test("does not mutate connector action inputs", () => {
  const action: ConnectorAction = {
    name: "github.push",
    target: "owner/repo",
    ctx: {
      untrustedInput: true,
      sensitiveAccess: true,
      externalEgress: true,
    },
  };
  const actions: ConnectorAction[] = [
    action,
    {
      name: "github.comment",
      ctx: {
        untrustedInput: true,
        sensitiveAccess: true,
        externalEgress: false,
      },
    },
  ];
  const actionBefore = structuredClone(action);
  const actionsBefore = structuredClone(actions);

  classifyConnectorAction(action);
  highRiskConnectorGates(actions);

  expect(action).toEqual(actionBefore);
  expect(action.ctx).toEqual(actionBefore.ctx);
  expect(actions).toEqual(actionsBefore);
});
