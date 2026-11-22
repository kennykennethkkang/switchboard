import { Switchboard } from "@/components/switchboard/switchboard"
import { ResearchPanel } from "@/components/switchboard/research-panel"

// ?research=<sessionId> is the Research window (dev iframe and localhost); ?research=demo plays a scripted run.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { research } = await searchParams
  const id = Array.isArray(research) ? research[0] : research
  return id ? <ResearchPanel sessionId={id} /> : <Switchboard />
}
