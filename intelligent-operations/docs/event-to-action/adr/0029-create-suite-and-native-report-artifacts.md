# ADR0029: Install Create's declared studio components

Accepted, 21 October 2026. Native export and provider acceptance verified.

Create 1.15.0 was already installed and matched repository main. Only Image Editor
and AI Office were available beneath it: the optional studio packages had not been
installed. A complete experience requires both package admission and the declared
Create composite role with the selected optional applications.

Use the shared guarded operator helper `scripts/install-create-k8s.py` to install
Video Studio 1.11.0, its required Vids 1.5.7 package, Publishing Studio 0.1.0 and
PDF Workbench 0.1.0. Keep the existing Office, Create and Operations packages.
Use exact public committed source, trusted native preview/install, and Create's
own administrator template with only those optional components selected. The
Publishing/PDF engines use existing reviewed local images, verified source hashes,
bounded CPU/memory and the native private relay. No GPU workload is started.

Actual Video upload finalization initially failed: the Kubernetes scratch volume
had mode `02777` and its newly created private root inherited mode `02700`. The editor
requires exactly `0700`. An owner-checked initialization step clears inherited SGID
on that one private directory before kernel startup; no permission check is
weakened. A real host fixture reproduces inheritance and refuses a symlink. Live
pod replacement preserves the corrected `0700` root. The actual Create UX imported
two one-second clips, saved a revision and exported 60 frames at 1280x720/30fps.
Independent decoded samples verify the blue/orange splice.

Jarvis generated an evidence-based Word report after an operator supplied a
bounded authenticated export of eight own-account ticket records. The operator
then passed that saved outline to the actual native Publishing and Office APIs:
Publishing generated an eight-page PDF with clean preflight; Office generated
eleven PowerPoint slides including the cover. Bytes, signatures, retained facts
and hashes were independently checked. These are system-hosted application
artifacts, not manually manufactured local report files. This acceptance does
not establish a fully automatic Jarvis evidence-to-multiple-artifact chain or
placement in a canonical ticket workspace; those integrations remain open.

After the operator registered the callback and personally completed Google
consent, Gmail accepted two messages containing the requested PDF and PowerPoint,
one attachment per message through the existing native mail API. Provider IDs
and the explicit recipient remain in private operator receipts. This proves
provider acceptance, not human inbox receipt. No SMS, call or Telegram was resent.

Kernel replacement temporarily interrupted the portal-facing Code Server redirect.
The editor deployment stayed ready. The existing forwarding service reconnected;
the kernel/editor deployments and editor service endpoint are ready and the editor
health endpoint returns HTTP 200. No kernel source change was needed for this slice.
