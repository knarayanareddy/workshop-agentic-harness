import { shell, type CommandResult, type ToolContext } from "@harness/api";
import { text } from "./text";

const IMAGE = "openra-workshop";
const CONTAINER = "openra-toolbox";
const START_LOG = "out/toolbox.log";
const PLAY_LOG = "out/play.log";

export type ToolboxState = "not_started" | "starting" | "ready" | "failed";

/** How far `toolbox.start` has got, and the last lines of its log to show what it is doing or why it failed. */
export interface ToolboxStatus {
  state: ToolboxState;
  log: string;
}

/** The platform to package for: the user's own machine, as a .NET runtime identifier like `osx-arm64`. */
const hostRid = (ctx: ToolContext): string => {
  if (shell.name === "cmd.exe") return "win-x64";
  const [os, arch] = ctx.exec("uname -sm").output.trim().split(/\s+/);
  const cpu = arch === "arm64" || arch === "aarch64" ? "arm64" : "x64";
  return `${os === "Darwin" ? "osx" : "linux"}-${cpu}`;
};

const exec = (ctx: ToolContext, command: string): CommandResult | null => {
  const result = ctx.exec(`docker exec ${CONTAINER} ${command}`);
  return result.exitCode !== 0 && /No such container|is not running/.test(result.output) ? null : result;
};

/**
 * The OpenRA toolbox: a Docker container that builds, checks and packages OpenRA (see `workspace/docker/README.md`).
 * This does the Docker part, so your tools only decide what the model sees.
 *
 * Commands run directly, not through `run_command`, so no guardrail asks for approval: there is no free text from
 * the model in them.
 */
export const toolbox = {
  IMAGE,
  CONTAINER,
  /** Where `start` writes its output. Its last line is `exit code N` once it has finished. */
  START_LOG,
  /** Where `packageAndPlay` writes its output. */
  PLAY_LOG,

  /** Whether Docker is installed and running. The other functions need it. */
  isDockerRunning: (ctx: ToolContext): boolean => ctx.exec("docker info").exitCode === 0,

  /**
   * Gets the toolbox ready, in the background: builds the image if it is missing, (re)starts the container and
   * compiles OpenRA in it. Returns at once; the first time, the work takes several minutes. Follow it with `status`.
   */
  start: (ctx: ToolContext): void => {
    const steps: string[] = [];
    if (ctx.exec(`docker image inspect ${IMAGE}`).exitCode !== 0) {
      steps.push(`docker build -f docker/Dockerfile --build-arg HOST_RID=${hostRid(ctx)} -t ${IMAGE} .`);
    }
    ctx.exec(`docker rm -f ${CONTAINER}`);
    steps.push(
      `docker run -d --name ${CONTAINER} --network none -v ./OpenRA:/workspace/OpenRA -v ./out:/out ${IMAGE} sleep infinity`,
      `docker exec ${CONTAINER} openra-build`,
    );
    ctx.spawn(steps.join(" && "), START_LOG);
  },

  /** How far `start` has got, read from `START_LOG`. */
  status: (ctx: ToolContext): ToolboxStatus => {
    if (!ctx.workspace.exists(START_LOG)) return { state: "not_started", log: "" };
    const lines = text.nonBlankLines(ctx.workspace.readText(START_LOG));
    const last = lines[lines.length - 1] ?? "";
    const state: ToolboxState = last === "exit code 0" ? "ready" : last.startsWith("exit code") ? "failed" : "starting";
    return { state, log: lines.slice(-15).join("\n") };
  },

  /** Whether the toolbox container is running, so `exec` can reach it. */
  isRunning: (ctx: ToolContext): boolean => exec(ctx, "true") !== null,

  /**
   * Runs `command` in the toolbox container, like `openra-check` or `openra-rules 2TNK`, and waits for it (at most
   * `shell.timeoutSeconds`). Returns `null` when the container is not running.
   */
  exec,

  /**
   * Packages the OpenRA checkout for this machine and opens the game, in the background: returns at once, and the
   * game window opens by itself after a minute or two. Output goes to `PLAY_LOG`. Needs a running toolbox.
   */
  packageAndPlay: (ctx: ToolContext): void => {
    const rid = hostRid(ctx);
    const game = shell.name === "cmd.exe" ? `out\\${rid}\\play.cmd` : `./out/${rid}/play.sh`;
    ctx.spawn(`docker exec ${CONTAINER} openra-package && ${game}`, PLAY_LOG);
  },
};
