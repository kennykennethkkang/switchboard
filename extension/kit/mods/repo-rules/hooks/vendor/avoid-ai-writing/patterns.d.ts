// Types for the parts of patterns.js that repo-rules reads. See LICENSE.
export interface Issue { type: string; text: string; severity: 'critical' | 'high' | 'medium' | 'low'; suggestion?: string }
export interface Analysis { score: number; label: string; issues: Issue[] }
declare const AIDetector: { analyzeText(text: string, options?: { contextMode?: 'general' | 'technical' | 'marketing' | 'personal'; sourceMode?: 'plain' | 'rendered-markdown' }): Analysis }
export default AIDetector
