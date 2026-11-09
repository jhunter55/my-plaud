# My Plaud (PWA)

Share or record audio, get a transcript with speaker labels plus a templated summary from Gemini. Personal use, no backend.

## One-time setup

1. **API key:** create a free key at https://aistudio.google.com/apikey (this is separate from the Gemini AI Pro plan).
2. **Host it (HTTPS is required for install, mic and share-target):**
   - Create a GitHub repo, put these files at the root, and enable Pages (Settings, Pages, deploy from branch `main` / root).
   - Or use Cloudflare Pages / Netlify drag-and-drop with this folder.
3. On the Pixel, open the URL in Chrome, menu, **Install app**.
4. Open My Plaud, Settings: paste the key, tap **Load available models**, pick a Flash model, **Save**.

## Using it

- **From Pixel Recorder:** open a recording, Share, **My Plaud**. Choose a template, tap *Transcribe & summarize*.
- **Or** pick a file / tap Record in the app (keep the screen on while recording).
- Results save to Library (search, copy, download .md, share). Templates are editable in Settings.

## Notes

- Files over 15 MB go through the Gemini Files API; very long recordings (roughly 2h+) may exceed one response, so split them.
- Free-tier data may be used by Google to improve products. Avoid sensitive recordings, or enable billing on the key.
- The key and library live only in the phone's browser storage. Clearing site data erases them.
- Call recording is not possible from a web app; use the Phone app's built-in recording if available, then share the file here.

Local test: `python -m http.server 8765` in this folder, then open http://localhost:8765.
