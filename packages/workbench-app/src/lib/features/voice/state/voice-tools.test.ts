import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createVoiceToolDispatcher,
  type VoiceWorkspaceSnapshot,
} from "./voice-tools";

const snapshot: VoiceWorkspaceSnapshot = {
  projects: [
    { id: "proj_alpha", name: "Alpha" },
    { id: "proj_beta", name: "Beta" },
  ],
  conversations: [
    {
      id: "conv_alpha_one",
      projectId: "proj_alpha",
      title: "Alpha one",
      status: "running",
    },
    {
      id: "conv_alpha_two",
      projectId: "proj_alpha",
      title: "Alpha two",
      status: "idle",
    },
    {
      id: "conv_beta_one",
      projectId: "proj_beta",
      title: "Beta one",
      status: "needs_user",
    },
  ],
};

function dependencies(confirm = true) {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      openConversation: async (id: string) => calls.push(`open:${id}`),
      sendPrompt: async (id: string, prompt: string) =>
        calls.push(`send:${id}:${prompt}`),
      createConversation: async (projectId: string, prompt: string) =>
        calls.push(`create:${projectId}:${prompt}`),
      requestConfirmation: async () => confirm,
    },
  };
}

describe("voice tool scope", () => {
  it("limits chat scope to the active chat", async () => {
    const deps = dependencies();
    const dispatch = createVoiceToolDispatcher(
      () => ({
        scope: "chat",
        activeProjectId: "proj_alpha",
        activeConversationId: "conv_alpha_one",
        snapshot,
      }),
      deps.actions,
    );

    const listed = (await dispatch("list_conversations", {})) as {
      conversations: { id: string }[];
    };
    assert.deepEqual(
      listed.conversations.map((item) => item.id),
      ["conv_alpha_one"],
    );
    await assert.rejects(
      () =>
        dispatch("open_conversation", {
          conversation_id: "conv_alpha_two",
        }),
      /outside the current voice scope/,
    );
  });

  it("limits project scope to every chat in the active project", async () => {
    const deps = dependencies();
    const dispatch = createVoiceToolDispatcher(
      () => ({
        scope: "project",
        activeProjectId: "proj_alpha",
        snapshot,
      }),
      deps.actions,
    );

    const listed = (await dispatch("list_conversations", {})) as {
      conversations: { id: string }[];
    };
    assert.deepEqual(
      listed.conversations.map((item) => item.id),
      ["conv_alpha_one", "conv_alpha_two"],
    );
    await assert.rejects(
      () => dispatch("list_conversations", { project_id: "proj_beta" }),
      /outside the current voice scope/,
    );
  });

  it("allows all-project scope to inspect every project and chat", async () => {
    const deps = dependencies();
    const dispatch = createVoiceToolDispatcher(
      () => ({ scope: "all", snapshot }),
      deps.actions,
    );

    const projects = (await dispatch("list_projects", {})) as {
      projects: { id: string }[];
    };
    const conversations = (await dispatch("list_conversations", {})) as {
      conversations: { id: string }[];
    };
    assert.equal(projects.projects.length, 2);
    assert.equal(conversations.conversations.length, 3);
  });

  it("requires confirmation before sending a prompt", async () => {
    const deps = dependencies(false);
    const dispatch = createVoiceToolDispatcher(
      () => ({ scope: "all", snapshot }),
      deps.actions,
    );

    const result = await dispatch("send_prompt", {
      conversation_id: "conv_beta_one",
      prompt: "Continue the work",
    });
    assert.deepEqual(result, { cancelled: true });
    assert.deepEqual(deps.calls, []);
  });

  it("runs a confirmed create action", async () => {
    const deps = dependencies(true);
    const dispatch = createVoiceToolDispatcher(
      () => ({
        scope: "project",
        activeProjectId: "proj_alpha",
        snapshot,
      }),
      deps.actions,
    );

    assert.deepEqual(
      await dispatch("create_conversation", {
        project_id: "proj_alpha",
        prompt: "Fix the login test",
      }),
      { created: true },
    );
    assert.deepEqual(deps.calls, ["create:proj_alpha:Fix the login test"]);
  });
});
