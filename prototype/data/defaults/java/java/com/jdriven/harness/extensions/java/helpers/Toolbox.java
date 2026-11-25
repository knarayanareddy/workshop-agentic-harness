package com.jdriven.harness.extensions.java.helpers;

import com.jdriven.harness.api.CommandResult;
import com.jdriven.harness.api.ShellCommand;
import com.jdriven.harness.api.ToolContext;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The OpenRA toolbox: a Docker container that builds, checks and packages OpenRA (see {@code workspace/docker/README.md}).
 * This does the Docker part, so your tools only decide what the model sees.
 *
 * <p>Commands run directly, not through {@code run_command}, so no guardrail asks for approval: there is no free
 * text from the model in them.
 */
public final class Toolbox {
    public static final String IMAGE = "openra-workshop";
    public static final String CONTAINER = "openra-toolbox";

    /** Where {@link #start} writes its output. Its last line is {@code exit code N} once it has finished. */
    public static final String START_LOG = "out/toolbox.log";

    /** Where {@link #packageAndPlay} writes its output. */
    public static final String PLAY_LOG = "out/play.log";

    public enum State { NOT_STARTED, STARTING, READY, FAILED }

    /** How far {@link #start} has got, and the last lines of its log to show what it is doing or why it failed. */
    public record Status(State state, String log) {
    }

    private Toolbox() {
    }

    /** Whether Docker is installed and running. The other methods need it. */
    public static boolean isDockerRunning(ToolContext ctx) {
        return run(ctx, "docker info").getExitCode() == 0;
    }

    /**
     * Gets the toolbox ready, in the background: builds the image if it is missing, (re)starts the container
     * and compiles OpenRA in it. Returns at once; the first time, the work takes several minutes. Follow it with {@link #status}.
     */
    public static void start(ToolContext ctx) {
        List<String> steps = new ArrayList<>();
        if (run(ctx, "docker image inspect " + IMAGE).getExitCode() != 0) {
            steps.add("docker build -f docker/Dockerfile --build-arg HOST_RID=" + hostRid() + " -t " + IMAGE + " .");
        }
        run(ctx, "docker rm -f " + CONTAINER);
        steps.add("docker run -d --name " + CONTAINER + " --network none -v ./OpenRA:/workspace/OpenRA -v ./out:/out " + IMAGE + " sleep infinity");
        steps.add("docker exec " + CONTAINER + " openra-build");
        spawn(ctx, String.join(" && ", steps), START_LOG);
    }

    /** How far {@link #start} has got, read from {@link #START_LOG}. */
    public static Status status(ToolContext ctx) {
        if (!ctx.getWorkspace().exists(START_LOG)) return new Status(State.NOT_STARTED, "");
        List<String> lines = Text.nonBlankLines(ctx.getWorkspace().readText(START_LOG));
        String last = lines.isEmpty() ? "" : lines.getLast();
        State state = last.equals("exit code 0") ? State.READY
                : last.startsWith("exit code") ? State.FAILED
                : State.STARTING;
        return new Status(state, String.join("\n", lines.subList(Math.max(0, lines.size() - 15), lines.size())));
    }

    /** Whether the toolbox container is running, so {@link #exec} can reach it. */
    public static boolean isRunning(ToolContext ctx) {
        return exec(ctx, "true").isPresent();
    }

    /**
     * Runs {@code command} in the toolbox container, like {@code openra-check} or {@code openra-rules 2TNK}, and waits
     * for it (at most {@link ShellCommand#TIMEOUT_SECONDS} seconds). Empty when the container is not running.
     */
    public static Optional<CommandResult> exec(ToolContext ctx, String command) {
        CommandResult result = run(ctx, "docker exec " + CONTAINER + " " + command);
        boolean missing = result.getExitCode() != 0
                && (result.getOutput().contains("No such container") || result.getOutput().contains("is not running"));
        return missing ? Optional.empty() : Optional.of(result);
    }

    /**
     * Packages the OpenRA checkout for this machine and opens the game, in the background: returns at once,
     * and the game window opens by itself after a minute or two. Output goes to {@link #PLAY_LOG}. Needs a running toolbox.
     */
    public static void packageAndPlay(ToolContext ctx) {
        String rid = hostRid();
        String game = rid.startsWith("win") ? "out\\" + rid + "\\play.cmd" : "./out/" + rid + "/play.sh";
        spawn(ctx, "docker exec " + CONTAINER + " openra-package && " + game, PLAY_LOG);
    }

    /** The platform to package for: the user's own machine, as a .NET runtime identifier like {@code osx-arm64}. */
    private static String hostRid() {
        String os = System.getProperty("os.name").toLowerCase();
        String arch = System.getProperty("os.arch");
        String cpu = arch.equals("aarch64") || arch.equals("arm64") ? "arm64" : "x64";
        if (os.startsWith("windows")) return "win-x64";
        if (os.startsWith("mac")) return "osx-" + cpu;
        return "linux-" + cpu;
    }

    private static CommandResult run(ToolContext ctx, String command) {
        try {
            return ShellCommand.run(ctx.getWorkspace().getRoot(), command);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static void spawn(ToolContext ctx, String command, String log) {
        try {
            ShellCommand.spawn(ctx.getWorkspace().getRoot(), command, ctx.getWorkspace().resolve(log));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
