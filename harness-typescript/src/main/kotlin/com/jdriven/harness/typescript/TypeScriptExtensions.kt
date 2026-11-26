package com.jdriven.harness.typescript

import com.jdriven.harness.api.*
import com.jdriven.harness.core.OpenAiModelClient
import com.jdriven.harness.core.SubAgentLoops
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

    /**
     * v2 — the model a delegated run uses. Null when no API key is configured, and then delegation is
     * reported as unavailable rather than attempted. A sub-agent needs its own conversation: one session
     * is one transcript, and the child's is not the parent's.
     */
    private fun defaultModel(): ModelClient? {
        if (System.getenv("MODEL_API_KEY").isNullOrBlank()) return null
        // A key being present is not enough: the client must be constructible, and a test that never
        // cleared an injected model must not reach the network by accident.
        return runCatching { OpenAiModelClient() }
            .onFailure { System.err.println("[warn] delegation is unavailable: the model client could not be created (${it.message})") }
            .getOrNull()
    }

    /** Where the bundle finds `shell` (see [JsRuntime.shell]); harness.ts reads it. */
    const val SHELL_GLOBAL = "__harnessShell"

    /** Set by [useModel]: for tests, so a delegated run never needs an API key or the network. */
    @Volatile
    private var injectedModel: ModelClient? = null

    /** Makes delegated runs use [client] instead of the API-backed one. Null restores the default. */
    internal fun useModel(client: ModelClient?) {
        injectedModel = client
    }

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
            // Resolved once per load: a sub-agent gets a new conversation, not a new HTTP client.
            return Adapter(runtime, workspace, injectedModel ?: defaultModel()).bundle(ext)
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

    private class Adapter(private val rt: JsRuntime, private val workspace: Workspace, private val model: ModelClient?) {
        private val bundleName = rt.bundleName

        // Filled in by bundle(): the pieces a delegated run needs, so the runner factory and the
        // `delegate` capability share one path instead of two that could drift apart.
        private var declaredAgents: List<SubAgentSpec> = emptyList()
        private var bundleTools: List<Tool> = emptyList()
        private var bundleGuardrails: List<Guardrail> = emptyList()

        fun bundle(ext: Value): ExtensionBundle {
            val declared = ext.getMember("runtime")?.takeUnless { it.isNull }
            declaredAgents = rt.subAgentSpecs(declared)
            bundleTools = ext.array("tools").mapIndexed { i, v -> tool(v, "$bundleName tools[$i]") }
            // A sub-agent's tool list must be satisfiable by this bundle. Caught here rather than at
            // run time, and rather than by silently giving the child fewer tools than it was told it has.
            val registered = bundleTools.map { it.name }.toSet()
            declaredAgents.forEach { spec ->
                val missing = spec.tools.filterNot { it in registered }
                if (missing.isNotEmpty()) {
                    throw TypeScriptExtensionException("$bundleName sub-agent '${spec.name}' names tools this bundle does not register: $missing")
                }
            }
            bundleGuardrails = ext.array("guardrails").mapIndexed { i, v -> guardrail(v, "$bundleName guardrails[$i]") }
            return ExtensionBundle(
                systemPrompt = ext.array("systemPrompt").mapIndexed { i, v -> section(v, "$bundleName systemPrompt[$i]") },
                tools = bundleTools,
                guardrails = bundleGuardrails,
                listeners = ext.array("listeners").mapIndexed { i, v -> listener(v, "$bundleName listeners[$i]") },
                runtime = runtime(declared),
            )
        }

        /**
         * The runner for one declared agent, or null when it cannot be built: an unknown spec, or no model
         * (no API key, and no injected script in a test). The `delegate` capability is only advertised when
         * this can succeed, so the model is never offered something the session cannot honour.
         */
        private fun runnerFor(spec: SubAgentSpec, workspace: Workspace): SubAgentRunner? {
            // Only a spec the bundle itself declared may run, even if a tool invents one.
            if (declaredAgents.none { it.name == spec.name }) return null
            return SubAgentLoops.runner(
                spec = spec,
                model = model ?: return null,
                systemPrompt = rt.subAgentPrompt(spec),
                tools = bundleTools,
                guardrails = bundleGuardrails,
                workspace = workspace,
            )
        }

        /** Whether a delegated run can actually start: the tool checks nothing, this decides. */
        private fun canDelegate(): Boolean = model != null && declaredAgents.isNotEmpty()

        /**
         * Reads `Extension.runtime` into the loop's [AgentRuntime]. Every member is optional and defaults
         * to v1, so a bundle that never mentions `runtime` behaves exactly as before.
         *
         * A sub-agent may only use tools this bundle registers, and is given the SAME guardrails: the
         * policy then applies to a delegated run exactly as it does to the parent, because the child is
         * judged by the same rules rather than by a second copy of them.
         */
        private fun runtime(declared: Value?): AgentRuntime {
            if (declared == null) return object : AgentRuntime {}
            return object : AgentRuntime {
                override val mode = rt.mode(declared)

                override fun subAgentRunner(spec: SubAgentSpec, workspace: Workspace): SubAgentRunner? =
                    runnerFor(spec, workspace)

                override fun approveEditsFor(tool: Tool, input: ToolInput, workspace: Workspace): Boolean =
                    rt.approveEdits(declared, tool, input)

                // A parent session has no budget of its own: budgets belong to sub-agent runs.
                override fun interruptCheck(): String? = null
            }
        }

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
            // v2: advertised only when a runner can actually be built, so the tool never sees a capability
            // the session cannot honour. A tool must still handle its absence (see delegateTool).
            if (canDelegate()) it.putMember("delegate", rt.delegate { spec -> runnerFor(spec, ctx.workspace) })
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
