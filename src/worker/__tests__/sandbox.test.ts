import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"
import { goalWorld, sandboxWorld } from "../test/fakes"
import { trpcMutation, trpcQuery } from "../test/helpers"

/** A model whose tool calling was observed to work (catalog `functionCall`). */
const TOOL_MODEL = "@cf/openai/gpt-oss-120b"
/** A model with no such observation: it must never be offered tools. */
const PLAIN_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

async function sandboxAgent(
  client: TestClient,
  input: Record<string, unknown> = {}
): Promise<string> {
  const created = await trpcMutation<{ id: string }>(client, "agent.create", {
    title: "Coder",
    model: TOOL_MODEL,
    chatConfig: { sandbox: true },
    ...input,
  })
  expect(created.response.status).toBe(200)
  return created.data!.id
}

async function newTopic(client: TestClient, agentId: string): Promise<string> {
  const created = await trpcMutation<{ id: string }>(client, "topic.create", {
    agentId,
  })
  return created.data!.id
}

async function say(
  client: TestClient,
  topicId: string,
  content: string
): Promise<string> {
  const response = await client.post(`/api/chat/topics/${topicId}/messages`, {
    csrf: true,
    json: { content },
  })
  expect(response.status).toBe(200)
  return response.text()
}

type ToolDef = { function: { name: string } }
type ToolRun = { name: string; input: unknown; output: unknown }

describe("code execution in a sandbox", () => {
  it("runs a command the model asks for in the conversation's sandbox and answers from the output", async () => {
    const world = await sandboxWorld({
      steps: [
        { calls: [{ name: "runCommand", args: { command: "echo hello" } }] },
        { text: "It printed hello." },
      ],
    })
    world.sandbox.onExec = () => ({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    })
    const agent = await sandboxAgent(world.client)
    const topicId = await newTopic(world.client, agent)

    const reply = await say(world.client, topicId, "Run echo hello")

    expect(reply).toBe("It printed hello.")
    const [first, second] = world.chatCalls()
    // The model was offered the sandbox tools and told what its environment is.
    expect(
      (first.body.tools as ToolDef[]).map((tool) => tool.function.name).sort()
    ).toEqual([
      "editFile",
      "executeCode",
      "listFiles",
      "readFile",
      "runCommand",
      "writeFile",
    ])
    expect(first.body.messages[0].content).toContain("Cloud Sandbox")
    // The command ran in this topic's own sandbox, and the model saw the output.
    expect(world.sandbox.execLog).toEqual([
      expect.objectContaining({
        id: `topic-${topicId}`,
        command: "echo hello",
        timeoutMs: 30_000,
      }),
    ])
    const toolMessage = second.body.messages.find(
      (message: { role: string }) => message.role === "tool"
    )
    expect(JSON.parse(toolMessage.content)).toEqual({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    })
    // The final answer is what is stored, with the run kept for the UI.
    const loaded = await trpcQuery<{
      messages: Array<{ role: string; content: string; metadata: unknown }>
    }>(world.client, "topic.get", { id: topicId })
    const assistant = loaded.data!.messages.find((m) => m.role === "assistant")!
    expect(assistant.content).toBe("It printed hello.")
    expect((assistant.metadata as { tools: ToolRun[] }).tools).toEqual([
      {
        name: "runCommand",
        input: { command: "echo hello" },
        output: { stdout: "hello\n", stderr: "", exitCode: 0 },
      },
    ])
  })

  it("keeps a conversation's files across turns and never shares them with another conversation", async () => {
    const world = await sandboxWorld({
      steps: [
        {
          calls: [
            {
              name: "writeFile",
              args: { path: "notes/a.txt", content: "alpha" },
            },
          ],
        },
        { text: "Saved." },
        { calls: [{ name: "readFile", args: { path: "notes/a.txt" } }] },
        { text: "It says alpha." },
        { calls: [{ name: "readFile", args: { path: "notes/a.txt" } }] },
        { text: "Not there." },
      ],
    })
    const agent = await sandboxAgent(world.client)
    const first = await newTopic(world.client, agent)
    const other = await newTopic(world.client, agent)

    await say(world.client, first, "Save a note")
    await say(world.client, first, "What does it say?")
    await say(world.client, other, "What does it say?")

    expect(
      world.sandbox.files.get(`topic-${first}`)?.get("/workspace/notes/a.txt")
    ).toBe("alpha")
    const toolResult = (call: number) => {
      const messages = world.chatCalls()[call].body.messages
      const tool = messages.find((m: { role: string }) => m.role === "tool")
      return JSON.parse(tool.content)
    }
    expect(toolResult(3)).toEqual({
      path: "/workspace/notes/a.txt",
      content: "alpha",
    })
    expect(toolResult(5).error).toContain("No such file")
    expect(world.sandbox.files.get(`topic-${other}`)?.size ?? 0).toBe(0)
  })

  it("offers no tools unless the agent opted in, the model can call tools and a sandbox exists", async () => {
    const world = await sandboxWorld()
    const optedOut = await sandboxAgent(world.client, { chatConfig: {} })
    const wrongModel = await sandboxAgent(world.client, { model: PLAIN_MODEL })
    const noBackend = await sandboxWorld()
    const noBackendAgent = await sandboxAgent(noBackend.client)
    const unconfigured = await sandboxWorld({ noBackend: true })
    const unconfiguredAgent = await sandboxAgent(unconfigured.client)

    await say(world.client, await newTopic(world.client, optedOut), "Hi")
    await say(world.client, await newTopic(world.client, wrongModel), "Hi")
    const reply = await say(
      unconfigured.client,
      await newTopic(unconfigured.client, unconfiguredAgent),
      "Hi"
    )
    await say(
      noBackend.client,
      await newTopic(noBackend.client, noBackendAgent),
      "Hi"
    )

    expect(world.chatCalls().map((call) => call.body.tools)).toEqual([
      undefined,
      undefined,
    ])
    expect(unconfigured.chatCalls()[0].body.tools).toBeUndefined()
    expect(reply).toBe("ok") // an unconfigured sandbox never breaks chat
    expect(noBackend.chatCalls()[0].body.tools).toHaveLength(6) // the control case
  })

  it("keeps file tools inside the workspace", async () => {
    const world = await sandboxWorld({
      steps: [
        {
          calls: [
            { name: "writeFile", args: { path: "/etc/passwd", content: "x" } },
            { name: "writeFile", args: { path: "../../etc/x", content: "x" } },
            { name: "readFile", args: { path: "/etc/shadow" } },
            {
              name: "writeFile",
              args: { path: "sub/../ok.txt", content: "fine" },
            },
          ],
        },
        { text: "Done." },
      ],
    })
    const agent = await sandboxAgent(world.client)
    const topicId = await newTopic(world.client, agent)

    await say(world.client, topicId, "Try some paths")

    const results = world
      .chatCalls()[1]
      .body.messages.filter((m: { role: string }) => m.role === "tool")
      .map((m: { content: string }) => JSON.parse(m.content))
    expect(results.slice(0, 3).map((r: { error?: string }) => r.error)).toEqual(
      [
        expect.stringContaining("inside /workspace"),
        expect.stringContaining("inside /workspace"),
        expect.stringContaining("inside /workspace"),
      ]
    )
    expect(results[3]).toMatchObject({ ok: true, path: "/workspace/ok.txt" })
    expect([...world.sandbox.files.get(`topic-${topicId}`)!.keys()]).toEqual([
      "/workspace/ok.txt",
    ])
  })

  it("clamps timeouts and truncates huge output", async () => {
    const world = await sandboxWorld({
      steps: [
        {
          calls: [
            {
              name: "runCommand",
              args: { command: "sleep 1", timeoutSeconds: 9999 },
            },
            {
              name: "runCommand",
              args: { command: "sleep 2", timeoutSeconds: 5 },
            },
            { name: "runCommand", args: { command: "yes" } },
          ],
        },
        { text: "Done." },
      ],
    })
    world.sandbox.onExec = (_id, command) => ({
      stdout: command === "yes" ? "y".repeat(50_000) : "",
      stderr: "",
      exitCode: 0,
    })
    const agent = await sandboxAgent(world.client)

    await say(world.client, await newTopic(world.client, agent), "Run things")

    expect(world.sandbox.execLog.map((run) => run.timeoutMs)).toEqual([
      120_000, 5_000, 30_000,
    ])
    const big = JSON.parse(
      world
        .chatCalls()[1]
        .body.messages.filter((m: { role: string }) => m.role === "tool")[2]
        .content
    )
    expect(big.stdout.length).toBeLessThan(17_000)
    expect(big.stdout).toContain("[truncated 34000 characters]")
  })

  it("still answers when the sandbox fails, and tells the model what went wrong", async () => {
    const world = await sandboxWorld({
      steps: [
        { calls: [{ name: "runCommand", args: { command: "boom" } }] },
        { text: "The sandbox had a problem." },
      ],
    })
    world.sandbox.onExec = () => {
      throw new Error("sandbox exploded")
    }
    const agent = await sandboxAgent(world.client)
    const topicId = await newTopic(world.client, agent)

    const reply = await say(world.client, topicId, "Run boom")

    expect(reply).toBe("The sandbox had a problem.")
    const toolMessage = world
      .chatCalls()[1]
      .body.messages.find((m: { role: string }) => m.role === "tool")
    expect(JSON.parse(toolMessage.content)).toEqual({
      error: "sandbox exploded",
    })
  })

  it("runs code snippets through the right interpreter", async () => {
    const world = await sandboxWorld({
      steps: [
        {
          calls: [
            {
              name: "executeCode",
              args: { language: "python", code: "print(1 + 1)" },
            },
          ],
        },
        { text: "It is 2." },
      ],
    })
    world.sandbox.onExec = (_id, command) => ({
      stdout: command.startsWith("python3") ? "2\n" : "",
      stderr: "",
      exitCode: 0,
    })
    const agent = await sandboxAgent(world.client)
    const topicId = await newTopic(world.client, agent)

    await say(world.client, topicId, "What is 1 + 1?")

    const commands = world.sandbox.execLog.map((run) => run.command)
    expect(commands[0]).toBe("mkdir -p '/workspace/.run'")
    expect(commands[1]).toMatch(
      /^python3 '\/workspace\/\.run\/[0-9a-f-]+\.py'$/
    )
    const [source] = [...world.sandbox.files.get(`topic-${topicId}`)!.values()]
    expect(source).toBe("print(1 + 1)")
  })

  it("edits a file only when the text to replace is unambiguous", async () => {
    const world = await sandboxWorld({
      steps: [
        {
          calls: [
            {
              name: "writeFile",
              args: { path: "a.txt", content: "one two two" },
            },
            {
              name: "editFile",
              args: { path: "a.txt", search: "one", replace: "1" },
            },
            {
              name: "editFile",
              args: { path: "a.txt", search: "two", replace: "2" },
            },
            {
              name: "editFile",
              args: { path: "a.txt", search: "nine", replace: "9" },
            },
            {
              name: "editFile",
              args: {
                path: "a.txt",
                search: "two",
                replace: "2",
                replaceAll: true,
              },
            },
          ],
        },
        { text: "Edited." },
      ],
    })
    const agent = await sandboxAgent(world.client)
    const topicId = await newTopic(world.client, agent)

    await say(world.client, topicId, "Edit the file")

    const results = world
      .chatCalls()[1]
      .body.messages.filter((m: { role: string }) => m.role === "tool")
      .map((m: { content: string }) => JSON.parse(m.content))
    expect(results[1]).toMatchObject({ ok: true, replaced: 1 })
    expect(results[2].error).toContain("occurs 2 times")
    expect(results[3].error).toContain("not found")
    expect(results[4]).toMatchObject({ ok: true, replaced: 2 })
    expect(
      world.sandbox.files.get(`topic-${topicId}`)?.get("/workspace/a.txt")
    ).toBe("1 2 2")
  })

  it("stops a model that keeps calling tools, and says so instead of leaving an empty reply", async () => {
    const forever = Array.from({ length: 20 }, () => ({
      calls: [{ name: "runCommand", args: { command: "true" } }],
    }))
    const world = await sandboxWorld({ steps: forever })
    const agent = await sandboxAgent(world.client)
    const topicId = await newTopic(world.client, agent)

    await say(world.client, topicId, "Loop")

    expect(world.chatCalls()).toHaveLength(8)
    const loaded = await trpcQuery<{
      messages: Array<{ role: string; content: string }>
    }>(world.client, "topic.get", { id: topicId })
    expect(
      loaded.data!.messages.find((m) => m.role === "assistant")?.content
    ).toContain("used all my steps")
  })
})

describe("code execution in goal tasks", () => {
  it("lets a task run code when its executor agent has a sandbox", async () => {
    const world = await goalWorld({
      plans: [
        {
          action: "tasks",
          reason: "Compute it",
          tasks: [
            { title: "Compute the answer", description: "Use the sandbox." },
          ],
        },
      ],
      toolCalls: {
        "Compute the answer": [
          { name: "runCommand", args: { command: "echo $((6 * 7))" } },
        ],
      },
      results: { "Compute the answer": "The answer is 42." },
    })
    world.sandbox.onExec = () => ({ stdout: "42\n", stderr: "", exitCode: 0 })
    const executor = await sandboxAgent(world.client, { title: "Executor" })
    const created = await trpcMutation<{ id: string }>(
      world.client,
      "goal.create",
      {
        title: "Compute",
        taskAgentId: executor,
      }
    )
    const id = created.data!.id

    await trpcMutation(world.client, "goal.start", { id })
    const goal = await trpcQuery<{
      status: string
      tasks: Array<{
        title: string
        result: string | null
        topicId: string | null
      }>
    }>(world.client, "goal.get", { id })

    expect(goal.data?.status).toBe("achieved")
    const task = goal.data!.tasks.find((t) => t.title === "Compute the answer")!
    expect(task.result).toBe("The answer is 42.")
    // The run happened in the task's own sandbox and is kept on its conversation.
    expect(world.sandbox.execLog).toEqual([
      expect.objectContaining({
        id: `topic-${task.topicId}`,
        command: "echo $((6 * 7))",
      }),
    ])
    const topic = await trpcQuery<{
      messages: Array<{ role: string; metadata: unknown }>
    }>(world.client, "topic.get", { id: task.topicId })
    const reply = topic.data!.messages.find((m) => m.role === "assistant")!
    expect((reply.metadata as { tools: ToolRun[] }).tools[0]).toMatchObject({
      name: "runCommand",
      output: { stdout: "42\n" },
    })
  })
})
