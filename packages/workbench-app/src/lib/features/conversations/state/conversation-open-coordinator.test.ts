import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createConversationOpener } from "./conversation-open-coordinator";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("conversation open coordinator", () => {
  it("activates on the first click before transcript hydration", async () => {
    const transcriptHydration = deferred<void>();
    const calls: string[] = [];
    let deferredProjectActivation = false;
    const conversation = { id: "conv_1", projectId: "proj_2" };
    const open = createConversationOpener({
      findConversation: () => conversation,
      fetchConversation: async () => conversation,
      selectedProjectId: () => "proj_1",
      selectProject: (_projectId, options) => {
        calls.push("select-project");
        deferredProjectActivation = options.deferTabActivation;
      },
      activate: () => {
        calls.push("activate");
      },
      hydrate: () => {
        calls.push("hydrate");
        return transcriptHydration.promise;
      },
    });

    const result = open(conversation.id);
    await Promise.resolve();
    assert.deepEqual(calls, ["select-project", "activate"]);
    assert.equal(deferredProjectActivation, true);
    await Promise.resolve();
    assert.deepEqual(calls, ["select-project", "activate", "hydrate"]);
    transcriptHydration.resolve();
    await result;
  });

  it("does not hydrate an earlier click after a newer selection wins", async () => {
    const firstProjectSelection = deferred<void>();
    const calls: string[] = [];
    const conversations = new Map([
      ["conv_1", { id: "conv_1", projectId: "proj_1" }],
      ["conv_2", { id: "conv_2", projectId: "proj_2" }],
    ]);
    let selectedProjectId = "proj_0";
    const open = createConversationOpener({
      findConversation: (id) => conversations.get(id),
      fetchConversation: async (id) => conversations.get(id)!,
      selectedProjectId: () => selectedProjectId,
      selectProject: (projectId) => {
        selectedProjectId = projectId;
        return projectId === "proj_1"
          ? firstProjectSelection.promise
          : undefined;
      },
      activate: (conversation) => {
        calls.push(`activate:${conversation.id}`);
      },
      hydrate: async (conversation) => {
        calls.push(`hydrate:${conversation.id}`);
      },
    });

    const first = open("conv_1");
    await open("conv_2");
    firstProjectSelection.resolve();
    await first;

    assert.deepEqual(calls, ["activate:conv_2", "hydrate:conv_2"]);
  });
});
