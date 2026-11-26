package com.jdriven.harness.extensions.kotlin.helpers

import com.jdriven.harness.api.CommandResult
import com.jdriven.harness.api.ShellCommand
import com.jdriven.harness.api.ToolContext

/**
 * The OpenRA toolbox: a Docker container that builds, checks and packages OpenRA (see `workspace/docker/README.md`).
 * This does the Docker part, so your tools only decide what the model sees.
 *
 * Commands run directly, not through `run_command`, so no guardrail asks for approval: there is no free
 * text from the model in them.
 */
object Toolbox {
    const val IMAGE = "openra-workshop"
    const val CONTAINER = "openra-toolbox"

    /** Where [start] writes its output. Its last line is `exit code N` once it has finished. */
    const val START_LOG = "out/toolbox.log"

    /** Where [packageAndPlay] writes its output. */
    const val PLAY_LOG = "out/play.log"

    enum class State { NOT_STARTED, STARTING, READY, FAILED }

    /** How far [start] has got, and the last lines of its log to show what it is doing or why it failed. */
    data class Status(val state: State, val log: String)

    /** Whether Docker is installed and running. The other functions need it. */
    fun isDockerRunning(ctx: ToolContext): Boolean = ShellCommand.run(ctx.workspace.root, "docker info").exitCode == 0

    /**
     * Gets the toolbox ready, in the background: builds the image if it is missing, (re)starts the container
     * and compiles OpenRA in it. Returns at once; the first time, the work takes several minutes. Follow it with [status].
     */
    fun start(ctx: ToolContext) {
        val root = ctx.workspace.root
        val steps = mutableListOf<String>()
        if (ShellCommand.run(root, "docker image inspect $IMAGE").exitCode != 0) {
            steps += "docker build -f docker/Dockerfile --build-arg HOST_RID=${hostRid()} -t $IMAGE ."
        }
        ShellCommand.run(root, "docker rm -f $CONTAINER")
        steps += "docker run -d --name $CONTAINER --network none -v ./OpenRA:/workspace/OpenRA -v ./out:/out $IMAGE sleep infinity"
        steps += "docker exec $CONTAINER openra-build"
        ShellCommand.spawn(root, steps.joinToString(" && "), ctx.workspace.resolve(START_LOG))
    }

    /** How far [start] has got, read from [START_LOG]. */
    fun status(ctx: ToolContext): Status {
        if (!ctx.workspace.exists(START_LOG)) return Status(State.NOT_STARTED, "")
        val lines = Text.nonBlankLines(ctx.workspace.readText(START_LOG))
        val last = lines.lastOrNull().orEmpty()
        val state = when {
            last == "exit code 0" -> State.READY
            last.startsWith("exit code") -> State.FAILED
            else -> State.STARTING
        }
        return Status(state, lines.takeLast(15).joinToString("\n"))
    }

    /** Whether the toolbox container is running, so [exec] can reach it. */
    fun isRunning(ctx: ToolContext): Boolean = exec(ctx, "true") != null

    /**
     * Runs [command] in the toolbox container, like `openra-check` or `openra-rules 2TNK`, and waits for it
     * (at most [ShellCommand.TIMEOUT_SECONDS] seconds). Returns `null` when the container is not running.
     */
    fun exec(ctx: ToolContext, command: String): CommandResult? {
        val result = ShellCommand.run(ctx.workspace.root, "docker exec $CONTAINER $command")
        val missing = result.exitCode != 0 && ("No such container" in result.output || "is not running" in result.output)
        return if (missing) null else result
    }

    /**
     * Packages the OpenRA checkout for this machine and opens the game, in the background: returns at once,
     * and the game window opens by itself after a minute or two. Output goes to [PLAY_LOG]. Needs a running toolbox.
     */
    fun packageAndPlay(ctx: ToolContext) {
        val rid = hostRid()
        val game = if (rid.startsWith("win")) "out\\$rid\\play.cmd" else "./out/$rid/play.sh"
        ShellCommand.spawn(ctx.workspace.root, "docker exec $CONTAINER openra-package && $game", ctx.workspace.resolve(PLAY_LOG))
    }

    /** The platform to package for: the user's own machine, as a .NET runtime identifier like `osx-arm64`. */
    private fun hostRid(): String {
        val os = System.getProperty("os.name").lowercase()
        val cpu = if (System.getProperty("os.arch") in setOf("aarch64", "arm64")) "arm64" else "x64"
        return when {
            os.startsWith("windows") -> "win-x64"
            os.startsWith("mac") -> "osx-$cpu"
            else -> "linux-$cpu"
        }
    }
}
