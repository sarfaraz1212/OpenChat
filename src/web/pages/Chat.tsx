import { useParams } from "react-router"
import { useShell } from "../components/AppShell"
import { ChatWorkspace } from "../components/ChatWorkspace"
import { HomeDashboard } from "../components/HomeDashboard"
import { useChatController } from "../hooks/useChatController"

export function Chat() {
  const controller = useChatController()
  const shell = useShell()
  const { topicId, agentId } = useParams()

  if (!topicId && !agentId) {
    return (
      <HomeDashboard
        user={controller.user}
        model={controller.model}
        ready={Boolean(controller.agent)}
        sending={controller.sending}
        error={controller.error}
        onOpenSidebar={shell.openSidebar}
        onSelectModel={(model) => void controller.selectModel(model)}
        onSend={(content) => void controller.send(content)}
      />
    )
  }

  return (
    <ChatWorkspace
      user={controller.user}
      agent={controller.agent}
      topic={controller.topic}
      model={controller.model}
      streamingText={controller.streamingText}
      sending={controller.sending}
      error={controller.error}
      onOpenSidebar={shell.openSidebar}
      onSelectModel={(model) => void controller.selectModel(model)}
      onSend={(content) => void controller.send(content)}
    />
  )
}
