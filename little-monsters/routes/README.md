# routes/

Compiled-JS Express route modules for Little Monsters, mounted in-process by the OSHAL
loader at activation (ADR-085 P1). **These are produced by the extraction build — see
[../BUILD.md](../BUILD.md).** The manifest (`../oshal-app.yaml → routes[]`) names the
files and their exported factories.
