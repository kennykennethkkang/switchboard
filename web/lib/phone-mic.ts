/** The phone browser's own mic for Jarvis: MediaRecorder in the page, the clip posted to /hub/voice for whisper on the Mac. */

// Chrome records webm/opus, iOS Safari only mp4 (AAC); ffmpeg on the Mac takes either.
const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

/** The first type this browser records, or '' to let it choose. */
export const pickMime = (supported: (m: string) => boolean) => MIMES.find(m => { try { return supported(m) } catch { return false } }) ?? ''

export const PHONE_MIC_NOTE = 'Mic on the phone needs Tailscale HTTPS (admin console > DNS > HTTPS Certificates), then `tailscale serve --bg 3131`'

type Win = { isSecureContext?: boolean; MediaRecorder?: unknown; navigator?: { mediaDevices?: { getUserMedia?: unknown } } }

/** getUserMedia only exists in a secure context, so plain http over the LAN or a tailnet IP reads 'insecure'. */
export function phoneMic(w: Win | undefined): 'ok' | 'insecure' | 'none' {
  if (!w) return 'none'
  if (!w.isSecureContext) return 'insecure'
  return typeof w.MediaRecorder === 'function' && typeof w.navigator?.mediaDevices?.getUserMedia === 'function' ? 'ok' : 'none'
}

/** Posts the clip; the transcript, or a line saying why there is none. */
export async function sendClip(clip: Blob, f: typeof fetch = fetch): Promise<{ text: string } | { problem: string }> {
  try {
    const r = await f('/hub/voice', { method: 'POST', headers: { 'Content-Type': clip.type || 'audio/mp4' }, body: clip })
    if (!r.ok) return { problem: (await r.text().catch(() => '')) || `Could not transcribe (hub answered ${r.status}).` }
    const text = String(((await r.json()) as { text?: unknown }).text ?? '').trim()
    return text ? { text } : { problem: "Didn't catch that. Tap the mic to try again." }
  } catch (err) {
    return { problem: `Could not reach the Mac (${(err as Error).message}).` }
  }
}
