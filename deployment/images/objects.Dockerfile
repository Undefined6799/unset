# The object store (accepted ADR 0041; P2.18s): SeaweedFS 4.53's own image (deployment/images/bases.lock.json, a
# VENDOR_BASES entry), pulled from our GHCR mirror by its digest, one stage, run as the base's seaweed user
# (1000:1000, which already owns /data). Only the weed binary and its Alpine base ship.
# The upstream image starts through /entrypoint.sh, which drops root with su-exec and can mount FUSE through the
# setuid /bin/fusermount; this image never starts as root and serves S3 only, so those go, with curl, and apk last
# (the edge's rule: the last apk command removes apk-tools). busybox wget stays for the healthcheck.
# Checked by building it on 4.53 (2026-11-16): no setuid or setgid file is left, and `weed server` answers
# 127.0.0.1:8333/healthz with 200.
# The S3 identities (one scoped key per caller) are a secret file mounted at run time, never baked here. -s3.config
# fails closed on 4.53 (weed/s3api/auth_credentials.go:386-427): a missing or unparsable file stops the server
# (glog.Fatalf), and a file that yields no identity turns authentication on with nobody allowed. Pinned by
# objects.image.test.ts.

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
# 18333 on 0.0.0.0, every other port on 127.0.0.1; anonymous bucket create, list and put all 403. Neither port is
# ever published: the store sits only on its internal objects networks, and the compose tests hold that.
# -filer.encryptVolumeData encrypts every chunk with its own key held in the filer, so no object's bytes are plaintext
# in a volume file; it is not an erase mechanism (ADR 0041 Decision 6). -master.garbageThreshold=0.01 is the vacuum
# backstop only; erasure runs the forced vacuum (Decision 7). -volume.max=0 sets the volume count from the disk: free
# space divided by the volume size limit (weed/storage/store.go at 4.53). -master.volumeSizeLimitMB=1024 makes that a
# volume per GB, not per 32 GB (the default): each bucket is its own collection, the master grows 7 volumes per
# collection (weed/topology/volume_growth.go), and at 32 GB a 51 GB staging disk held one volume, which the filer's
# own collection took, so no bucket could be written (2026-11-16). objects_each_bucket_takes_writes pins it.
# -s3.config names the file Compose mounts for the secret objects_s3, at /run/secrets/<name> with no extension: the
# preflight's parser takes only [a-z0-9_] secret names, and weed reads the file as JSON whatever its name (checked on
# 4.53, 2026-11-16: an extensionless file with no identities loads and denies every request).
# These flags are pinned by objects.test.ts.
ENTRYPOINT ["/usr/bin/weed"]
CMD ["server", "-dir=/data", "-ip=127.0.0.1", "-ip.bind=127.0.0.1", "-s3", "-s3.ip.bind=0.0.0.0", \
  "-s3.port.iceberg=0", "-s3.port.lance=0", "-s3.iam=false", "-s3.config=/run/secrets/objects_s3", \
  "-volume.max=0", "-master.volumeSizeLimitMB=1024", "-filer.encryptVolumeData", "-master.garbageThreshold=0.01"]
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8333/healthz"]
