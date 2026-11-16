# The object store (accepted ADR 0041; P2.18s): SeaweedFS 4.53's own image (deployment/images/bases.lock.json, a
# VENDOR_BASES entry), pulled from our GHCR mirror by its digest, one stage, run as the base's seaweed user
# (1000:1000, which already owns /data). Only the weed binary and its Alpine base ship.
# The upstream image starts through /entrypoint.sh, which drops root with su-exec and can mount FUSE through the
# setuid /bin/fusermount; this image never starts as root and serves S3 only, so those go, with curl, and apk last
# (the edge's rule: the last apk command removes apk-tools). busybox wget stays for the healthcheck.
# Checked by building it on 4.53 (2026-11-16): no setuid or setgid file is left, and `weed server` answers
# 127.0.0.1:8333/healthz with 200.
# The S3 identities (an admin key for the one-shot setup, a scoped key per caller) are a secret file mounted at run
# time, never baked here.

FROM ghcr.io/undefined6799/mirror/seaweedfs@sha256:ccad23e18639c8b98cee17e7100b95830a06077b56d8e5b006d6dcf8ec5e94a0
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only AND Apache-2.0"
RUN apk del --no-network curl fuse fuse-common su-exec \
  && rm -f /entrypoint.sh \
  && apk del --no-network apk-tools
USER 1000:1000
# weed server (SeaweedFS 4.53 `weed server -h`): master, volume and filer in one process with the S3 gateway on
# 8333. Only S3 listens beyond loopback: -ip and -ip.bind keep master, volume and filer (and the filer's IAM gRPC
# service, which with no jwt.filer_signing.key would let anyone who reaches it create users and policies) on
# 127.0.0.1, -s3.ip.bind opens S3 alone, and the Iceberg and Lance listeners and the embedded IAM API are off. The
# S3 IAM-cache gRPC port that S3 binds beside it refuses every non-local caller with no signing key
# (weed/security/grpc_peer.go CheckLocalGrpcPeer at 4.53). Checked with netstat on 4.53 (2026-11-16): 8333 and
# 18333 on 0.0.0.0, every other port on 127.0.0.1; anonymous bucket create, list and put all 403.
# -filer.encryptVolumeData encrypts every chunk with its own key held in the filer, so deleting the object's filer
# entry leaves the volume bytes unreadable (ADR 0041 Decision 3). -master.garbageThreshold=0.01 lets a vacuum reclaim
# any volume with deleted bytes. -volume.max=0 sizes volumes to the disk.
ENTRYPOINT ["/usr/bin/weed"]
CMD ["server", "-dir=/data", "-ip=127.0.0.1", "-ip.bind=127.0.0.1", "-s3", "-s3.ip.bind=0.0.0.0", \
  "-s3.port.iceberg=0", "-s3.port.lance=0", "-s3.iam=false", "-s3.config=/run/secrets/objects_s3.json", \
  "-volume.max=0", "-filer.encryptVolumeData", "-master.garbageThreshold=0.01"]
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8333/healthz"]
