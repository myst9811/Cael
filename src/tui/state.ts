export type WatchMode = "IDLE" | "QUERYING" | "SHOWING_RESULT";
export type WatchAction = "none" | "quit" | "submit";

export interface WatchState {
  mode: WatchMode;
  queryInput: string;
  aiResponse: string;
}

export function createWatchState(): WatchState {
  return { mode: "IDLE", queryInput: "", aiResponse: "" };
}

export function handleKey(
  state: WatchState,
  key: string
): { state: WatchState; action: WatchAction } {
  switch (state.mode) {
    case "IDLE":
      if (key === "/") return { state: { ...state, mode: "QUERYING", queryInput: "" }, action: "none" };
      if (key === "q" || key === "Q" || key === "\x03") return { state, action: "quit" };
      return { state, action: "none" };

    case "QUERYING":
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

    case "SHOWING_RESULT":
      if (key === "q" || key === "Q" || key === "\x03") return { state, action: "quit" };
      return { state: { ...state, mode: "IDLE", aiResponse: "" }, action: "none" };
  }
}
