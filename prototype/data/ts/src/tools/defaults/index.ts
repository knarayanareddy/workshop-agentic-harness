import type { Tool } from "@harness/api";
import { editFile } from "./editFile";
import { fileStats } from "./fileStats";
import { glob } from "./glob";
import { grep } from "./grep";
import { listFiles } from "./listFiles";
import { readFile } from "./readFile";
import { runCommand } from "./runCommand";
import { writeFile } from "./writeFile";

/**
 * The tools a coding agent needs at minimum. run_command goes through ctx.exec: the embedded runtime
 * has no child_process, so the harness runs the command for the tool.
 */
export const defaultTools: Tool[] = [readFile, writeFile, editFile, listFiles, glob, grep, runCommand, fileStats];
