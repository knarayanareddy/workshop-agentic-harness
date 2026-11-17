# syntax=docker/dockerfile:1
#
# Builds self-contained harness packages: the app plus a bundled Java runtime, per OS and CPU.
# Users need only Docker to build them, and nothing (no JDK, no Node.js) to run them.
#
#   ./build-package.sh (or build-package.cmd)                   # just this machine's platform
#   docker build --output . .                                   # all platforms
#   docker build --output . --build-arg TARGETS=mac-aarch64 .   # just one
#
# Targets: linux-x64 linux-aarch64 mac-x64 mac-aarch64 windows-x64. Each lands unpacked in
# agentic-harness/agentic-harness-<target>/; run ./harness (macOS, Linux) or harness.cmd (Windows) from there.
#
# The app's jars run on any OS; only the Java runtime is platform-specific. So everything builds
# natively on the build machine ($BUILDPLATFORM) and the runtime for each target is downloaded
# from Eclipse Temurin (Adoptium), checksum-verified.
#
# Layered so that a rebuild after a source change only recompiles: the Gradle distribution, the Maven
# and npm dependencies and the Java runtimes are each downloaded in a layer that source changes do
# not invalidate. Changing a build script, package.json or the targets downloads that part again.

# Must match the bytecode target in build.gradle.kts (Java 25).
ARG JAVA_VERSION=25
ARG TARGETS="linux-x64 linux-aarch64 mac-x64 mac-aarch64 windows-x64"

# --- 1. TypeScript extensions -> extensions/typescript/dist/extension.js -------------------------
FROM --platform=$BUILDPLATFORM node:24.22.2-alpine AS ts-build
WORKDIR /src
# Dependencies first, so `npm ci` is cached until package.json or the lockfile changes.
COPY extensions/typescript/package.json extensions/typescript/package-lock.json extensions/typescript/.npmrc extensions/typescript/
RUN cd extensions/typescript && npm ci --no-audit --no-fund
# tsconfig resolves @harness/api from harness-api/typescript, so keep the repository layout.
COPY harness-api/typescript harness-api/typescript
COPY extensions/typescript extensions/typescript
RUN cd extensions/typescript && npm run build

# --- 2. JVM app -> app/build/install/app (bin/ start scripts + lib/ jars) ------------------------
FROM --platform=$BUILDPLATFORM eclipse-temurin:25-jdk AS jvm-build
WORKDIR /src
# 2a. The Gradle distribution. `sh ./gradlew` does not rely on the executable bit, which a Windows
#     checkout may not keep.
COPY gradlew gradle.properties ./
COPY gradle gradle
RUN sh ./gradlew --version --no-daemon -q

# 2b. Plugins and dependencies, from the build scripts alone (no sources yet). Gradle has no built-in
#     task for this, so an init script adds one that resolves every configuration of every project.
#     Lenient: project-to-project dependencies have no jars yet, and that is fine here.
COPY settings.gradle.kts build.gradle.kts ./
COPY --parents */build.gradle.kts extensions/*/build.gradle.kts ./
COPY <<EOF /tmp/resolve-dependencies.init.gradle.kts
allprojects {
    tasks.register("resolveDependencies") {
        doLast {
            project.configurations.filter { it.isCanBeResolved }.forEach { configuration ->
                configuration.incoming.artifactView { lenient(true) }.files.files
            }
        }
    }
}
EOF
RUN sh ./gradlew resolveDependencies --init-script /tmp/resolve-dependencies.init.gradle.kts \
        --no-configuration-cache --no-daemon -q

# 2c. The sources. The TypeScript extension is built in stage 1 (installDist does not trigger its npm
#     bundle task), so its sources are left out here: changing them does not recompile the JVM app.
COPY --exclude=extensions/typescript --exclude=presentation --exclude=packaging --exclude=workspace . .
RUN sh ./gradlew :app:installDist --no-daemon -q

# --- 3. Java runtime per target, from Temurin (independent of the app, so cached across source changes)
FROM --platform=$BUILDPLATFORM alpine:3.22 AS runtimes
RUN apk add --no-cache curl jq tar unzip
ARG JAVA_VERSION
ARG TARGETS
RUN <<EOF
set -eu
for target in $TARGETS; do
    os="${target%-*}"; arch="${target#*-}"
    echo "Downloading the Java $JAVA_VERSION runtime for $target"

    # Latest Temurin JRE for this OS/CPU, verified against the published SHA-256.
    asset="$(curl -fsSL "https://api.adoptium.net/v3/assets/latest/${JAVA_VERSION}/hotspot?os=${os}&architecture=${arch}&image_type=jre&vendor=eclipse")"
    name="$(echo "$asset" | jq -r '.[0].binary.package.name')"
    curl -fsSL -o "/tmp/$name" "$(echo "$asset" | jq -r '.[0].binary.package.link')"
    echo "$(echo "$asset" | jq -r '.[0].binary.package.checksum')  /tmp/$name" | sha256sum -c -

    mkdir -p "/runtimes/$target"
    case "$name" in
        *.zip) unzip -q "/tmp/$name" -d "/tmp/jre-$target" && mv "/tmp/jre-$target"/*/* "/runtimes/$target/" && rm -r "/tmp/jre-$target" ;;
        *)     tar -xzf "/tmp/$name" -C "/runtimes/$target" --strip-components=1 ;;
    esac
    rm "/tmp/$name"
done
EOF

# --- 4. One folder per target: app + Java runtime + launcher ------------------------------------
FROM --platform=$BUILDPLATFORM alpine:3.22 AS package
ARG TARGETS

# The platform-independent part, laid out the way Main.kt and the launchers expect.
WORKDIR /stage
COPY --from=jvm-build /src/app/build/install/app app
COPY --from=ts-build  /src/extensions/typescript/dist/extension.js extensions/typescript/dist/extension.js
COPY workspace/README.md workspace/README.md
COPY packaging /launchers
COPY --from=runtimes /runtimes /runtimes

RUN <<EOF
set -eu
mkdir -p /out
for target in $TARGETS; do
    echo "Packaging $target"
    pkg="/out/agentic-harness-$target"
    mkdir -p "$pkg"
    cp -a /stage/. "$pkg/"
    cp -a "/runtimes/$target" "$pkg/runtime"

    if [ "${target%-*}" = windows ]; then
        # Batch files need CRLF line endings, whatever the checkout used.
        sed 's/\r*$/\r/' /launchers/harness.cmd > "$pkg/harness.cmd"
    else
        install -m 755 /launchers/harness "$pkg/harness"
    fi
done
ls -l /out
EOF

# --- 5. Export: only the package folders, under agentic-harness/ in the --output directory ----------
FROM scratch AS export
COPY --from=package /out/ /agentic-harness/
