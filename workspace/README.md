# Workspace

The agent's working directory: every file tool resolves paths inside this folder and refuses paths
that escape it. Put a small project here to experiment with (contents are git-ignored), or start the
app with another directory: `./gradlew :app:run --args="C:/path/to/project"`.

## OpenRA

`docker/` holds a Docker toolbox that builds, checks and packages [OpenRA](https://github.com/OpenRA/OpenRA)
(see [docker/README.md](docker/README.md)). The OpenRA source itself is not committed: if `OpenRA/` does
not exist yet, clone it here first, before building the image or touching any mod files:

```bash
git clone --config core.autocrlf=false https://github.com/OpenRA/OpenRA.git OpenRA
```
