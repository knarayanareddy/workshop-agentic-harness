package com.jdriven.harness.typescript

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.ShellCommand
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
