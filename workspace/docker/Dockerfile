# Builds, checks and packages OpenRA. Run from the workspace:
#   docker build -f docker/Dockerfile --build-arg HOST_RID=osx-arm64 -t openra-workshop .
# HOST_RID: osx-arm64 | osx-x64 | linux-x64 | linux-arm64 | win-x64 (default: linux-<arch>)

FROM mcr.microsoft.com/dotnet/sdk:10.0

ARG TARGETARCH
ARG HOST_RID=

RUN apt-get update \
 && apt-get install -y --no-install-recommends make git curl lua5.1 python3 \
 && rm -rf /var/lib/apt/lists/*

ENV OPENRA_DIR=/workspace/OpenRA \
    OUT_DIR=/out \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

COPY OpenRA ${OPENRA_DIR}
WORKDIR ${OPENRA_DIR}

# Restore only HOST_RID, so packaging for it works offline.
RUN case "${TARGETARCH}" in amd64) arch=x64 ;; *) arch=arm64 ;; esac \
 && rid="${HOST_RID:-linux-${arch}}" \
 && echo "Restoring for ${rid}" \
 && dotnet restore -r "${rid}" -p:TargetPlatform="${rid}" -p:SelfContained=true \
 && echo "${rid}" > /etc/openra-host-rid

# Prebuild, and keep the GeoIP database outside OPENRA_DIR: a mounted checkout hides it.
RUN make all \
 && mkdir -p /opt/openra \
 && cp IP2LOCATION-LITE-DB1.IPV6.BIN.ZIP /opt/openra/

COPY docker/bin/ /usr/local/bin/
