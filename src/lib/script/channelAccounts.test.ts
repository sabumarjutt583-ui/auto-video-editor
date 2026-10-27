import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelProfile } from "../pipeline/profile.ts";
import { channelsUsingAccount, orderAccountIds } from "./channelAccounts.ts";

test("the picked account is tried first, then the rest in order", () => {
  assert.deepEqual(orderAccountIds("2", ["1", "2", "3"]), ["2", "1", "3"]);
  assert.deepEqual(orderAccountIds(null, ["1", "2"]), ["1", "2"]);
  assert.deepEqual(orderAccountIds("9", ["1", "2"]), ["1", "2"]);
});

test("only channels with the exact account id are listed", () => {
  const profiles = [
    { id: "c1", name: "Korean", script: { writer: "claude", masterPrompt: "", claudeAccountId: "2" } },
    { id: "c2", name: "Spanish", script: { writer: "claude", masterPrompt: "", claudeAccountId: null } },
  ] as unknown as ChannelProfile[];
  assert.deepEqual(channelsUsingAccount(profiles, "2"), ["Korean"]);
  assert.deepEqual(channelsUsingAccount(profiles, "1"), []);
});
