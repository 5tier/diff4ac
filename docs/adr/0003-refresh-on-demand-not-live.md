# Refresh is on demand, not live

The server watches the Repository and pushes change notifications, but the SPA only shows a "Repository changed, press r" banner and never re-renders the Change Set by itself. Agents change files continuously, and text that rewrites itself in the middle of a hunk makes reviewing impossible. The Reviewer chooses when the view moves, and that is the moment stale Review Marks lapse.
