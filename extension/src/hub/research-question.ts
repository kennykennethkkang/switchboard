export const ADDS_MARKER = /^\[adds to research: ([^\]\r\n]+)\]$/m
export const researchTarget = (text: string) => text.match(ADDS_MARKER)?.[1]
export const stripResearchInstructions = (text: string) => text.replace(/\n?\[adds to research: [^\]\r\n]+\][\s\S]*$/m, '').trim()
/** The title of a part Ask more added (addToResearch writes it, the Research page reads it): date, question. */
export const ADDED = /^Added (\d{4}-\d{2}-\d{2}): (.*)$/
