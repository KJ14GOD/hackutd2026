import { create } from 'zustand'

/* ------------------------------------------------------------------ *
 * Screen state shared across workspaces: which workspace is open, who is
 * "viewing as" (no sign-in in the mock), the Business / Engineer register,
 * and cross-links (open a requirement from the map, show an impact on the
 * map). Nothing here is domain data; that lives in useStore.
 * ------------------------------------------------------------------ */

export type Workspace = 'map' | 'requirements' | 'questions' | 'inbox' | 'people'
export type Mode = 'business' | 'engineer'
export type ReqTab = 'detail' | 'history' | 'verification'

const KEY = 'shadow-diff:ui'
function load(): { viewerId?: string; modes?: Record<string, Mode> } {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}
function save(v: { viewerId: string; modes: Record<string, Mode> }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* private window: fine, it just won't be remembered */
  }
}

export interface MapImpact {
  label: string
  programs: string[]
  downstream: string[]
}

interface UiState {
  workspace: Workspace
  viewerId: string
  /** the register, remembered per viewer */
  modes: Record<string, Mode>
  mode: Mode
  /** pocket filter shared by Requirements and Questions ('' = all) */
  pocket: string
  reqId: string | null
  reqTab: ReqTab
  conflictId: string | null
  questionId: string | null
  personId: string | null
  scopeId: string | null
  peopleTab: 'org' | 'approvers'
  /** a change's impact, drawn on the map */
  impact: MapImpact | null

  go: (w: Workspace) => void
  setViewer: (id: string) => void
  setMode: (m: Mode) => void
  setPocket: (id: string) => void
  openReq: (id: string | null, tab?: ReqTab) => void
  setReqTab: (t: ReqTab) => void
  openConflict: (id: string | null) => void
  openQuestion: (id: string | null) => void
  openPerson: (id: string | null) => void
  openScope: (id: string | null) => void
  setPeopleTab: (t: 'org' | 'approvers') => void
  showImpact: (i: MapImpact | null) => void
}

const saved = load()

export const useUi = create<UiState>((set, get) => ({
  workspace: 'map',
  viewerId: saved.viewerId ?? 'p-priya',
  modes: saved.modes ?? {},
  mode: saved.modes?.[saved.viewerId ?? 'p-priya'] ?? 'business',
  pocket: '',
  reqId: null,
  reqTab: 'detail',
  conflictId: null,
  questionId: null,
  personId: null,
  scopeId: null,
  peopleTab: 'org',
  impact: null,

  go: (workspace) => set({ workspace }),
  setViewer: (viewerId) => {
    const modes = get().modes
    set({ viewerId, mode: modes[viewerId] ?? 'business' })
    save({ viewerId, modes })
  },
  setMode: (mode) => {
    const modes = { ...get().modes, [get().viewerId]: mode }
    set({ mode, modes })
    save({ viewerId: get().viewerId, modes })
  },
  setPocket: (pocket) => set({ pocket }),
  openReq: (reqId, tab) => set({ reqId, conflictId: null, reqTab: tab ?? get().reqTab, workspace: 'requirements' }),
  setReqTab: (reqTab) => set({ reqTab }),
  openConflict: (conflictId) => set({ conflictId, reqId: null, workspace: 'requirements' }),
  openQuestion: (questionId) => set({ questionId, workspace: 'questions' }),
  openPerson: (personId) => set({ personId, scopeId: null, peopleTab: 'org', workspace: 'people' }),
  openScope: (scopeId) => set({ scopeId, personId: null, peopleTab: 'org', workspace: 'people' }),
  setPeopleTab: (peopleTab) => set({ peopleTab }),
  showImpact: (impact) => set({ impact, workspace: impact ? 'map' : get().workspace }),
}))
