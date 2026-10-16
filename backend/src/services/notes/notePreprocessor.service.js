'use strict';

// ── Urdu/Arabic script stripper ───────────────────────────────────────────────
// Fireflies ASR sometimes misidentifies spoken Hindi as Urdu and transcribes the
// first few minutes of a meeting in Arabic script (Unicode U+0600–U+06FF).
// Hindi and Urdu are the same spoken language — the content always reappears in
// Hindi/English later in the transcript, so stripping Urdu-dominant lines loses
// no information and prevents llama3.1/3.3 from seeing unreadable Arabic characters.
//
// Threshold: if >30% of non-whitespace characters in a line are Arabic-script,
// the line is dropped. This avoids stripping lines that merely contain an Arabic
// word or name alongside mostly-Latin/Devanagari text.
const ARABIC_SCRIPT_RE = /[؀-ۿ]/g;

function stripUrduLines(text) {
  return text
    .split('\n')
    .filter((line) => {
      // For Fireflies-format lines ("Speaker Name: content") check the CONTENT
      // portion only — speaker names are ASCII and dilute the Arabic ratio so that
      // short Urdu filler like "Rakesh Patel: جی۔" (ratio 3/15 = 0.2) incorrectly
      // survives the 0.3 threshold even though it is pure Urdu.
      // Stripping the speaker prefix first gives the true content ratio.
      const colonIdx = line.indexOf(': ');
      const content  = colonIdx >= 0 ? line.slice(colonIdx + 2) : line;
      const stripped = content.replace(/\s/g, '');
      if (!stripped) return true; // keep blank lines (re-collapsed later)
      const arabicCount = (stripped.match(ARABIC_SCRIPT_RE) || []).length;
      return arabicCount / stripped.length < 0.3;
    })
    .join('\n');
}

// Section boundary: a short line (≤50 chars total) ending with a colon,
// optionally preceded by a number+dot ("1. Action Items:").
// Catches ALL-CAPS ("ACTION ITEMS:"), Title-Case ("Action Items:"),
// and numbered variants ("2. Decisions:") so MoM files in any format
// are correctly segmented without falling to Mode D.
const SECTION_BOUNDARY = /\n(?:\d+\.\s*)?[A-Z][A-Za-z\s\-]{1,48}:[ \t]*\n/;
const BOUNDARY_STR     = SECTION_BOUNDARY.source;

// Each pattern optionally allows a leading "1. " numbering prefix before the
// heading keyword. The 'i' flag handles mixed-case ("summary" / "Summary" / "SUMMARY").
const SECTION_PATTERNS = {
  summary:     new RegExp(`(?:\\d+\\.\\s*)?(?:summary|overview|executive\\s+summary)[:\\s]*\\n([\\s\\S]*?)(?=${BOUNDARY_STR}|$)`, 'i'),
  actionItems: new RegExp(`(?:\\d+\\.\\s*)?(?:action\\s+items?|actions?|to[-\\s]?do)[:\\s]*\\n([\\s\\S]*?)(?=${BOUNDARY_STR}|$)`, 'i'),
  decisions:   new RegExp(`(?:\\d+\\.\\s*)?(?:decisions?\\s+taken?|key\\s+decisions?|decisions?)[:\\s]*\\n([\\s\\S]*?)(?=${BOUNDARY_STR}|$)`, 'i'),
  risks:       new RegExp(`(?:\\d+\\.\\s*)?(?:risks?\\s+discussed?|risks?|issues?)[:\\s]*\\n([\\s\\S]*?)(?=${BOUNDARY_STR}|$)`, 'i'),
  followUp:    new RegExp(`(?:\\d+\\.\\s*)?(?:follow[-\\s]?up\\s*(?:actions?)?|next\\s+steps?)[:\\s]*\\n([\\s\\S]*?)(?=${BOUNDARY_STR}|$)`, 'i'),
};

const notePreprocessorService = {
  process(rawText) {
    let text = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^Page \d+\s*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Strip Urdu/Arabic-script lines before sending to Ollama.
    // Fireflies sometimes misidentifies spoken Hindi as Urdu for the first few minutes.
    text = stripUrduLines(text).replace(/\n{3,}/g, '\n\n').trim();

    const sections = {};
    for (const [key, pattern] of Object.entries(SECTION_PATTERNS)) {
      const match = text.match(pattern);
      if (match) sections[key] = match[1].trim();
    }

    return {
      cleanText: text,
      sections,
      charCount: text.length,
    };
  },
};

module.exports = notePreprocessorService;
