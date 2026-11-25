package com.jdriven.harness.api

import java.nio.file.Path

/**
 * The directory the agent works in. Every path is relative to [root], and [resolve] refuses any path
 * that escapes it — containment is a property of this capability, not of any guardrail.
 */
interface Workspace {
    val root: Path

    /** Resolves [relative] inside the workspace; throws [WorkspaceViolation] if it would escape. */
    fun resolve(relative: String): Path

    /**
     * Whether [relative] stays inside the workspace: `false` where [resolve] throws [WorkspaceViolation].
     * Still throws `InvalidPathException` for a string that is not a path on this platform.
     */
    fun contains(relative: String): Boolean = try {
        resolve(relative)
        true
    } catch (_: WorkspaceViolation) {
        false
    }

    /** [path] relative to [root], with forward slashes — what a guardrail should match on. */
    fun relativize(path: Path): String = root.relativize(path.toAbsolutePath().normalize()).toString().replace('\\', '/')

    fun exists(relative: String): Boolean
    fun readText(relative: String): String
    fun writeText(relative: String, content: String)

    /** Entries directly under [relative], directories suffixed with `/`. */
    fun list(relative: String): List<String>
}

class WorkspaceViolation(message: String) : RuntimeException(message)

/** What every guardrail hook and dynamic section sees about the run in progress. */
data class TurnContext(
    val runId: String,
    /** 1-based index of the inference call within this run. */
    val iteration: Int,
    val maxIterations: Int,
    /** The transcript so far, oldest first. */
    val messages: List<Message>,
    val workspace: Workspace,
) {
    val iterationsRemaining: Int get() = maxIterations - iteration
}

/**
 * What a tool gets besides its input. Deliberately has no approval handler: gating is a guardrail
 * concern, not a tool concern.
 */
class ToolContext(
    val runId: String,
    val iteration: Int,
    val toolUseId: String,
    val workspace: Workspace,
    val events: EventSink,
) {
    /** Emits an [AgentEvent.Log] so the trace shows what the tool is doing. */
    fun log(message: String) = events.emit(AgentEvent.Log(runId, source = "tool:$toolUseId", message = message))
}

/** A proposed tool use, resolved against the registered tool. */
data class ToolCall(val id: String, val tool: Tool, val input: ToolInput)
