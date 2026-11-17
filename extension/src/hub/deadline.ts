/** The answer of a quick model call, or undefined on error or when ms passes first. */
export async function withDeadline(run: () => Promise<string>, ms: number): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>(r => { timer = setTimeout(() => r(undefined), ms) })
  const answer = await Promise.race([run().catch(() => undefined), timeout])
  clearTimeout(timer)
  return answer
}
