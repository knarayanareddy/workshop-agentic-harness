# OpenRA workshop toolbox

A Docker image that builds OpenRA, runs headless checks on mods, and packages
self-contained builds that run natively on the host (no .NET install needed).
The game itself runs on the host; the container never needs a display.

## Get OpenRA first

The image is built from an OpenRA checkout next to this folder. If
`workspace/OpenRA/` does not exist yet, clone it from the workspace folder:

    git clone --config core.autocrlf=false https://github.com/OpenRA/OpenRA.git OpenRA

`core.autocrlf=false` matters on Windows: Git for Windows would otherwise turn
the shell scripts' line endings into CRLF, and they fail inside the Linux
container. Tested against commit `1f594e3`.

## Build the image

From the workspace folder (the one containing `OpenRA/` and `docker/`), pass
the platform you will play on as `HOST_RID`:

    docker build -f docker/Dockerfile --build-arg HOST_RID=osx-arm64 -t openra-workshop .

On Windows use `--build-arg HOST_RID=win-x64`. On Linux you can leave it out:
the default is your own architecture (`linux-x64` or `linux-arm64`). `HOST_RID` is one of `osx-arm64`, `osx-x64`, `linux-x64`, `linux-arm64`,
`win-x64`. Only that platform's NuGet packages are restored, which keeps the
image smaller and the build faster; without it the image's own Linux platform
is used. The container then works with `--network none` for that platform.
Packaging for any other platform needs network access, or a rebuild with
another `HOST_RID`.

## Tools (on PATH inside the container)

| Command | What it does |
|---|---|
| `openra-check [mod]` | Build, lint rules/YAML, check Lua syntax. Exit code 0 = OK. |
| `openra-rules <ACTOR> [mod]` | Print an actor's final merged rules, e.g. `openra-rules 2TNK`. |
| `openra-package [platform] [mod]` | Self-contained build into `/out/<platform>`. Platform defaults to `HOST_RID`. |
| `openra-build` | Just compile. |

`mod` defaults to `ra`.

## Typical loop

Mount your OpenRA checkout so edits on the host are seen by the container.
Use relative paths: the harness guardrails deny absolute paths outside the
workspace, and `$PWD` makes every command wait for approval. Keep it on one
line with double quotes so it runs the same in sh, PowerShell and cmd.exe
(the harness's shell on Windows):

    docker run --rm --network none -v ./OpenRA:/workspace/OpenRA -v ./out:/out openra-workshop sh -c "openra-check && openra-package"

Then play it natively:

    ./out/osx-arm64/play.sh                     # macOS / Linux
    out\win-x64\play.cmd                        # Windows
    ./out/osx-arm64/play.sh Launch.Map=<uid>    # jump straight into a map

On first launch OpenRA asks to download the original Red Alert content
(freeware); choose "Quick Install".

## Linux notes

- The Linux packages bundle SDL2, OpenAL, FreeType and Lua for both x64 and
  arm64. The game only needs OpenSSL from the system (`libssl3`), which desktop
  distros already have.
- Files the container writes into `OpenRA/` and `out/` are handed back to the
  owner of `OpenRA/` when a command ends, so you never need `sudo` to delete them.
- Your user must be allowed to run Docker (the `docker` group, or rootless Docker).
- On SELinux distros (Fedora, RHEL) add `:z` to both mounts, e.g. `-v ./OpenRA:/workspace/OpenRA:z`.
