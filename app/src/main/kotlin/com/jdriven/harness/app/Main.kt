package com.jdriven.harness.app

import com.jdriven.harness.api.ExtensionBundle
import com.jdriven.harness.api.Workspace
import com.jdriven.harness.core.*
import com.jdriven.harness.extensions.java.JavaExtensions
import com.jdriven.harness.extensions.kotlin.KotlinExtensions
import com.jdriven.harness.typescript.TypeScriptExtensionException
import com.jdriven.harness.typescript.TypeScriptExtensions
import java.awt.Desktop
import java.io.IOException
import kotlin.io.path.Path
import kotlin.io.path.exists
import kotlin.system.exitProcess

private val EXIT_COMMANDS = setOf("exit", "quit", "/exit", "/quit")
private const val LANGUAGE_ENV = "HARNESS_LANGUAGE"
/** v2 is opt-in. The workshop teaches v1; `HARNESS_V2=1` swaps in the v2 TypeScript bundle. */
private const val V2_ENV = "HARNESS_V2"
/**
 * v2 — the permission mode. `acceptEdits` skips the approval prompt for file edits the policy merely
 * asks about; denials still apply. Only meaningful with HARNESS_V2=1.
 */
private const val MODE_ENV = "HARNESS_MODE"

/**
 * §7 Assembly. This file is the whole agent: it picks the bundle that lists every section of the system prompt,
 * every tool and guardrail, in order, and wires it to the model. Nothing registers itself.
 */
fun main(args: Array<String>) {
    val workspace = LocalWorkspace(Path(args.firstOrNull() ?: "workspace"))
    val input = System.`in`.bufferedReader()

    // HARNESS_LANGUAGE picks the language you work in. Each bundle is a complete agent on its own: the whole
    // system prompt, tools, guardrails and trace, so only one is used (the tool names would clash).
    val language = harnessLanguage()

    val extensionsBundle = when (language) {
        Language.JAVA -> JavaExtensions.bundle(workspace)
        Language.KOTLIN -> KotlinExtensions.bundle(workspace)
        Language.TYPESCRIPT -> loadTypeScript(workspace)
    }

    // One Agent is one session; /clear starts a new one. The recorder collects what /report shows.
    lateinit var recorder: SessionRecorder
    fun newSession(): Agent {
        val client = OpenAiModelClient()
        recorder = SessionRecorder(client.model, workspace.root, extensionsBundle.systemPrompt)
        return Agent(
            model = client,
            systemPrompt = extensionsBundle.systemPrompt,
            tools = extensionsBundle.tools,
            guardrails = extensionsBundle.guardrails,
            approvalHandler = ConsoleApprovalHandler(input),
            listeners = extensionsBundle.listeners + recorder,
            workspace = workspace,
            runtime = extensionsBundle.runtime,
        )
    }
    var agent = newSession()

    Splash.play()
    println(Ansi.bold("Agentic harness") + " - workspace: " + Ansi.cyan(workspace.root.toString()) + " - extensions: " + Ansi.cyan(language.envValue))
    println(Ansi.dim("Type a task, '/clear', '/report' or 'exit'. Each line is one turn; the session keeps its history.") + "\n")
    while (true) {
        print(Ansi.bold(Ansi.cyan("> ")))
        System.out.flush()
        val line = input.readLine()?.trim() ?: break
        if (line in EXIT_COMMANDS) break
        if (line.isEmpty()) continue
        if (line == "/clear") {
            agent = newSession()
            println(Ansi.dim("Session cleared.") + "\n")
            continue
        }
        if (line == "/report") {
            try {
                val file = recorder.writeReport(agent.messages, Path("reports")).toAbsolutePath()
                println(Ansi.dim("Report written to ") + Ansi.cyan(file.toString()) + "\n")
                openInBrowser(file)
            } catch (e: IOException) {
                println("\n${Ansi.red("[error] could not write the report: ${e.message}")}\n")
            }
            continue
        }
        try {
            when (val result = agent.run(line)) {
                is AgentResult.Completed -> println("\n${Ansi.green(result.text)}\n")
                is AgentResult.Aborted -> println("\n${Ansi.yellow("[aborted] ${result.reason}")}\n")
                is AgentResult.LimitReached -> println("\n${Ansi.yellow("[limit reached] ${result.limit}")}\n")
            }
        } catch (e: Exception) {
            println("\n${Ansi.red("[error] ${e::class.simpleName}: ${e.message}")}\n")
            if ("failed (401)" in e.message.orEmpty()) {
                println(Ansi.dim("Set MODEL_API_KEY, then restart.") + "\n")
            }
        }
    }
}

private enum class Language(val envValue: String) { JAVA("java"), KOTLIN("kotlin"), TYPESCRIPT("typescript") }

/** Reads HARNESS_LANGUAGE; Java when it is not set. */
private fun harnessLanguage(): Language {
    val value = System.getenv(LANGUAGE_ENV)?.trim()?.lowercase()?.ifEmpty { null } ?: return Language.JAVA
    return Language.entries.firstOrNull { it.envValue == value } ?: run {
        println(Ansi.red("[error] $LANGUAGE_ENV=$value is not supported; use one of ${Language.entries.joinToString { it.envValue }}"))
        exitProcess(1)
    }
}

/**
 * v2 is TypeScript-only for now: the policy engine, skills, compaction and audit are all extensions,
 * and only the TypeScript module has them. Choosing v2 with another language is a clear error rather
 * than a silently v1 session.
 */
private fun loadTypeScript(workspace: Workspace): ExtensionBundle {
    val v2 = System.getenv(V2_ENV)?.trim()?.let { it == "1" || it.equals("true", ignoreCase = true) } ?: false
    val language = harnessLanguage()
    if (v2 && language != Language.TYPESCRIPT) {
        println(Ansi.red("[error] $V2_ENV=1 needs $LANGUAGE_ENV=typescript (v2 extensions exist only in TypeScript); got ${language.envValue}"))
        exitProcess(1)
    }
    val bundle = Path(if (v2) "extensions/typescript/dist/extension-v2.js" else "extensions/typescript/dist/extension.js")
    val howToBuild = "start the harness with `./gradlew :app:run`, which builds it and shows any TypeScript errors"
    if (!bundle.exists()) {
        println(Ansi.red("[error] $bundle not found - the TypeScript build has not run or has failed; $howToBuild"))
        exitProcess(1)
    }
    if (v2) {
        val mode = System.getenv(MODE_ENV)?.trim()?.lowercase()?.ifEmpty { null }
        if (mode != null && mode !in setOf("default", "plan", "acceptEdits")) {
            println(Ansi.red("[error] $MODE_ENV=$mode is not supported; use default, plan or acceptEdits"))
            exitProcess(1)
        }
        val extras = listOfNotNull(mode?.let { "mode: $it" }, "delegation: explorer")
        println(Ansi.dim("v2 extensions: policy as data, argv runner, skills, compaction, audit, ${extras.joinToString()}"))
    }
    return try {
        TypeScriptExtensions.load(bundle, workspace)
    } catch (e: TypeScriptExtensionException) {
        println(Ansi.red("[error] the TypeScript extensions failed to load: ${e.message}"))
        exitProcess(1)
    }
}

/** Best effort: there is no browser to open on a headless machine, and the path is printed anyway. */
private fun openInBrowser(file: java.nio.file.Path) {
    runCatching {
        if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) Desktop.getDesktop().browse(file.toUri())
    }
}

/**
 * ANSI colors for REPL output. NO_COLOR turns them off and FORCE_COLOR turns them on; otherwise they are on when
 * attached to a terminal, or when `./gradlew run` forwards our piped output to one (TERM set, not dumb, not CI).
 */
private object Ansi {
    private val enabled = when {
        !System.getenv("NO_COLOR").isNullOrEmpty() -> false
        System.getenv("FORCE_COLOR").let { !it.isNullOrEmpty() && it != "0" } -> true
        System.console()?.isTerminal == true -> true
        else -> System.getenv("TERM").let { !it.isNullOrEmpty() && it != "dumb" } && System.getenv("CI") == null
    }

    private fun wrap(code: String, text: String) = if (enabled) "\u001b[${code}m$text\u001b[0m" else text

    fun bold(text: String) = wrap("1", text)
    fun dim(text: String) = wrap("2", text)
    fun red(text: String) = wrap("31", text)
    fun green(text: String) = wrap("32", text)
    fun yellow(text: String) = wrap("33", text)
    fun cyan(text: String) = wrap("36", text)
}
