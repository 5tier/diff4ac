# Bun is the runtime, not Node.js

diff4ac was first described as a Node.js tool, but the server runs on Bun (`Bun.serve`, `Bun.spawn` for git, Bun's file watcher), and Bun also does the building and testing. The intended users are our own team, who can easily install Bun, and using it removes the need for separate HTTP, process, watcher and test dependencies. As a result, plain Node users can't run the tool.

## Considered Options

- **Bun as tooling only, Node at runtime**: works anywhere Node is installed, but needs two toolchains and more dependencies.
- **`bun build --compile` single binary**: needs no runtime at all, but has to be built and published per platform. Kept as a possible later way to distribute the tool, not as a replacement for this decision.
