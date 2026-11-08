import MissionControl from '@/components/mission/MissionControl'
import { ErrorBoundary } from '@/components/shell/ErrorBoundary'

export default function App() {
  // a new key after "Reset view" remounts the screen with fresh state
  return <ErrorBoundary>{(attempt) => <MissionControl key={attempt} />}</ErrorBoundary>
}
