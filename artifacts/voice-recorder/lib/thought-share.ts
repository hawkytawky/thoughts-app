import {
  type FeaturedNote,
  formatDuration,
  formatNoteDate,
} from "@/lib/featured-note";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildThoughtPdfHtml(note: FeaturedNote): string {
  const date = formatNoteDate(note.recordedAt, true);
  const metadata = [date, note.locationLabel, formatDuration(note.durationSeconds)]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const transcript = note.transcript.text.trim();

  return `<!DOCTYPE html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>thought · ${escapeHtml(date)}</title>
    <style>
      @page { size: 390px 700px; margin: 24px 22px 28px; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #1C221A;
        background: #F4F1E9;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 14.5px;
        line-height: 1.72;
        -webkit-print-color-adjust: exact;
      }
      .topline { height: 6px; margin: -24px -22px 24px; background: #6E4A61; }
      .masthead {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 11px;
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
      }
      .brand { color: rgba(28,34,26,.62); font-size: 12px; font-weight: 400; }
      .label {
        color: #6E4A61;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 1.8px;
        text-transform: uppercase;
      }
      .meta {
        margin-bottom: 28px;
        color: rgba(28,34,26,.42);
        font-size: 10.5px;
        font-style: italic;
      }
      .transcript {
        color: rgba(28,34,26,.82);
        white-space: pre-wrap;
      }
      .signoff {
        margin-top: 28px;
        padding-top: 14px;
        border-top: .5px solid #DCD7C9;
        color: rgba(28,34,26,.42);
        font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
        font-size: 9px;
      }
      .dot {
        display: inline-block;
        width: 5px;
        height: 5px;
        margin-right: 6px;
        border-radius: 50%;
        background: #6E4A61;
      }
    </style>
  </head>
  <body>
    <div class="topline"></div>
    <header class="masthead">
      <span class="brand">thoughts</span>
      <span class="label">transkript</span>
    </header>
    <div class="meta">${metadata}</div>
    <main class="transcript">${escapeHtml(transcript)}</main>
    <footer class="signoff"><span class="dot"></span>a thought, captured with thoughts</footer>
  </body>
</html>`;
}
