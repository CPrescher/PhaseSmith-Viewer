# Local viewer preview

- Open the working viewer at `http://127.0.0.1:4216/` in the in-app browser. Never use the source `index.html` or a `file://` URL as the application preview: the viewer requires an HTTP server for its modules, workers and WebAssembly.
- Start the preview with `npm run preview`. This builds the viewer and documentation, then serves `dist/` on the fixed loopback port 4216. The strict port prevents silently opening a different origin and losing access to the user's saved session.
- Before starting a server, check whether port 4216 already serves this worktree's current build. Reuse it when current; otherwise replace only the server owned by this task. Preserve the user's stored structure and settings.
- After changes, update the served build and verify the rendered viewer. Open the browser URL through Codex's browser-panel tool, not the HTML file-panel tool. Use the same HTTP link in replies.
