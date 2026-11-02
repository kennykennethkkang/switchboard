/** The mic's transcript after whatever is in the box, so a second tap carries on the same question. */
export const appendHeard = (draft: string, text: string) => (draft.trim() ? `${draft.trimEnd()} ${text}` : text)

/** Only the view whose tap started the recording takes its transcript; tappedAt is cleared once taken. */
export const takesHeard = (heard: { text: string; at: number } | null | undefined, tappedAt: number | undefined) => !!heard && tappedAt !== undefined && heard.at > tappedAt

/** Deleting the spoken words and typing makes it a typed question again, with no reply read out. */
export const stillSpoken = (draft: string, last: string | undefined) => !!last && draft.includes(last)
