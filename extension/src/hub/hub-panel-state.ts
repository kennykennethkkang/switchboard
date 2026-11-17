/** What the hub panel remembers between refreshes in this window. */
export const newPanelState = () => ({
  // Codex chats Switchboard already handed off, so a full chat starts one fresh chat, not one per refresh.
  handedOff: new Set<string>(),
  // Handed-off Codex chats still open: each is closed once it is idle. Not kept across reloads: such a chat stays open (but in History) after one.
  closingCodex: new Set<string>(),
  // When each full Codex chat was first seen mid-turn; its handoff waits on the turn for at most 30 minutes.
  codexBusySince: new Map<string, number>(),
  // Last read times of the throttled refreshes.
  awsAt: -Infinity,
  webAt: -Infinity,
  changesAt: 0,
  nearAt: 0,
  pending: undefined as NodeJS.Timeout | undefined,
})

export type PanelState = ReturnType<typeof newPanelState>
