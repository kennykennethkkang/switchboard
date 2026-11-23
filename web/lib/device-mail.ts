// Draft for mailing the device link to yourself. Built in the browser; the link never goes to a server.
export const MAIL_KEY = 'sb-device-mail'

// Plain shape check, not full RFC: one @, no spaces, a dot in the domain.
export const validEmail = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s.trim())

/** The mailto: URL, or undefined when the address is bad or there is no link. */
export function deviceMailto(email: string, link: string | undefined): string | undefined {
  if (!link || !validEmail(email)) return undefined
  const subject = 'Switchboard on this device'
  const body = `Install Tailscale, sign in with the same account, then open this link:\n\n${link}`
  return `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
