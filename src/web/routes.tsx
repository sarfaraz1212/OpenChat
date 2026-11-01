import type { RouteObject } from "react-router"
import { AppShell } from "./components/AppShell"
import { AccountSettings } from "./pages/AccountSettings"
import { AgentProfile } from "./pages/AgentProfile"
import { Chat } from "./pages/Chat"
import { DeepResearch } from "./pages/DeepResearch"
import { GoalDetail } from "./pages/GoalDetail"
import { Goals } from "./pages/Goals"
import { GroupPage } from "./pages/GroupPage"
import { Images } from "./pages/Images"
import { BackgroundRemoval, ImageEnhancer } from "./pages/ImageTool"
import { Knowledge } from "./pages/Knowledge"
import { MemoryPage } from "./pages/Memory"
import { NotFound } from "./pages/NotFound"
import { ProviderSettings } from "./pages/ProviderSettings"
import { ResetPassword } from "./pages/ResetPassword"
import { Usage } from "./pages/Usage"

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Chat /> },
      { path: "/chat/:topicId", element: <Chat /> },
      { path: "/agent/:agentId", element: <Chat /> },
      { path: "/agent/:agentId/profile", element: <AgentProfile /> },
      { path: "/group/:groupId", element: <GroupPage /> },
      { path: "/goals", element: <Goals /> },
      { path: "/goal/:goalId", element: <GoalDetail /> },
      { path: "/images", element: <Images /> },
      { path: "/background-removal", element: <BackgroundRemoval /> },
      { path: "/image-enhancer", element: <ImageEnhancer /> },
      { path: "/deep-research", element: <DeepResearch /> },
      {
        // Loaded on demand: it brings the markdown renderer with it.
        path: "/deep-research/:sessionId",
        lazy: async () => ({
          Component: (await import("./pages/ResearchReport")).ResearchReport,
        }),
      },
      { path: "/knowledge", element: <Knowledge /> },
      { path: "/memory", element: <MemoryPage /> },
      { path: "/usage", element: <Usage /> },
      { path: "/settings/account", element: <AccountSettings /> },
      {
        path: "/settings/provider/:providerId",
        element: <ProviderSettings />,
      },
    ],
  },
  // Outside the shell: the person arriving from the email is signed out.
  { path: "/reset-password", element: <ResetPassword /> },
  { path: "*", element: <NotFound /> },
]
