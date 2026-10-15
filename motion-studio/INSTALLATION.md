# Motion installation plan

This plan installs the reviewed Motion application and its own engine. The
kernel release remains coordinated separately. No live installation is claimed
by this document.

## Source and compatibility

Use the committed root `motion-studio` package and matching `video` package from
`feat/native-application-executors`. Preserve the canonical checkout's unrelated
work. The next kernel deployment's pinned source bundle must include these store
commits; its admitted source and later boot discovery must use that same bundle.
The old Create prototype alone is not an installed application.

The kernel must include the reviewed original-authority engine continuation,
protected Motion render artifact exchange and keyed native Video upload recovery.
Confirm actual source admission and current contract fingerprints before loading
Motion or replacing Video. Apply only the native Motion migration
`migrations/native/001-motion.sql` through the kernel schema coordinator; retain
Video's current migrations including `072-video-motion-sources.sql`.

Generate a private candidate from the clean committed source:

```sh
node motion-studio/scripts/prepare-native-candidate.mjs /tmp/motion-committed-candidate
```

The output must not already exist. Record its exact Git commit, clean flag, file
hashes and tree hash. Candidate generation never installs or reloads an app.

## Engine image and private sidecar

Expected engine identity is protocol 1, upstream
`67434e90388b6dca4417555346fa6850b6f96033`, build hash
`dc08d88364db6840fcf8fea12b86087f0182d86345680c752be90d1eca599e5b`.
The reviewed ARM64 image is
`sha256:d13ca78faac550b3cb0f34bd9bb4688482a5604e77f199f1744561f5857436e9`.
An isolated non-networked hardened container using that exact image passed the
engine source identity, 433-command registry, real animated alpha pixels, owned
masked-source reopen, text pixels and exact property/string edits. That is an
engine proof, not installed application acceptance.

For a new image, build `engine/container/Dockerfile` from the committed `engine`
directory. It pins the official base images and locked worker dependencies. A
native gate worker can be built with `cargo build --release --locked --jobs 2
--manifest-path motion-studio/engine/Cargo.toml` and an owned target directory.
Always verify its greeting against `routes/engine-identity.json`.

The persistent sidecar is only `oshal-motion-studio-engine`, in its own Compose
project of that name, on the existing private `oshal-native-engines` network.
Use the reviewed compose limits: non-root 10001, read-only root, no host ports or
volumes, 512 MiB temporary filesystem, dropped capabilities, no new privileges,
128 PIDs and 1 GiB memory. Pin the verified image id; do not replace another app's
engine. Run the actual image self-test before accepting readiness.

Create only Motion's loopback link, using the existing reviewed forwarder:

```sh
python3 /home/oshal-maintainer/.local/state/oshal-native/host/native_container_forward.py \
  37415 oshal-motion-studio-engine oshal-native-engines 7414
```

The wrapper resolves the private container address each time it starts. Make the
owned link restart with the engine. The kernel configuration addition is exactly
`motion-studio=127.0.0.1:37415` in `OSHAL_PACKAGE_ENGINES`; preserve all existing
entries, back up the private config, and coordinate its one kernel reload with
the release owner. Do not publish the engine port publicly.

## Admission, grants and installed acceptance

After the matching kernel/source deployment, use the actual installer endpoint
`POST /api/swarm/apps/install` with the published Motion name/path, and refresh
only the owned Motion/Video packages. Avoid the global reload endpoint while
other lanes are changing their apps. Verify the admitted route, authorization,
bot and tool catalogs; all 43 Motion tools must retain their declared approval
mode and exact original-owner resource permissions.

Preview and apply only the operator's own Motion and Video role assignments at
the new current contract revisions. A reader must not receive change/export or
another person's data. Do not widen a role to make an acceptance test pass.

Record installed human save/reopen, native preview pixels, render status/cancel,
verified download, Video editable source import/reopen/refresh and a real
approval-held agent render/import. Also prove foreign ownership, withdrawal,
source deletion, stale revision and canceled output refusals. Use uniquely named
owned acceptance projects and remove only those projects. Production data,
money and other app assignments stay untouched.

The disposable full-kernel proof used SHA2 optimized only through test-build
flags; fresh authority/source checks and the five-minute render deadline remained
unchanged. A debug hashing timeout and a later unreproduced storage-busy refusal
remain in the historical receipt. Proxy video/audio/model/data footage, broader
upstream fidelity and whole-family Adobe parity are not claimed complete.
