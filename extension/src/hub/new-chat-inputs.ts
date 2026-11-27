export function newChatInputs<T extends { ai: string }, Title>(want: string, pick: () => Promise<T>, title: () => Promise<Title>) {
  const picked = pick()
  const named = title()
  return {
    picked,
    title: named,
    toolPick: async <Tools>(step: () => Promise<Tools>) => want === 'claude' ? step() : (await picked.then(p => p.ai, () => undefined)) === 'claude' ? step() : undefined,
  }
}
