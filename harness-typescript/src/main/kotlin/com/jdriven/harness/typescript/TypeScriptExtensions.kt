package com.jdriven.harness.typescript

import com.jdriven.harness.api.*
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.graalvm.polyglot.Context
import org.graalvm.polyglot.HostAccess
import org.graalvm.polyglot.Source
import org.graalvm.polyglot.Value
import java.nio.file.Path
import kotlin.io.path.name

/**
 * Loads extensions written in TypeScript. The TS project is bundled by esbuild into one IIFE script
 * that assigns its default export (see `defineExtension` in harness.ts) to [GLOBAL_NAME]; this class
 * evaluates it in GraalJS and adapts every member to the Kotlin contract.
 */
object TypeScriptExtensions {
    const val GLOBAL_NAME = "__harnessExtension"

    /** Where the bundle finds `shell` (see [JsRuntime.shell]); harness.ts reads it. */
    const val SHELL_GLOBAL = "__harnessShell"

    /**
     * [workspace] is the assembly context (`AssemblyContext` in harness.ts), handed to the
     * extension's default export, a function that builds the extension.
     */
    fun load(bundleFile: Path, workspace: Workspace): ExtensionBundle {
        val source = Source.newBuilder("js", bundleFile.toFile()).build()
        return load(source, bundleFile.name, workspace)
    }

    /** For tests: load from a JS source string that assigns `globalThis.__harnessExtension`. */
    internal fun loadScript(script: String, workspace: Workspace): ExtensionBundle =
        load(Source.newBuilder("js", script, "inline.js").buildLiteral(), "inline.js", workspace)

    private fun load(source: Source, name: String, workspace: Workspace): ExtensionBundle {
        val context = Context.newBuilder("js")
            .allowHostAccess(HostAccess.NONE)          // JS sees only what we hand it explicitly
            .option("engine.WarnInterpreterOnly", "false")
            .build()
        Runtime.getRuntime().addShutdownHook(Thread {
            context.close(true)
        })
        try {
            val runtime = JsRuntime(context, name)
            context.getBindings("js").putMember(SHELL_GLOBAL, runtime.shell())
            context.eval(source)
            val global = context.getBindings("js").getMember(GLOBAL_NAME)
                ?: throw TypeScriptExtensionException("$name did not define $GLOBAL_NAME — was it bundled with --global-name=$GLOBAL_NAME?")
            val export = global.takeIf { it.hasMember("default") }?.getMember("default") ?: global
            if (!export.canExecute()) throw TypeScriptExtensionException("$name: the default export must be a function (ctx) => extension")
            val ext = runtime.call("$name default export") { export.execute(assemblyContext(runtime, workspace)) }
            return Adapter(runtime).bundle(ext)
        } catch (e: Exception) {
            context.close()
            throw e
        }
    }

    /**
     * `{ workspace, exec }`: the live workspace, and the shell that sections built at assembly use to
     * look around (`git status`), like `ShellCommand.run` in Java and Kotlin.
     */
    private fun assemblyContext(rt: JsRuntime, workspace: Workspace): Value {
        val ctx = rt.toJs(JsonObject(emptyMap()))
        ctx.putMember("workspace", rt.workspace(workspace))
        ctx.putMember("exec", rt.exec(workspace))
        return ctx
    }

    private class Adapter(private val rt: JsRuntime) {
        private val bundleName = rt.bundleName

        fun bundle(ext: Value) = ExtensionBundle(
            systemPrompt = ext.array("systemPrompt").mapIndexed { i, v -> section(v, "$bundleName systemPrompt[$i]") },
            tools = ext.array("tools").mapIndexed { i, v -> tool(v, "$bundleName tools[$i]") },
            guardrails = ext.array("guardrails").mapIndexed { i, v -> guardrail(v, "$bundleName guardrails[$i]") },
            listeners = ext.array("listeners").mapIndexed { i, v -> listener(v, "$bundleName listeners[$i]") },
        )

        private fun section(v: Value, what: String): SystemPromptSection {
            val name = v.string("name", what)
            return when (val kind = v.string("kind", what)) {
                "static" -> SystemPromptSection.Static(name, v.string("text", what))
                "dynamic" -> {
                    val render = v.getMember("render")?.takeIf { it.canExecute() } ?: throw TypeScriptExtensionException("$what: 'render' must be a function")
                    SystemPromptSection.Dynamic(name) { ctx ->
                        val result = rt.call("section '$name'.render") { render.execute(turnContext(ctx)) }
                        when {
                            result.isNull -> null
                            result.isString -> result.asString()
                            else -> throw TypeScriptExtensionException("section '$name'.render must return a string or null")
                        }
                    }
                }
                else -> throw TypeScriptExtensionException("$what: unknown kind '$kind' (expected static | dynamic)")
            }
        }

        private fun tool(v: Value, what: String): Tool {
            val name = v.string("name", what)
            val description = v.string("description", what)
            val schema = rt.toJson(v.getMember("inputSchema") ?: throw TypeScriptExtensionException("$what: missing inputSchema"))
            if (schema !is JsonObject) throw TypeScriptExtensionException("$what: inputSchema must be an object")
            if (!v.canInvokeMember("execute")) throw TypeScriptExtensionException("$what: missing execute()")
            return object : Tool {
                override val name = name
                override val description = description
                override val inputSchema = JsonSchema(schema)
                override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
                    val result = rt.call("tool '$name'.execute") { v.invokeMember("execute", rt.toJs(input.json), toolContext(ctx)) }
                    return JsonCodec.decodeOutcome(rt.toJson(result), "tool '$name' result")
                }
            }
        }

        private fun guardrail(v: Value, what: String): Guardrail {
            val name = v.string("name", what)
            // Optional hooks: a missing method means the default decision.
            fun hook(hook: String, vararg args: () -> Any): JsonElement? =
                if (!v.canInvokeMember(hook)) null
                else rt.toJson(rt.call("guardrail '$name'.$hook") { v.invokeMember(hook, *args.map { it() }.toTypedArray()) })

            return object : Guardrail {
                override val name = name

                override fun beforeInference(ctx: TurnContext): InferenceDecision =
                    hook("beforeInference", { turnContext(ctx) })
                        ?.let { JsonCodec.decodeInferenceDecision(it, "guardrail '$name'.beforeInference") }
                        ?: InferenceDecision.Proceed

                override fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision =
                    hook("beforeToolUse", { rt.toJs(JsonCodec.toolCall(call)) }, { turnContext(ctx) })
                        ?.let { JsonCodec.decodeToolDecision(it, "guardrail '$name'.beforeToolUse") }
                        ?: ToolDecision.Allow

                override fun afterToolUse(call: ToolCall, result: ToolOutcome, ctx: TurnContext): ResultDecision =
                    hook("afterToolUse", { rt.toJs(JsonCodec.toolCall(call)) }, { rt.toJs(JsonCodec.outcome(result)) }, { turnContext(ctx) })
                        ?.let { JsonCodec.decodeResultDecision(it, "guardrail '$name'.afterToolUse") }
                        ?: ResultDecision.Accept

                override fun beforeEndTurn(ctx: TurnContext): TurnDecision =
                    hook("beforeEndTurn", { turnContext(ctx) })
                        ?.let { JsonCodec.decodeTurnDecision(it, "guardrail '$name'.beforeEndTurn") }
                        ?: TurnDecision.AllowEnd
            }
        }

        private fun listener(v: Value, what: String): AgentEventListener {
            if (!v.canExecute()) throw TypeScriptExtensionException("$what: a listener must be a function (event) => void")
            return AgentEventListener { event -> rt.call("listener $what") { v.execute(rt.toJs(JsonCodec.event(event))) } }
        }

        private fun turnContext(ctx: TurnContext): Value =
            rt.toJs(JsonCodec.turnContext(ctx)).also { it.putMember("workspace", rt.workspace(ctx.workspace)) }

        private fun toolContext(ctx: ToolContext): Value = rt.toJs(
            JsonObject(
                mapOf(
                    "runId" to JsonPrimitive(ctx.runId),
                    "iteration" to JsonPrimitive(ctx.iteration),
                    "toolUseId" to JsonPrimitive(ctx.toolUseId),
                ),
            ),
        ).also {
            it.putMember("workspace", rt.workspace(ctx.workspace))
            it.putMember("log", rt.log(ctx.events::emit, ctx.runId, "ts:${ctx.toolUseId}"))
            it.putMember("exec", rt.exec(ctx.workspace))
            it.putMember("spawn", rt.spawn(ctx.workspace))
        }

        private fun Value.array(member: String): List<Value> {
            val v = getMember(member) ?: return emptyList()
            if (v.isNull) return emptyList()
            if (!v.hasArrayElements()) throw TypeScriptExtensionException("$bundleName: '$member' must be an array")
            return (0 until v.arraySize).map { v.getArrayElement(it) }
        }

        private fun Value.string(member: String, what: String): String =
            getMember(member)?.takeIf { it.isString }?.asString() ?: throw TypeScriptExtensionException("$what: '$member' must be a string")
    }
}
