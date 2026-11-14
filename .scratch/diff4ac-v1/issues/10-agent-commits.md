# 10: Agent Commits

**What to build:** diff4ac recognises Agent Commits from commit trailers (such as `Co-Authored-By`) and author name or email patterns, with built-in patterns for Claude Code, Codex and Copilot that config can extend. Agent Commits carry a 🤖 badge naming the Agent, and the Reviewer can filter to one Agent's commits.

**Blocked by:** 02, 08

**Status:** done

- [x] Built-in patterns recognise Claude Code, Codex and Copilot commits
- [x] Config can add patterns (trailer or author regexes mapped to an Agent name)
- [x] Agent Commits show a 🤖 badge with the Agent's name in the Commits panel
- [x] The Reviewer can filter commits to a single Agent, and the Selection and Change Set update accordingly
- [x] Fixture tests cover trailer detection, author-pattern detection, custom patterns and human commits
