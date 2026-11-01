import { router } from "./init"
import { accountRouter } from "./routers/account"
import { agentRouter } from "./routers/agent"
import { agentGroupRouter } from "./routers/agent-group"
import {
  aiInfraRouter,
  aiModelRouter,
  aiProviderRouter,
} from "./routers/ai-infra"
import { fileRouter } from "./routers/file"
import { goalRouter } from "./routers/goal"
import { imageRouter } from "./routers/image"
import { knowledgeBaseRouter } from "./routers/knowledge-base"
import { memoryRouter } from "./routers/memory"
import { messageRouter } from "./routers/message"
import { researchRouter } from "./routers/research"
import { topicRouter } from "./routers/topic"
import { usageRouter } from "./routers/usage"

export type { TrpcContext } from "./init"

export const appRouter = router({
  account: accountRouter,
  aiProvider: aiProviderRouter,
  aiModel: aiModelRouter,
  aiInfra: aiInfraRouter,
  agent: agentRouter,
  agentGroup: agentGroupRouter,
  file: fileRouter,
  goal: goalRouter,
  image: imageRouter,
  memory: memoryRouter,
  knowledgeBase: knowledgeBaseRouter,
  topic: topicRouter,
  usage: usageRouter,
  message: messageRouter,
  research: researchRouter,
})

export type AppRouter = typeof appRouter
