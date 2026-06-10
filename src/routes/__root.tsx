import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TitleBar } from '@/components/TitleBar'

export const Route = createRootRoute({
  component: () => (
    <div className="app-shell">
      <TitleBar />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  ),
})
