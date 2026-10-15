# Local vector dependencies

`npm ci --ignore-scripts && npm run build` reproduces the locally served polygon
boolean bundle from the pinned lockfile. No CDN or network request occurs at run
time. Queue/sweep ceilings are 50,000; the UI runs booleans in a worker with a
five-second timeout. Original inputs stay editable. Retain the included license
files and bundled upstream notices. polygon-clipping uses robust-predicates and
splaytree; versions and integrity are pinned in package-lock.json.
