# Agentic harness — workshop

> **Taking the workshop? Open [`workshop.html`](workshop.html) in your browser and start there.**
> It walks you through the setup and every assignment. You don't need anything else from this README.

This repository holds a small coding-agent harness in Kotlin, built to be extended. In the workshop you add
tools, guardrails and system prompt sections in Kotlin, Java or TypeScript, and watch in the trace what each
one costs.

## Opening the workshop

After cloning, open `workshop.html` from the repository root in any browser (double-click it, or drag it into
a browser window). It is a single self-contained page; no server needed.

The slides are in [`presentation/index.html`](presentation/index.html), opened the same way.

## For maintainers

- `./gradlew build` compiles everything and runs the tests (Kotlin, Java and the TypeScript vitest suite);
  no API key needed. It needs JDK 17+ to run Gradle; Gradle provides JDK 25 and Node.js itself.
- `./gradlew verifySetup` sends one small request to the model, to check `MODEL_API_KEY`, endpoint and network.
- `./gradlew :app:run -q --console=plain` starts the harness on `workspace/`.
- `./build-package.sh` (or `build-package.cmd`) builds a standalone package with its own Java runtime via Docker,
  for participants without a JDK.

```
harness-api/          the contract: Kotlin interfaces + typescript/harness.ts
harness-core/         the loop and the OpenAI-compatible model client
harness-typescript/   runs TypeScript bundles inside the JVM (GraalJS)
app/                  Main.kt: assembles the agent
extensions/{kotlin,java,typescript}/
                      one complete agent per language: defaults/ and exercise/ per extension point, plus helpers/
workspace/            the agent's sandbox directory (OpenRA and the toolbox live here)
packaging/            launchers for the standalone package
Dockerfile            builds the standalone package
workshop.html         the workshop, step by step
presentation/         the slides (reveal.js)
```
