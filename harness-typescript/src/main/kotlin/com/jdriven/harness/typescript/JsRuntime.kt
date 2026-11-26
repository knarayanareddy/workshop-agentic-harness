package com.jdriven.harness.typescript

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.ShellCommand
import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.SubAgentOutcome
import com.jdriven.harness.api.SubAgentRunner
import com.jdriven.harness.api.SubAgentSpec
import com.jdriven.harness.api.Workspace
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.graalvm.polyglot.Context
import org.graalvm.polyglot.PolyglotException
import org.graalvm.polyglot.Value
import org.graalvm.polyglot.proxy.ProxyArray
import org.graalvm.polyglot.proxy.ProxyExecutable
import org.graalvm.polyglot.proxy.ProxyObject
import java.nio.file.Path

/**
 * One GraalJS context holding one extension bundle. Values cross the boundary as JSON (a plain JS
 * object on one side, a kotlinx [JsonElement] on the other); only the workspace, `log`, `exec`
 * and `spawn` cross as live functions.
 *
 * GraalJS contexts are single-threaded, which matches the harness: one session, one turn at a time.
 */
internal class JsRuntime(val context: Context, val bundleName: String) {
    private val parse: Value = context.eval("js", "JSON.parse")
    private val stringify: Value = context.eval("js", "(v) => JSON.stringify(v === undefined ? null : v)")
    private val workspaces = mutableMapOf<Workspace, ProxyObject>()

    fun toJs(json: JsonElement): Value = parse.execute(json.toString())

    fun toJson(value: Value): JsonElement = Json.parseToJsonElement(stringify.execute(value).asString())

    /**
     * Calls into JS and unwraps a returned Promise. The embedded runtime has no event loop, but GraalJS
     * drains the microtask queue whenever control returns to the host, so `async` code that only awaits
     * other in-process work settles before [call] returns. A Promise waiting on anything else
     * (a timer, network I/O) never settles, and is reported as such.
     */
    fun call(what: String, block: () -> Value): Value {
        val value = try {
            block()
        } catch (e: PolyglotException) {
            throw TypeScriptExtensionException("$what threw: ${e.describe()}", e)
        }
        if (!value.hasMembers() || !value.canInvokeMember("then")) return value

        var settled = false
        var result: Value? = null
        var rejection: Value? = null
        value.invokeMember(
            "then",
            ProxyExecutable { args -> settled = true; result = args.firstOrNull(); null },
            ProxyExecutable { args -> settled = true; rejection = args.firstOrNull(); null },
        )
        if (!settled) {
            throw TypeScriptExtensionException(
                "$what returned a Promise that did not settle. The embedded JavaScript runtime has no event loop: " +
                    "setTimeout, fetch and Node.js APIs are unavailable. Use ctx.workspace for file access.",
            )
        }
        rejection?.let { throw TypeScriptExtensionException("$what rejected: ${describe(it)}") }
        return result ?: context.asValue(null)
    }

    fun workspace(ws: Workspace): ProxyObject = workspaces.getOrPut(ws) {
        ProxyObject.fromMap(
            mapOf(
                "root" to ws.root.toString(),
                "resolve" to fn { ws.resolve(it.string(0)).toString() },
                "contains" to fn { ws.contains(it.string(0)) },
                "relativize" to fn { ws.relativize(Path.of(it.string(0))) },
                "exists" to fn { ws.exists(it.string(0)) },
                "readText" to fn { ws.readText(it.string(0)) },
                "writeText" to fn { ws.writeText(it.string(0), it.string(1)); null },
                "list" to fn { ProxyArray.fromList(ws.list(if (it.isEmpty()) "." else it.string(0))) },
            ),
        )
    }

    /**
     * `ctx.exec(command)` for tools and the assembly: runs a shell command in the workspace root and
     * returns `{ exitCode, output, timedOut }` (see [ShellCommand]). Guardrails don't get it: they gate
     * commands, they do not run them.
     */
    fun exec(ws: Workspace): ProxyExecutable = fn { args ->
        val command = args.getOrNull(0)?.takeIf { it.isString }?.asString() ?: throw IllegalArgumentException("exec(command) needs a string")
        val result = ShellCommand.run(ws.root, command)
        ProxyObject.fromMap(
            mapOf("exitCode" to result.exitCode, "output" to result.output, "timedOut" to result.timedOut),
        )
    }

    /**
     * `ctx.spawn(command, log)` for tools: starts a shell command in the background and returns at once
     * (see [ShellCommand.spawn]). The JS engine has no threads, so the JVM does the waiting. [log] is a
     * workspace path, so it cannot escape the workspace.
     */
    fun spawn(ws: Workspace): ProxyExecutable = fn { args ->
        ShellCommand.spawn(ws.root, args.string(0), ws.resolve(args.string(1)))
        null
    }

    // ---- v2: reading the bundle's `runtime` declaration -------------------------------------------

    /** `runtime.mode`, or `default`. An unknown string is a bundle bug, so it fails at load time. */
    fun mode(declared: Value): String {
        val raw = declared.getMember("mode")?.takeIf { it.isString }?.asString() ?: return "default"
        val known = setOf("default", "plan", "acceptEdits")
        if (raw !in known) throw TypeScriptExtensionException("$bundleName runtime.mode is '$raw'; expected one of ${known.joinToString()}")
        return raw
    }

    /** `runtime.subAgents`: parsed and validated once, so a bad spec fails at load, not mid-turn. */
    fun subAgentSpecs(declared: Value?): List<SubAgentSpec> {
        if (declared == null) return emptyList()
        val arr = declared.getMember("subAgents")?.takeUnless { it.isNull } ?: return emptyList()
        if (!arr.hasArrayElements()) throw TypeScriptExtensionException("$bundleName runtime.subAgents must be an array")
        val specs = (0 until arr.arraySize).map { specOf(arr.getArrayElement(it)) }
        val names = specs.map { it.name }
        val duplicate = names.groupingBy { it }.eachCount().filterValues { it > 1 }.keys
        if (duplicate.isNotEmpty()) throw TypeScriptExtensionException("$bundleName declares duplicate sub-agents: $duplicate")
        return specs
    }

    /**
     * `runtime.approveEdits(tool, input)`. Only the loop calls this, and only for a call the guardrails
     * already decided to ask about, so it can loosen an ASK and nothing else.
     */
    fun approveEdits(declared: Value, tool: Tool, input: ToolInput): Boolean {
        val fn = declared.getMember("approveEdits")?.takeIf { it.canExecute() } ?: return false
        // A non-boolean answer is treated as "no": the loop then asks, which is the safe direction.
        val verdict = call("runtime.approveEdits") { fn.execute(tool.name, toJs(input.json)) }
        if (!verdict.isBoolean) {
            throw TypeScriptExtensionException("$bundleName runtime.approveEdits must return a boolean")
        }
        return verdict.asBoolean()
    }

    /**
     * The system prompt for one delegated run. It is built here rather than in JS so the child's prompt
     * cannot contain the parent's role text: a sub-agent has its own, and that is the isolation claim.
     */
    fun subAgentPrompt(spec: SubAgentSpec): List<SystemPromptSection> {
        // A child's prompt is its role ONLY. The parent's sections never reach it, because the transcript
        // and the prompt are the two things a sub-agent must not inherit.
        return listOf(
            SystemPromptSection.Static(
                "sub_agent_role",
                "You are the ${spec.name} sub-agent: ${spec.description}. " +
                    "You cannot ask the user anything, and you cannot change anything you were not asked to. " +
                    "Answer in under 120 words, with the specifics asked for and no preamble.",
            ),
        )
    }

    /**
     * `ctx.delegate(spec, prompt)` for tools: runs a sub-agent through [runner] and returns
     * `{ kind: "completed" | "failed", ... }` (see `SubAgentOutcome` in harness.ts).
     *
     * The spec crosses as plain JSON, so the JVM re-reads it here rather than trusting a live JS object:
     * a bundle cannot hand the loop a spec that changes while the sub-agent runs. A malformed spec is a
     * tool failure, not an exception the model cannot act on.
     */
    fun delegate(runner: (SubAgentSpec) -> SubAgentRunner?): ProxyExecutable = fn { args ->
        val spec = try {
            specOf(args.firstOrNull() ?: throw TypeScriptExtensionException("delegate(spec, prompt) needs a spec"))
        } catch (e: TypeScriptExtensionException) {
            return@fn ProxyObject.fromMap(mapOf("kind" to "failed", "reason" to "invalid sub-agent spec: ${e.message}"))
        }
        val prompt = args.getOrNull(1)?.takeIf { it.isString }?.asString() ?: ""
        val agent = runner(spec)
            ?: return@fn ProxyObject.fromMap(
                mapOf("kind" to "failed", "reason" to "no runner for sub-agent '${spec.name}': this bundle declared it but the harness cannot run it"),
            )
        when (val outcome = agent.run(prompt)) {
            is SubAgentOutcome.Completed -> ProxyObject.fromMap(
                mapOf("kind" to "completed", "text" to outcome.text, "calls" to outcome.calls, "iterations" to outcome.iterations),
            )
            is SubAgentOutcome.Failed -> ProxyObject.fromMap(mapOf("kind" to "failed", "reason" to outcome.reason))
        }
    }

    /** Reads a [SubAgentSpec] out of plain JSON, with the defaults and checks the loop relies on. */
    private fun specOf(value: Value): SubAgentSpec {
        if (!value.hasMembers()) throw TypeScriptExtensionException("a sub-agent spec must be an object")
        fun text(member: String): String? = value.getMember(member)?.takeIf { it.isString }?.asString()
        val name = text("name")?.takeIf { it.isNotBlank() } ?: throw TypeScriptExtensionException("spec.name is required")
        val description = text("description") ?: ""
        val toolsMember = value.getMember("tools") ?: throw TypeScriptExtensionException("spec.tools is required")
        if (!toolsMember.hasArrayElements()) throw TypeScriptExtensionException("spec.tools must be an array")
        val tools = (0 until toolsMember.arraySize).map {
            val t = toolsMember.getArrayElement(it)
            if (!t.isString) throw TypeScriptExtensionException("spec.tools must contain strings")
            t.asString()
        }
        val iterations = value.getMember("maxIterations")?.takeIf { it.fitsInInt() }?.asInt() ?: 6
        // A budget of 0 would make every sub-agent fail immediately; refuse it here rather than in the loop.
        if (iterations < 1) throw TypeScriptExtensionException("spec.maxIterations must be at least 1")
        return SubAgentSpec(name, description, tools, iterations)
    }

    /**
     * The `shell` global that `@harness/api` exports: the shell `ctx.exec` runs and its limits, so the
     * TypeScript run_command describes the same [ShellCommand] as the Java and Kotlin ones.
     */
    fun shell(): ProxyObject = ProxyObject.fromMap(
        mapOf("name" to ShellCommand.SHELL, "timeoutSeconds" to ShellCommand.TIMEOUT_SECONDS, "maxOutput" to ShellCommand.MAX_OUTPUT),
    )

    fun log(emit: (AgentEvent) -> Unit, runId: String, source: String): ProxyExecutable =
        fn { args -> emit(AgentEvent.Log(runId, source = source, message = args.joinToString(" ") { v -> if (v.isString) v.asString() else v.toString() })); null }

    private fun fn(body: (Array<Value>) -> Any?) = ProxyExecutable { args -> body(args) }

    private fun Array<Value>.string(i: Int): String {
        val v = getOrNull(i) ?: throw IllegalArgumentException("missing argument ${i + 1}")
        require(v.isString) { "argument ${i + 1} must be a string" }
        return v.asString()
    }

    private fun describe(v: Value): String =
        if (v.hasMember("message")) v.getMember("message").toString() else v.toString()

    private fun PolyglotException.describe(): String =
        if (isHostException) asHostException().let { it.message ?: it::class.java.simpleName } else message ?: "unknown error"
}

class TypeScriptExtensionException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
