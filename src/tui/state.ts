export type WatchMode = "IDLE" | "QUERYING" | "SHOWING_RESULT";
export type WatchAction = "none" | "quit" | "submit";

export interface WatchState {
  mode: WatchMode;
  queryInput: string;
  aiResponse: string;
  agentActivity: string;
  scrollOffset: number;
  dockerCursor: number;
  panelFocus: "docker" | null;
  selectedContainer: string | null;
  compactMode: boolean;
}

export function createWatchState(): WatchState {
  return {
    mode: "IDLE",
    queryInput: "",
    aiResponse: "",
    agentActivity: "",
    scrollOffset: 0,
    dockerCursor: -1,
    panelFocus: null,
    selectedContainer: null,
    compactMode: false,
  };
}

export function handleKey(
  state: WatchState,
  key: string,
  containerNames: string[] = []
): { state: WatchState; action: WatchAction } {
  switch (state.mode) {
    case "IDLE": {
      if (key === "/") return { state: { ...state, mode: "QUERYING", queryInput: "" }, action: "none" };
      if (key === "q" || key === "Q" || key === "\x03") return { state, action: "quit" };
      if (key === "z" || key === "Z") return { state: { ...state, compactMode: !state.compactMode }, action: "none" };

      if (key === "\x1b") {
        if (state.selectedContainer !== null) return { state: { ...state, selectedContainer: null }, action: "none" };
        if (state.dockerCursor >= 0) return { state: { ...state, dockerCursor: -1, panelFocus: null }, action: "none" };
        return { state, action: "none" };
      }

      if (key === "\r" && state.panelFocus === "docker" && state.dockerCursor >= 0) {
        const name = containerNames[state.dockerCursor];
        if (!name) return { state, action: "none" };
        const isSame = state.selectedContainer === name;
        return { state: { ...state, selectedContainer: isSame ? null : name }, action: "none" };
      }

      if (containerNames.length > 0) {
        if (key === "\x1b[B") {
          const next = state.dockerCursor < 0 ? 0 : (state.dockerCursor + 1) % containerNames.length;
          return { state: { ...state, dockerCursor: next, panelFocus: "docker" }, action: "none" };
        }
        if (key === "\x1b[A") {
          const next = state.dockerCursor <= 0 ? containerNames.length - 1 : state.dockerCursor - 1;
          return { state: { ...state, dockerCursor: next, panelFocus: "docker" }, action: "none" };
        }
      }

      return { state, action: "none" };
    }

    case "QUERYING": {
      if (key === "\x1b") return { state: { ...state, mode: "IDLE", queryInput: "" }, action: "none" };
      if (key === "\x03") return { state, action: "quit" };
      if (key === "\r" || key === "\n") {
        if (!state.queryInput.trim()) return { state, action: "none" };
        return { state, action: "submit" };
      }
      if (key === "\x7f" || key === "\b") {
        return { state: { ...state, queryInput: state.queryInput.slice(0, -1) }, action: "none" };
      }
      if (key.length === 1 && key >= " ") {
        return { state: { ...state, queryInput: state.queryInput + key }, action: "none" };
      }
      return { state, action: "none" };
    }

    case "SHOWING_RESULT": {
      if (key === "q" || key === "Q" || key === "\x03") return { state, action: "quit" };
      if (key === "z" || key === "Z") return { state: { ...state, compactMode: !state.compactMode }, action: "none" };
      if (key === "\x1b[A") return { state: { ...state, scrollOffset: state.scrollOffset + 1 }, action: "none" };
      if (key === "\x1b[B") return { state: { ...state, scrollOffset: Math.max(0, state.scrollOffset - 1) }, action: "none" };
      if (key === "\x1b") return { state: { ...state, mode: "IDLE", aiResponse: "", scrollOffset: 0 }, action: "none" };
      if (key === "/") return { state: { ...state, mode: "QUERYING", queryInput: "", scrollOffset: 0 }, action: "none" };
      return { state, action: "none" };
    }
  }
}
